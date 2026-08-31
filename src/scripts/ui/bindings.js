import { on } from '../store/state.js';
import { EVENTS } from '../store/events.js';
import { state, currentChat } from '../store/state.js';
import { renderChatList } from './components/chat-list.js';
import { renderFileList, updateFileProgress } from './components/file-list.js';
import { replaceMessage, updateMessageContent } from './components/message.js';
import {
  renderInputArea,
  renderSendButton,
  renderSettingsEditor,
  renderEmbeddingToggle,
  applyChromeState,
  updateModelDropdown,
} from './components/input-area.js';
import { renderChatView, appendMessageToView, scrollToMessage } from './views/chat-view.js';
import { renderSettingsView } from './views/settings-view.js';

/** Declarative event bindings mapping store events to UI renders. */

export function renderMainView({ preserveScroll = false } = {}) {
  if (state.session.view === 'chat') {
    renderChatView({ preserveScroll });
  } else {
    renderSettingsView();
  }
}

export function renderAll() {
  updateModelDropdown();
  applyChromeState();
  renderChatList();
  renderFileList();
  renderMainView();
  renderInputArea();
}

export function installBindings() {
  on(EVENTS.CHATS, () => {
    renderChatList();
  });

  on(EVENTS.MESSAGES, () => {
    if (state.session.view === 'chat') renderChatView();
    renderInputArea();
  });

  on(EVENTS.MESSAGES_TRUNCATED, ({ length }) => {
    if (state.session.view !== 'chat') return;
    const container = $('#chat-container');
    if (container) {
      const messages = container.querySelectorAll('.msg');
      for (let i = length; i < messages.length; i++) {
        messages[i].remove();
      }
    }
    renderInputArea();
  });

  on(EVENTS.MESSAGE, ({ index, streaming }) => {
    if (state.session.view !== 'chat') return;
    const chat = currentChat();
    const message = chat?.messages[index];
    if (!message) return;

    if (streaming) {
      updateMessageContent(index, message.content, { final: false });
      return;
    }
    replaceMessage(message, index, {
      editing: state.session.editingMessageIndex === index,
    });
  });

  on(EVENTS.MESSAGE_APPENDED, ({ index }) => {
    if (state.session.view !== 'chat') return;
    const chat = currentChat();
    const message = chat?.messages[index];
    if (message) appendMessageToView(message, index);
    renderSendButton();
  });

  on(EVENTS.FILES, () => {
    renderFileList();
    if (state.session.view === 'file-settings') renderSettingsView();
  });

  on(EVENTS.FILE_PROGRESS, ({ id }) => {
    updateFileProgress(id);
    renderEmbeddingToggle(id);
  });

  on(EVENTS.SESSION, () => {
    applyChromeState();
    renderMainView();
    renderInputArea();
  });

  on(EVENTS.GENERATION, () => {
    renderSendButton();
  });

  on(EVENTS.CONTEXT, () => {
    renderSendButton();
  });

  on(EVENTS.HOOK_ERROR, ({ key, error }) => {
    console.error(`[${key}]`, error);
  });

  on(EVENTS.SESSION, renderSettingsEditor);

  return { scrollToMessage };
}
