import { $ } from '../ui/dom.js';
import { EVENTS } from '../store/events.js';
import {
  state,
  emit,
  currentChat,
  setSession,
  persistPrefs,
  persistConfig,
  invalidateContext,
} from '../store/state.js';
import * as conversation from '../services/conversation.js';
import * as settings from '../services/settings.js';
import * as transfer from '../services/transfer.js';
import * as models from '../services/models.js';
import * as images from '../services/images.js';
import { pickJSONText, pickFiles } from '../services/file-io.js';
import { isRetryable, isCollapsed, messageMarkdown } from '../ui/components/message.js';
import { setSettingsEditorValue } from '../ui/components/input-area.js';
import { sourceBlocks } from '../ui/markdown.js';
import { isSendable, isEditable, isThinking } from '../core/roles.js';
import { attachmentsOf } from '../core/attachments.js';
import { nextRange, sameRange, editSlice, applyEdit } from '../core/edit-range.js';
import { ICON_CHECK } from '../ui/icons.js';

/**
 * Every user action, in one registry. Markup references these by name via
 * `data-command`; nothing is bound to `window` and there are no inline
 * `onclick` attributes anywhere.
 *
 * Each command receives `{ event, element, id, index, key, call, block,
 * attachment, files }`, where `call` is the `"round.call"` position of a tool
 * call inside a thinking message, `block` the index of a markdown block inside
 * a message body, `attachment` the index of an image among a message's
 * attachments, and `files` the files of a paste or drop.
 */

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Back to the transcript from the settings view. */
function leaveSettings(patch = {}) {
  setSession({
    view: 'chat',
    activeSettingKey: null,
    settingsDraft: null,
    editingThinking: false,
    ...patch,
  });
}

/** The session fields of an edit's selected blocks, cleared. */
const NO_EDIT_RANGE = { editingRange: null, editingSource: null, editingLoaded: null };

/**
 * End the edit in progress, if any, without saving. The row is repainted in
 * place (`anchored`), so the transcript does not move.
 */
function stopEditing() {
  const index = state.session.editingMessageIndex;
  if (index === null) return;
  setSession({ editingMessageIndex: null, ...NO_EDIT_RANGE }, { silent: true });
  const input = $('#chat-input');
  if (input) {
    input.value = '';
    input.style.height = state.session.promptHeight;
    input.style.whiteSpace = '';
    input.style.overflowX = '';
  }
  emit(EVENTS.MESSAGE, { index, anchored: true });
  emit(EVENTS.EDIT);
}

/** Whether the composer holds text the edit has not saved. */
function hasUnsavedEdit() {
  const value = $('#chat-input')?.value ?? '';
  const loaded = state.session.editingLoaded;
  return loaded === null ? value !== '' : value !== loaded;
}

/** True when there is nothing to lose, or the user agrees to lose it. */
function confirmDiscard() {
  return !hasUnsavedEdit() || confirm('Discard your changes to the part being edited?');
}

/**
 * Make `range` (a run of blocks) the part of `message` being edited: remember
 * it against the content it was taken from, and load its source into the
 * composer.
 */
function loadEditRange(message, range) {
  const content = message.content || '';
  const slice = editSlice(content, sourceBlocks(content), range);
  if (!slice) return;

  setSession(
    { editingRange: range, editingSource: content, editingLoaded: slice.body },
    { silent: true },
  );

  const input = $('#chat-input');
  if (input) {
    input.value = slice.body;
    input.scrollTop = 0;
  }
  // Rendered first: the composer is read-only until a block is selected.
  emit(EVENTS.EDIT);
  input?.focus({ preventScroll: true });
}

/**
 * Nothing selected any more: the edit stays open, back where it was when it
 * started, with an empty read-only composer waiting for a pick.
 */
function clearEditRange() {
  setSession(NO_EDIT_RANGE, { silent: true });
  const input = $('#chat-input');
  if (input) {
    input.value = '';
    input.scrollTop = 0;
  }
  emit(EVENTS.EDIT);
}

