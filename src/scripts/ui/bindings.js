import { $ } from './dom.js';
import { on } from '../store/state.js';
import { EVENTS } from '../store/events.js';
import { state, currentChat } from '../store/state.js';
import { isModelOutput } from '../core/roles.js';
import { renderChatList } from './components/chat-list.js';
import { renderFileList, updateFileProgress } from './components/file-list.js';
import {
  replaceMessage,
  updateMessageContent,
  hasMessageElement,
  isCollapsed,
} from './components/message.js';
import {
  renderInputArea,
  renderSendButton,
  renderSettingsEditor,
  renderEmbeddingToggle,
  applyChromeState,
  updateModelDropdown,
} from './components/input-area.js';
import {
  renderChatView,
  appendMessageToView,
  scrollToMessage,
  isPinnedToBottom,
  scrollToBottom,
} from './views/chat-view.js';
import { renderSettingsView } from './views/settings-view.js';
import { syncTicker } from './ticker.js';

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

/** Everything that shows which files the current chat may search. */
function renderChatFiles() {
  renderFileList();
}

export function installBindings() {
  on(EVENTS.CHATS, () => {
    renderChatList();
    // A different current chat means a different set of attached files.
    renderChatFiles();
  });

  on(EVENTS.CHAT_FILES, () => {
    renderChatFiles();
    if (state.session.view === 'chat') renderChatView({ preserveScroll: true });
  });

  on(EVENTS.MESSAGES, () => {
    if (state.session.view === 'chat') renderChatView();
    renderInputArea();
  });

  on(EVENTS.MESSAGES_TRUNCATED, ({ length }) => {
    if (state.session.view !== 'chat') return;
    const container = $('#chat-container');
    if (container) {
      // `[data-index]` only: the JavaScript execution banner is also a `.msg`,
      // and counting it would shift every index by one and remove the wrong
      // elements.
      const messages = container.querySelectorAll('.msg[data-index]');
      for (let i = length; i < messages.length; i++) {
        messages[i].remove();
      }
    }
    renderInputArea();
  });

  on(EVENTS.MESSAGE, ({ index, streaming, anchored }) => {
    if (state.session.view !== 'chat') return;
    const chat = currentChat();
    const message = chat?.messages[index];
    if (!message) return;

    const editing = state.session.editingMessageIndex === index;

    // A closed box shows nothing that a delta could change. Skipping the
    // render is also what keeps a long reasoning trace cheap to stream.
    if (streaming && isCollapsed(message, { editing })) {
      if (!hasMessageElement(index)) renderChatView({ preserveScroll: true });
      return;
    }

    // Sampled first: growing the message moves the bottom out from under us.
    const pinned = isPinnedToBottom();

    if (streaming) {
      // A missing node means the transcript and the store have drifted apart
      // (the message was mounted while another view was up, say). Re-render
      // rather than silently dropping every delta from here on — that is what
      // a half-finished, "frozen" reply looks like.
      if (!updateMessageContent(index, message, { final: false })) {
        renderChatView({ preserveScroll: true });
      }
    } else {
      replaceMessage(message, index, { editing });
    }

    // Follow the reply down unless the user has deliberately scrolled away —
    // or has just toggled a box or a call, which must stay under the cursor.
    if (pinned && !anchored) scrollToBottom();
  });

  on(EVENTS.MESSAGE_APPENDED, ({ index }) => {
    if (state.session.view !== 'chat') return;
    const chat = currentChat();
    const message = chat?.messages[index];
    if (message) {
      // Model output arriving while the user reads further up (an opened
      // thinking box, say) must not drag them down. Anything else — their own
      // message, an error — always scrolls into view.
      const follow = !isModelOutput(message) || isPinnedToBottom();
      appendMessageToView(message, index, { follow });
    }
    renderSendButton();
  });

  on(EVENTS.FILES, () => {
    renderChatFiles();
    if (state.session.view === 'file-settings') renderSettingsView();
  });

  on(EVENTS.FILE_PROGRESS, ({ id }) => {
    updateFileProgress(id);
    renderEmbeddingToggle(id);
  });

  on(EVENTS.SESSION, () => {
    applyChromeState();
    renderMainView();
    updateModelDropdown();
    renderInputArea();
  });

  on(EVENTS.GENERATION, () => {
    renderSendButton();
    // Live counters only move while a turn is running.
    syncTicker(state.runtime.generation.active);
  });

  on(EVENTS.CONTEXT, () => {
    renderSendButton();
  });

  on(EVENTS.MODELS, () => {
    updateModelDropdown();
  });

  on(EVENTS.HOOK_ERROR, ({ key, error }) => {
    console.error(`[${key}]`, error);
  });

  on(EVENTS.SESSION, renderSettingsEditor);

  return { scrollToMessage };
}
