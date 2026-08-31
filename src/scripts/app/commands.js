import { $ } from '../ui/dom.js';
import { EVENTS } from '../store/events.js';
import {
  state,
  emit,
  currentChat,
  findFile,
  setSession,
  persistPrefs,
  invalidateContext,
  isEmbedding,
} from '../store/state.js';
import * as conversation from '../services/conversation.js';
import * as library from '../services/file-library.js';
import * as settings from '../services/settings.js';
import * as transfer from '../services/transfer.js';
import * as embedding from '../services/embedding.js';
import { retrieveChunks, wrapFileContent } from '../services/retrieval.js';
import { pickFiles, readFileText, pickJSONText } from '../services/file-io.js';
import { setMessageBusy } from '../ui/components/message.js';
import { setSettingsEditorValue } from '../ui/components/input-area.js';
import { renderMainView } from '../ui/bindings.js';
import { estimateTokens } from '../core/tokens.js';
import { pickNumber } from '../core/values.js';
import { ICON_CHECK } from '../ui/icons.js';

/**
 * Every user action, in one registry. Markup references these by name via
 * `data-command`; nothing is bound to `window` and there are no inline
 * `onclick` attributes anywhere.
 *
 * Each command receives `{ event, element, id, index, key }`.
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

    const body = chat.messages
      .filter((message) => message.role !== 'error')
      .filter((message) => !(message.role === 'file' && message.mode === 'embed'))
      .map((message) => {
        const label = message.role === 'file' ? 'USER' : message.role.toUpperCase();
        return `## ${label}\n${message.content || ''}\n\n`;
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
    const chat = currentChat();
    const message = chat?.messages[index];
    if (!message) return;

    let textToCopy = message.content || '';
    if (message.role === 'file' && message.mode === 'embed') {
      textToCopy = message.prompt || '';
    }

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
    if (!message) return;

    const previous = state.session.editingMessageIndex;
    setSession({ editingMessageIndex: index }, { silent: true });

    if (previous !== null && previous !== index) emit(EVENTS.MESSAGE, { index: previous });
    emit(EVENTS.MESSAGE, { index });

    const input = $('#chat-input');
    if (input) {
      input.value = message.role === 'file' && message.mode === 'embed'
        ? message.prompt || ''
        : message.content || '';
      input.focus();
    }
    emit(EVENTS.SESSION);
  },

  'message.saveEdit': async () => {
    const index = state.session.editingMessageIndex;
    if (index === null) return;

    const chat = currentChat();
    const message = chat?.messages[index];
    if (!message) return;

    const value = $('#chat-input')?.value ?? '';

    if (message.role === 'file' && message.mode === 'embed') {
      const tokensInput = document.querySelector(
        `.msg[data-index="${index}"] .embed-cfg-tokens`,
      );
      const thresholdInput = document.querySelector(
        `.msg[data-index="${index}"] .embed-cfg-threshold`,
      );
      await conversation.updateMessage(index, {
        prompt: value,
        maxTokens: pickNumber(5000, tokensInput?.value),
        ragThreshold: pickNumber(0, thresholdInput?.value),
      });
    } else if (message.role === 'file') {
      await conversation.updateMessage(index, {
        content: value,
        approxTokens: estimateTokens(value),
      });
    } else {
      await conversation.updateMessage(index, { content: value });
    }

    stopEditing();
    emit(EVENTS.SESSION);
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

  'message.fork': async ({ index }) => {
    stopEditing();
    leaveSettings();
    await conversation.forkChat(index);
  },

  'message.retry': async ({ index }) => {
    const chat = currentChat();
    const message = chat?.messages[index];
    if (!message) return;

    stopEditing();

    if (message.role === 'file') {
      await conversation.truncateMessages(index + 1);
      await conversation.sendMessage({ loopDepth: 1 });
      return;
    }

    const input = $('#chat-input');
    const text = message.content || '';
    await conversation.truncateMessages(index);
    if (input) input.value = '';
    try {
      await conversation.sendMessage({ text });
    } catch (error) {
      if (input) input.value = text;
      alert(error.message);
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

  'message.runEmbed': async ({ index }) => {
    const chat = currentChat();
    const chatId = state.data.currentChatId;
    const message = chat?.messages[index];
    if (!message || message.role !== 'file' || message.mode !== 'embed') return;

    const restore = setMessageBusy(index, 'message.runEmbed', 'Embedding...');

    try {
      // Fall back to the following user messages when no explicit prompt is set.
      let prompt = (message.prompt || '').trim();
      if (!prompt) {
        const lookahead = [];
        for (let i = index + 1; i < chat.messages.length; i++) {
          const next = chat.messages[i];
          if (next.role === 'assistant') break;
          if (next.role === 'user' && next.content) lookahead.push(next.content);
        }
        prompt = lookahead.join('\n').trim();
      }

      const content = await retrieveChunks({
        fileId: message.fileId,
        prompt,
        maxTokens: message.maxTokens,
        threshold: message.ragThreshold,
      });

      const meta = findFile(message.fileId);
      const wrapped = await wrapFileContent(meta, content, message.fileName);

      // Append to the chat this started in, not whichever is current now.
      await conversation.appendMessage({ role: 'user', content: wrapped }, { chatId });
    } catch (error) {
      alert(`Error fetching embeddings: ${error.message}`);
    } finally {
      restore();
    }
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

  'file.insert': async ({ event, id }) => {
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
    stopEditing();
    leaveSettings();
    if (!state.data.currentChatId) await conversation.createChat();
    await library.insertFileMessage(id, 'full');
    collapseSidebarOnMobile();
  },

  'file.insertEmbed': async ({ event, id }) => {
    if (event?.ctrlKey || event?.metaKey) {
      event.preventDefault();
      await openSettingsScope('file-settings', id);
      return;
    }
    const meta = findFile(id);
    if (!meta || (meta.progress ?? 0) < 100) return;
    stopEditing();
    leaveSettings();
    if (!state.data.currentChatId) await conversation.createChat();
    await library.insertFileMessage(id, 'embed');
    collapseSidebarOnMobile();
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
    if (!state.data.config.embeddingsModel?.trim()) {
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
      models: $('#cfg-models').value.trim(),
      godMode: $('#cfg-godmode').checked,
    });
    invalidateContext();
    alert('Settings saved.');
  },

  'settings.setModel': ({ element }) => settings.setActiveModel(element.value),

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
