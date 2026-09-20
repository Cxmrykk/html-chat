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
import { isSendable, isEditable, isTools } from '../core/roles.js';
import { ICON_CHECK } from '../ui/icons.js';

/**
 * Every user action, in one registry. Markup references these by name via
 * `data-command`; nothing is bound to `window` and there are no inline
 * `onclick` attributes anywhere.
 *
 * Each command receives `{ event, element, id, index, key, call }`, where
 * `call` is the `"round.call"` position of a tool call inside a tools box.
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

function stopEditing() {
  const index = state.session.editingMessageIndex;
  if (index === null) return;
  setSession({ editingMessageIndex: null }, { silent: true });
  const input = $('#chat-input');
  if (input) {
    input.value = '';
    input.style.height = state.session.promptHeight;
    input.style.whiteSpace = '';
    input.style.overflowX = '';
  }
  emit(EVENTS.MESSAGE, { index });
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
    // no thinking, but tool calls and their results included.
    const body = chat.messages
      .filter(isSendable)
      .map((message) => `## ${message.role.toUpperCase()}\n${messageMarkdown(message)}\n\n`)
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

  'message.edit': ({ index }) => {
    const chat = currentChat();
    const message = chat?.messages[index];
    // A tools box is structured calls, not text the composer could hold.
    if (!message || !isEditable(message)) return;

    const previous = state.session.editingMessageIndex;
    setSession({ editingMessageIndex: index, editingThinking: false }, { silent: true });

    if (previous !== null && previous !== index) emit(EVENTS.MESSAGE, { index: previous });
    emit(EVENTS.MESSAGE, { index });

    const input = $('#chat-input');
    if (input) {
      input.value = message.content || '';
      input.focus();
    }
    emit(EVENTS.SESSION);
  },

  'message.saveEdit': async () => {
    const index = state.session.editingMessageIndex;
    if (index === null) return;
    if (!currentChat()?.messages[index]) return;

    await conversation.updateMessage(index, { content: $('#chat-input')?.value ?? '' });

    stopEditing();
    emit(EVENTS.SESSION);
  },

  /**
   * Save the edit and immediately regenerate from it: everything after the
   * message is dropped and the edited text is resent.
   */
  'message.retryEdit': async () => {
    const index = state.session.editingMessageIndex;
    if (index === null) return;

    await commands['message.saveEdit']();

    // Roles that cannot start a turn just get the save.
    const message = currentChat()?.messages[index];
    if (!isRetryable(message)) return;

    await commands['message.retry']({ index });
  },

  'message.cancelEdit': () => {
    stopEditing();
    emit(EVENTS.SESSION);
  },

  'message.toggleWrap': () => {
    const input = $('#chat-input');
    if (!input) return;
    const wrapped = input.style.whiteSpace === 'pre';
    input.style.whiteSpace = wrapped ? 'pre-wrap' : 'pre';
    input.style.overflowX = wrapped ? 'hidden' : 'auto';
  },

  /** Expand or collapse a thinking box. */
  'message.toggleCollapsed': async ({ index }) => {
    const message = currentChat()?.messages[index];
    if (!message) return;
    await conversation.setCollapsed(index, !isCollapsed(message));
  },

  /** Expand or collapse one call inside a tools box. */
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
    } else if (isTools(message)) {
      // A tools message continues where it left off, so we keep it and truncate everything AFTER it.
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
    setSession({ editingThinking: true, editingMessageIndex: null });
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
