import { $ } from '../ui/dom.js';
import { EVENTS } from '../store/events.js';
import {
  state,
  emit,
  currentChat,
  findFile,
  setSession,
  persistPrefs,
  persistConfig,
  invalidateContext,
  isEmbedding,
  embeddingsEnabled,
} from '../store/state.js';
import * as conversation from '../services/conversation.js';
import * as library from '../services/file-library.js';
import * as settings from '../services/settings.js';
import * as transfer from '../services/transfer.js';
import * as embedding from '../services/embedding.js';
import * as models from '../services/models.js';
import { pickFiles, readFileText, pickJSONText } from '../services/file-io.js';
import { isRetryable, isCollapsed, messageMarkdown } from '../ui/components/message.js';
import { setSettingsEditorValue } from '../ui/components/input-area.js';
import { renderMainView } from '../ui/bindings.js';
import { sourceBlocks } from '../ui/markdown.js';
import { isSendable, isEditable, isThinking } from '../core/roles.js';
import { nextRange, editSlice, applyEdit } from '../core/edit-range.js';
import { ICON_CHECK } from '../ui/icons.js';

/**
 * Every user action, in one registry. Markup references these by name via
 * `data-command`; nothing is bound to `window` and there are no inline
 * `onclick` attributes anywhere.
 *
 * Each command receives `{ event, element, id, index, key, call, block }`,
 * where `call` is the `"round.call"` position of a tool call inside a thinking
 * message and `block` the index of a markdown block inside a message body.
 */

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function leaveSettings(patch = {}) {
  setSession({
    view: 'chat',
    activeSettingKey: null,
    activeFileId: null,
    settingsDraft: null,
    editingThinking: false,
    ...patch,
  });
}

/** The session fields of an edit's selected part, cleared. */
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
 * Make `range` the part of `message` being edited: remember it against the
 * content it was taken from, and load its source into the composer.
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
  // Rendered first: the composer is read-only until a range exists.
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