/** Open the advanced settings, or close them if they are open. */
function toggleSettings() {
  if (state.session.view === 'settings') {
    leaveSettings();
    return;
  }
  stopEditing();
  setSession({
    view: 'settings',
    activeSettingKey: null,
    settingsDraft: null,
    editingThinking: false,
  });
}

function collapseSidebarOnMobile() {
  if (window.innerWidth <= 768 && !state.session.sidebarHidden) {
    setSession({ sidebarHidden: true }, { silent: true });
    persistPrefs();
  }
}

/** Replace the images waiting in the composer. */
function setPendingAttachments(list) {
  setSession({ pendingAttachments: list }, { silent: true });
  emit(EVENTS.COMPOSER);
}

/**
 * Before a request built from `messages` goes out: if any image in them is
 * only a placeholder, say so, and let the user back out to restore it.
 *
 * Asked once per set of placeholders: once the user agrees, those images are
 * not asked about again this session. Only a placeholder they have not agreed
 * to yet brings the warning back. Resolves with whether to go ahead.
 */
async function confirmPlaceholders(messages) {
  const { missing, hashes, unconfirmed } = await images.placeholdersToConfirm(messages);
  if (!unconfirmed.length) return true;

  const count = missing.length;
  const subject =
    count === 1
      ? 'An image in this chat is only a placeholder'
      : `${count} images in this chat are only placeholders`;
  const fresh =
    unconfirmed.length < hashes.length
      ? ` (${unconfirmed.length} new since you last confirmed)`
      : '';
  const them = count === 1 ? 'it' : 'them';

  const proceed = confirm(
    `${subject}${fresh}: the original is no longer stored.\n\n` +
      `Unless you restore ${them} first (open the attachments and click the placeholder), ` +
      `the pixelated placeholder, scaled up to the original size, will be sent instead.\n\n` +
      'Send anyway?',
  );
  if (proceed) images.acknowledgePlaceholders(hashes);
  return proceed;
}

/** The attachment at `at` of message `index`, if it still exists. */
function attachmentAt(index, at) {
  return attachmentsOf(currentChat()?.messages[index])[at] || null;
}