async function openSettingsScope(view, fileId = null) {
  const sameTarget = state.session.view === view && state.session.activeFileId === fileId;
  if (sameTarget) {
    leaveSettings();
    return;
  }
  stopEditing();
  setSession({
    view,
    activeFileId: fileId,
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
    const text = input?.value ?? '';
    if (!text.trim()) return;

    input.value = '';
    try {
      await conversation.sendMessage({ text, skipApi: Boolean(event?.shiftKey) });
    } catch (error) {
      input.value = text;
      alert(error.message);
    }
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
   * change. The user then clicks the part of the message to edit (see
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
    // highlighted across the transcript while parts are being picked.
    window.getSelection()?.removeAllRanges();
    emit(EVENTS.MESSAGE, { index, anchored: true });

    const input = $('#chat-input');
    if (input) input.value = '';

    if (!sourceBlocks(message.content).length) {
      loadEditRange(message, { start: 0, end: 0 });
      return;
    }
    emit(EVENTS.EDIT);
  },

  /**
   * A click on block `block` of the message being edited. Outside the
   * selection it grows the selection to reach it. Inside a selection of one
   * or two blocks it toggles that block. Inside a longer one it keeps only
   * what lies below the clicked block (Shift: above it). See `nextRange`. A
   * click that leaves nothing selected returns the edit to picking.
   */
  'message.selectBlock': ({ index, block, event }) => {
    if (index !== state.session.editingMessageIndex || !Number.isInteger(block)) return;
    const message = currentChat()?.messages[index];
    if (!message) return;

    const content = message.content || '';
    const blocks = sourceBlocks(content);
    if (block < 0 || block >= blocks.length) return;

    // A range picked on different text says nothing about this one.
    const current = state.session.editingSource === content ? state.session.editingRange : null;
    const range = nextRange(current, block, { fromBottom: Boolean(event?.shiftKey) });
    if (!range && !current) return;
    if (range && current && range.start === current.start && range.end === current.end) return;

    if (!confirmDiscard()) return;
    if (range) loadEditRange(message, range);
    else clearEditRange();
  },

  /**
   * Splice the composer's text back in place of the selected part. With
   * nothing selected there is nothing to save, and the edit just ends. If the
   * message changed after the part was picked, the offsets no longer mean
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

  'message.fork': async ({ index }) => {
    stopEditing();
    leaveSettings();
    await conversation.forkChat(index);
  },

  'message.retry': async ({ index }) => {
    const message = currentChat()?.messages[index];
    if (!isRetryable(message)) return;

    stopEditing();

    if (message.role === 'user') {
      const input = $('#chat-input');
      const text = message.content || '';
      // A user message replaces itself and everything after it.
      await conversation.truncateMessages(index);
      if (input) input.value = '';
      try {
        await conversation.sendMessage({ text });
      } catch (error) {
        if (input) input.value = text;
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

  /* ---- files ---- */

  'file.upload': async () => {
    const files = await pickFiles({ multiple: true });
    for (const file of files) {
      await library.addFile(file.name, await readFileText(file));
    }
  },

  /**
   * Attach a file to the current chat, or detach it. The sidebar stays open on
   * mobile: attaching several files in a row is the common case.
   */
  'file.toggle': async ({ event, id }) => {
    if (event?.ctrlKey || event?.metaKey) {
      event.preventDefault();
      await openSettingsScope('file-settings', id);
      return;
    }
    if (event?.altKey) {
      event.preventDefault();
      const [file] = await pickFiles({ multiple: false });
      if (file) await library.replaceFileContents(id, await readFileText(file));
      return;
    }

    const meta = findFile(id);
    if (!meta) return;

    const attaching = !(currentChat()?.fileIds || []).includes(id);
    if (attaching && !embeddingsEnabled()) {
      alert('Files are searched by embedding. Please configure an embeddings model in Settings first.');
      return;
    }

    // No view change and no transcript re-render: this only flips a marker.
    await conversation.toggleChatFile(id);

    // A file uploaded before the embeddings model was set has never been indexed.
    if (attaching && (meta.progress ?? 0) < 100) embedding.startEmbedding(id);
  },

  'file.delete': async ({ event, id }) => {
    if (event?.ctrlKey || event?.metaKey) {
      event.preventDefault();
      await openSettingsScope('file-settings', id);
      return;
    }
    if (state.session.view === 'file-settings' && state.session.activeFileId === id) {
      leaveSettings();
    }
    await library.deleteFile(id);
  },

  'file.openSettings': async ({ event, id }) => {
    if (!(event?.ctrlKey || event?.metaKey)) return;
    event.preventDefault();
    await openSettingsScope('file-settings', id);
  },

  'file.chunk': async () => {
    const id = state.session.activeFileId;
    if (!id) return;
    try {
      await embedding.generateCustomChunks(id);
      if (state.session.activeSettingKey === 'customChunks') {
        await commands['settings.select']({ key: 'customChunks' });
      } else {
        renderMainView();
      }
    } catch (error) {
      alert(`Error executing customChunker: ${error.message}`);
    }
  },

  'file.toggleEmbed': async () => {
    const id = state.session.activeFileId;
    if (!id) return;
    if (!embeddingsEnabled()) {
      alert('Please configure an embeddings model in Settings first.');
      return;
    }
    await embedding.toggleEmbedding(id);
  },

  'file.exportVectors': async () => {
    const id = state.session.activeFileId;
    if (!id) return;
    try {
      await transfer.exportVectors(id);
    } catch (error) {
      alert(error.message);
    }
  },

  'file.importVectors': async () => {
    const id = state.session.activeFileId;
    if (!id) return;
    const text = await pickJSONText();
    if (!text) return;
    try {
      await transfer.importVectors(id, text);
      if (state.session.activeSettingKey === 'customChunks') {
        await commands['settings.select']({ key: 'customChunks' });
      } else {
        renderMainView();
      }
      alert('Imported chunks and vectors successfully.');
    } catch (error) {
      alert(`Failed to import: ${error.message}`);
    }
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
    await openSettingsScope('settings');
  },

  'settings.select': async ({ key }) => {
    const scope = state.session.view === 'file-settings' ? 'file' : 'global';
    const value = await settings.readEditorValue(scope, key, state.session.activeFileId);
    setSession({ activeSettingKey: key, settingsDraft: value });
    setSettingsEditorValue(value);
    $('#settings-input')?.focus();
  },

  'settings.save': async () => {
    const { activeSettingKey, activeFileId, view } = state.session;
    if (!activeSettingKey) return;
    const scope = view === 'file-settings' ? 'file' : 'global';
    const value = $('#settings-input')?.value ?? '';
    await settings.saveSetting(scope, activeSettingKey, value, activeFileId);
    setSession({ activeSettingKey: null, settingsDraft: null });
  },

  'settings.reset': async () => {
    const { activeSettingKey, activeFileId, view } = state.session;
    if (!activeSettingKey) return;
    const scope = view === 'file-settings' ? 'file' : 'global';
    await settings.resetSetting(scope, activeSettingKey, activeFileId);
    setSession({ activeSettingKey: null, settingsDraft: null });
  },

  'settings.cancel': () => {
    setSession({ activeSettingKey: null, settingsDraft: null });
  },

  'settings.resetAll': async () => {
    const { activeFileId, view } = state.session;
    const scope = view === 'file-settings' ? 'file' : 'global';
    const message = scope === 'file'
      ? 'Reset ALL Advanced RAG parameters to default for this file?'
      : 'Reset ALL Advanced parameters to default?';
    if (!confirm(message)) return;

    await settings.resetAllSettings(scope, activeFileId);
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

export { isEmbedding };