/** Whether `index` and `at` address an image of the message being edited. */
function isEditedAttachment(index, at) {
  return (
    Number.isInteger(index) &&
    Number.isInteger(at) &&
    state.session.editingMessageIndex === index &&
    Boolean(attachmentAt(index, at))
  );
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

export const commands = {
  /* ---- chrome ---- */

  'ui.toggleSidebar': () => {
    setSession({ sidebarHidden: !state.session.sidebarHidden });
    persistPrefs();
  },

  'ui.toggleTitle': () => {
    setSession({ titleHidden: !state.session.titleHidden });
    persistPrefs();
  },

  'ui.toggleTheme': () => {
    setSession({ theme: state.session.theme === 'dark' ? 'light' : 'dark' });
    persistPrefs();
  },

  /* ---- chats ---- */

  'chat.new': async ({ event } = {}) => {
    if (event?.altKey) return commands['chat.import']();
    stopEditing();
    leaveSettings();
    await conversation.createChat();
    collapseSidebarOnMobile();
    $('#chat-input')?.focus();
    return undefined;
  },

  'chat.open': async ({ event, id }) => {
    if (event?.altKey) {
      event.preventDefault();
      transfer.exportChat(id);
      return;
    }
    if (event?.ctrlKey || event?.metaKey) {
      event.preventDefault();
      commands['chat.copyTranscript']({ id, element: event.target });
      return;
    }
    stopEditing();
    leaveSettings();
    await conversation.openChat(id);
    collapseSidebarOnMobile();
  },

  'chat.copyTranscript': ({ id, element }) => {
    const chat = state.data.chats.find((entry) => entry.id === id);
    if (!chat) return;

    // The transcript is the conversation as the model sees it: no errors and
    // no reasoning, but tool calls, their results and the text written
    // alongside them included. A thinking message with none of those
    // contributes nothing.
    const body = chat.messages
      .filter(isSendable)
      .map((message) => ({ message, text: messageMarkdown(message, { reasoning: false }) }))
      .filter(({ message, text }) => text || !isThinking(message))
      .map(({ message, text }) => {
        const label = isThinking(message) ? 'TOOLS' : message.role.toUpperCase();
        return `## ${label}\n${text}\n\n`;
      })
      .join('');

    navigator.clipboard.writeText(`# ${chat.title}\n\n${body}`.trim()).then(() => {
      const item = element?.closest('.chat-item');
      if (!item) return;
      item.classList.add('flash');
      setTimeout(() => item.classList.remove('flash'), 150);
    });
  },

  'chat.rename': async ({ id }) => {
    const chat = state.data.chats.find((entry) => entry.id === id);
    if (!chat) return;
    const title = prompt('Rename chat:', chat.title);
    if (title) await conversation.renameChat(id, title);
  },

  'chat.delete': async ({ id }) => {
    stopEditing();
    leaveSettings();
    await conversation.removeChat(id);
  },

  'chat.export': () => transfer.exportAllChats(),

  'chat.import': async () => {
    const text = await pickJSONText();
    if (!text) return;
    try {
      const added = await transfer.importChats(text);
      alert(`Successfully imported ${added} new chat(s).`);
    } catch (error) {
      alert(`Failed to import chats: ${error.message}`);
    }
  },

  /* ---- composing ---- */

  'chat.send': async ({ event } = {}) => {
    if (state.runtime.generation.active) {
      conversation.abortGeneration();
      return;
    }
    const input = $('#chat-input');
    if (!input) return;
    const text = input.value ?? '';
    const pending = state.session.pendingAttachments || [];
    if (!text.trim() && !pending.length) return;

    // Shift+Send never reaches the API, so nothing is sent as a placeholder.
    const skipApi = Boolean(event?.shiftKey);
    if (!skipApi && !(await confirmPlaceholders(currentChat()?.messages || []))) return;

    input.value = '';
    setPendingAttachments([]);
    try {
      await conversation.sendMessage({ text, attachments: pending, skipApi });
    } catch (error) {
      input.value = text;
      setPendingAttachments(pending);
      alert(error.message);
    }
  },

  /* ---- attachments ---- */

  /**
   * Images pasted or dropped. While a message is being edited they are added
   * to it; otherwise they wait in the composer for the next send.
   */
  'attachments.add': async ({ files } = {}) => {
    if (state.session.view !== 'chat') return;
    const list = [...(files || [])].filter(images.isImageFile);
    if (!list.length) return;

    const { records, errors } = await images.ingestImages(list);
    if (errors.length) alert(errors.join('\n'));
    if (!records.length) return;

    const index = state.session.editingMessageIndex;
    if (index !== null) {
      await conversation.addAttachments(index, records);
      return;
    }
    setPendingAttachments([...(state.session.pendingAttachments || []), ...records]);
  },

  'attachments.removePending': ({ key }) => {
    const at = Number.parseInt(key, 10);
    const list = state.session.pendingAttachments || [];
    if (!Number.isInteger(at) || !list[at]) return;
    setPendingAttachments(list.filter((_, i) => i !== at));
  },

  /** Remove an image from the message being edited. */
  'attachments.remove': async ({ index, attachment }) => {
    if (!isEditedAttachment(index, attachment)) return;
    await conversation.removeAttachment(index, attachment);
  },

  /**
   * Move an image of the message being edited one place earlier (`key` -1)
   * or later (`key` 1).
   */
  'attachments.move': async ({ index, attachment: at, key }) => {
    const step = Number.parseInt(key, 10);
    if (step !== -1 && step !== 1) return;
    if (!isEditedAttachment(index, at)) return;
    await conversation.moveAttachment(index, at, at + step);
  },

  /**
   * A click on an image of the message being edited: pick one file and put
   * it in that image's place, for good. Replacing is the point, so there is
   * no warning when the file is a different image; picking the image's own
   * original simply restores it.
   */
  'attachments.replace': async ({ index, attachment: at }) => {
    if (!isEditedAttachment(index, at)) return;
    const target = attachmentAt(index, at);

    const [file] = await pickFiles({ multiple: false, accept: 'image/*' });
    if (!file) return;

    let record;
    try {
      record = await images.ingestImage(file);
    } catch (error) {
      alert(error.message);
      return;
    }

    // The message may have changed, or the edit ended, while the picker was open.
    if (state.session.editingMessageIndex !== index) return;
    const current = attachmentAt(index, at);
    if (!current || current.hash !== target.hash) return;
    await conversation.replaceAttachment(index, at, record);
  },

  /**
   * A click on a placeholder (outside edit mode): pick files to bring back
   * originals.
   *
   *   - Several files: each is matched to placeholders by hash, across every
   *     chat. Files that match nothing are ignored; if none match, nothing
   *     is replaced at all.
   *   - One file: if it is this placeholder's original, it is restored. If
   *     not, the user is warned, and may use it anyway: the attachment then
   *     becomes that image, for good.
   */
  'attachments.restore': async ({ index, attachment: at }) => {
    const target = attachmentAt(index, at);
    if (!target || images.imageUrlFor(target.hash)) return;

    const files = await pickFiles({ multiple: true, accept: 'image/*' });
    if (!files.length) return;

    if (files.length > 1) {
      const { matches, unmatched } = await images.matchImageFiles(files, images.placeholderHashes());
      if (!matches.size) {
        alert('None of the selected images is the original of a placeholder, so nothing was replaced.');
        return;
      }
      images.restoreOriginals(matches);
      if (unmatched.length) {
        alert(
          `Restored ${matches.size} image(s). ${unmatched.length} of the selected images ` +
            'matched no placeholder and were ignored.',
        );
      }
      return;
    }

    const [file] = files;
    const { matches } = await images.matchImageFiles([file], [target.hash]);
    if (matches.size) {
      images.restoreOriginals(matches);
      return;
    }

    const proceed = confirm(
      `"${file.name}" is not the original of this placeholder: its contents differ.\n\n` +
        'Use it anyway? The placeholder will be replaced by this image permanently.',
    );
    if (!proceed) return;

    let record;
    try {
      record = await images.ingestImage(file);
    } catch (error) {
      alert(error.message);
      return;
    }

    // The chat may have changed while the picker was open.
    const current = attachmentAt(index, at);
    if (!current || current.hash !== target.hash) return;
    await conversation.replaceAttachment(index, at, record);
  },

  /* ---- messages ---- */

  'message.copy': ({ index, element }) => {
    const message = currentChat()?.messages[index];
    if (!message) return;

    const textToCopy = messageMarkdown(message);
    if (!textToCopy) return;

    navigator.clipboard.writeText(textToCopy).then(() => {
      if (!element) return;
      const originalHTML = element.innerHTML;

      if (element.classList.contains('icon-btn')) {
        element.innerHTML = ICON_CHECK;
      } else {
        element.textContent = 'Copied';
      }

      setTimeout(() => {
        element.innerHTML = originalHTML;
      }, 1500);
    });
  },

  /**
   * Enter edit mode. Nothing in the transcript moves; only the row's buttons
   * change. The user then clicks the block of the message to edit, and may
   * Shift+Click another to extend the selection to it (see
   * `message.selectBlock`). A message with no blocks to click (an empty one)
   * is loaded whole straight away.
   */
  'message.edit': ({ index }) => {
    const chat = currentChat();
    const message = chat?.messages[index];
    // A thinking message is structured rounds, not text the composer could hold.
    if (!message || !isEditable(message)) return;

    const previous = state.session.editingMessageIndex;
    if (previous === index) return;
    if (previous !== null && !confirmDiscard()) return;

    stopEditing();
    setSession(
      { editingMessageIndex: index, editingThinking: false, ...NO_EDIT_RANGE },
      { silent: true },
    );
    // A text selection left over from before the edit would otherwise stay
    // highlighted across the transcript while a block is being picked.
    window.getSelection()?.removeAllRanges();
    emit(EVENTS.MESSAGE, { index, anchored: true });

    const input = $('#chat-input');
    if (input) input.value = '';

    if (!sourceBlocks(message.content).length) {
      loadEditRange(message, { start: 0, end: 0, anchor: 0 });
      return;
    }
    emit(EVENTS.EDIT);
  },

  /**
   * A click on block `block` of the message being edited.
   *
   *   - A plain click selects that block alone (replacing any selection), or
   *     deselects it if it was the only one selected, returning the edit to
   *     picking.
   *   - A Shift+Click while something is selected selects every block from
   *     the one first clicked to this one, both included.
   *
   * See `nextRange`. A click that leaves the selection as it was does nothing,
   * so it cannot throw away text typed into the composer.
   */
  'message.selectBlock': ({ event, index, block }) => {
    if (index !== state.session.editingMessageIndex || !Number.isInteger(block)) return;
    const message = currentChat()?.messages[index];
    if (!message) return;

    const content = message.content || '';
    const blocks = sourceBlocks(content);
    if (block < 0 || block >= blocks.length) return;

    // A selection made on different text says nothing about this one.
    const current = state.session.editingSource === content ? state.session.editingRange : null;
    const range = nextRange(current, block, { extend: Boolean(event?.shiftKey) });
    if (range && sameRange(current, range)) return;

    if (!confirmDiscard()) return;
    if (range) loadEditRange(message, range);
    else clearEditRange();
  },

  /**
   * Splice the composer's text back in place of the selected blocks. With
   * nothing selected there is nothing to save, and the edit just ends. If the
   * message changed after the blocks were picked, the offsets no longer mean
   * anything: nothing is written, the text stays in the composer, and the user
   * picks again. Resolves with whether the edit ended.
   */
  'message.saveEdit': async () => {
    const index = state.session.editingMessageIndex;
    if (index === null) return false;
    const message = currentChat()?.messages[index];
    if (!message) return false;

    const { editingRange: range, editingSource: source } = state.session;

    if (!range) {
      if (!confirmDiscard()) return false;
      stopEditing();
      return true;
    }

    const content = message.content || '';
    if (content !== source) {
      setSession(NO_EDIT_RANGE, { silent: true });
      emit(EVENTS.EDIT);
      alert(
        'This message changed while you were editing it, so your edit was not saved. ' +
          'Your text is still in the composer; select the part to edit again.',
      );
      return false;
    }

    const slice = editSlice(content, sourceBlocks(content), range);
    if (!slice) return false;

    const next = applyEdit(slice, $('#chat-input')?.value ?? '');
    if (next !== content) await conversation.updateMessage(index, { content: next });

    stopEditing();
    return true;
  },

  /**
   * Save the edit and immediately regenerate from it: everything after the
   * message is dropped and the edited text is resent.
   */
  'message.retryEdit': async () => {
    const index = state.session.editingMessageIndex;
    if (index === null) return;

    const saved = await commands['message.saveEdit']();
    if (!saved) return;

    // Roles that cannot start a turn just get the save.
    const message = currentChat()?.messages[index];
    if (!isRetryable(message)) return;

    await commands['message.retry']({ index });
  },

  'message.cancelEdit': () => {
    stopEditing();
  },

  'message.toggleWrap': () => {
    const input = $('#chat-input');
    if (!input) return;
    const wrapped = input.style.whiteSpace === 'pre';
    input.style.whiteSpace = wrapped ? 'pre-wrap' : 'pre';
    input.style.overflowX = wrapped ? 'hidden' : 'auto';
  },

  /** Expand or collapse a thinking message. */
  'message.toggleCollapsed': async ({ index }) => {
    const message = currentChat()?.messages[index];
    if (!message) return;
    await conversation.setCollapsed(index, !isCollapsed(message));
  },

  /** Expand or collapse one call inside a thinking message. */
  'message.toggleCall': async ({ index, call }) => {
    if (!Number.isInteger(index) || !call) return;
    await conversation.toggleCallCollapsed(index, call);
  },

  /** Open or close a message's attachments. */
  'message.toggleAttachments': async ({ index }) => {
    const message = currentChat()?.messages[index];
    if (!message) return;
    await conversation.setAttachmentsOpen(index, message.attachmentsOpen !== true);
  },

  'message.fork': async ({ index }) => {
    stopEditing();
    leaveSettings();
    await conversation.forkChat(index);
  },

  'message.retry': async ({ index }) => {
    const chat = currentChat();
    const message = chat?.messages[index];
    if (!isRetryable(message)) return;

    // Everything up to and including this message is what gets sent.
    if (!(await confirmPlaceholders(chat.messages.slice(0, index + 1)))) return;

    stopEditing();

    if (message.role === 'user') {
      const input = $('#chat-input');
      const text = message.content || '';
      const attachments = attachmentsOf(message);
      // A user message replaces itself and everything after it.
      await conversation.truncateMessages(index);
      if (input) input.value = '';
      try {
        await conversation.sendMessage({ text, attachments });
      } catch (error) {
        if (input) input.value = text;
        if (attachments.length) setPendingAttachments(attachments);
        alert(error.message);
      }
    } else if (isThinking(message)) {
      // A thinking message continues where it left off: it is kept, everything
      // AFTER it is dropped, and the turn resumes it.
      await conversation.truncateMessages(index + 1);
      try {
        await conversation.regenerate();
      } catch (error) {
        alert(error.message);
      }
    }
  },

  'message.delete': async ({ index }) => {
    if (state.session.editingMessageIndex === index) {
      stopEditing();
    } else if (
      state.session.editingMessageIndex !== null &&
      state.session.editingMessageIndex > index
    ) {
      setSession({ editingMessageIndex: state.session.editingMessageIndex - 1 }, { silent: true });
    }
    await conversation.deleteMessage(index);
  },

  'message.setRole': async ({ index, element }) => {
    await conversation.updateMessage(index, { role: element.value });
  },

  /* ---- settings ---- */

  'settings.saveConnection': async () => {
    await settings.saveConnectionConfig({
      url: $('#cfg-url').value.trim(),
      key: $('#cfg-key').value.trim(),
      jsExecution: $('#cfg-js-exec').checked,
    });
    invalidateContext();
    await models.refreshModels();
  },

  'settings.setModel': ({ element }) => {
    if (state.session.editingThinking) {
      state.data.config.reasoningEffort = element.value;
      persistConfig();
    } else {
      settings.setActiveModel(element.value);
    }
  },

  'settings.toggle': async ({ event } = {}) => {
    if (event && !(event.ctrlKey || event.metaKey)) return;
    event?.preventDefault();
    toggleSettings();
  },

  'settings.select': ({ key }) => {
    const value = settings.readEditorValue(key);
    setSession({ activeSettingKey: key, settingsDraft: value });
    setSettingsEditorValue(value);
    $('#settings-input')?.focus();
  },

  'settings.save': async () => {
    const { activeSettingKey } = state.session;
    if (!activeSettingKey) return;
    const value = $('#settings-input')?.value ?? '';
    await settings.saveSetting(activeSettingKey, value);
    setSession({ activeSettingKey: null, settingsDraft: null });
  },

  'settings.reset': async () => {
    const { activeSettingKey } = state.session;
    if (!activeSettingKey) return;
    await settings.resetSetting(activeSettingKey);
    setSession({ activeSettingKey: null, settingsDraft: null });
  },

  'settings.cancel': () => {
    setSession({ activeSettingKey: null, settingsDraft: null });
  },

  'settings.resetAll': async () => {
    if (!confirm('Reset ALL Advanced parameters to default?')) return;
    await settings.resetAllSettings();
    setSession({ activeSettingKey: null, settingsDraft: null });
  },

  'settings.close': () => leaveSettings(),

  /* ---- thinking levels ---- */

  'thinking.edit': () => {
    stopEditing();
    setSession({ editingThinking: true });
    const input = $('#thinking-input');
    if (input) {
      input.value = state.data.config.availableReasoningLevels || 'none\nlow\nmedium\nhigh';
      input.focus();
    }
  },

  'thinking.save': async () => {
    const input = $('#thinking-input');
    if (input) {
      state.data.config.availableReasoningLevels = input.value.trim();
      await persistConfig();
    }
    setSession({ editingThinking: false });
  },

  'thinking.cancel': () => {
    setSession({ editingThinking: false });
  },
};

export function runCommand(name, context = {}) {
  const command = commands[name];
  if (!command) {
    console.warn(`Unknown command: ${name}`);
    return undefined;
  }
  return Promise.resolve(command(context)).catch((error) => {
    console.error(`Command "${name}" failed:`, error);
  });
}
