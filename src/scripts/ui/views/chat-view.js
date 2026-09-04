import { $ } from '../dom.js';
import { state, currentChat } from '../../store/state.js';
import { messageHTML, mountMessage } from '../components/message.js';
import { enhance, renderMarkdown } from '../markdown.js';

/** The transcript. */

const GOD_MODE_BANNER = `
  <div class="msg system">
    <div class="msg-meta">
      <span>System</span>
      <div class="msg-actions"><span class="readonly-tag">[Read-Only]</span></div>
    </div>
    <div class="msg-content">${renderMarkdown('**JS Execution Enabled**. Proceed with caution.')}</div>
  </div>`;

/**
 * How close to the bottom still counts as "following along". A couple of lines
 * of slack, so sub-pixel rounding or a stray wheel tick does not detach the
 * view mid-stream.
 */
const STICK_THRESHOLD_PX = 48;

/**
 * True when the transcript is at (or very near) the bottom.
 *
 * Must be read *before* a message grows: a streaming reply pushes the bottom
 * away, so measuring afterwards always reports the user as scrolled up.
 */
export function isPinnedToBottom() {
  const container = $('#chat-container');
  if (!container) return false;
  const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
  return distance <= STICK_THRESHOLD_PX;
}

export function scrollToBottom() {
  const container = $('#chat-container');
  if (container) container.scrollTop = container.scrollHeight;
}

export function renderChatView({ preserveScroll = false } = {}) {
  const container = $('#chat-container');
  if (!container) return;

  const previousScroll = container.scrollTop;

  if (!state.data.currentChatId) {
    container.innerHTML = '<h3 class="chat-placeholder">No chat selected.</h3>';
    return;
  }

  const chat = currentChat();
  if (!chat) return;

  let html = state.data.config.godMode ? GOD_MODE_BANNER : '';

  if (!chat.messages.length && !state.data.config.godMode) {
    html += '<p class="empty-chat-msg">It is empty in here. Send a prompt.</p>';
  } else {
    html += chat.messages
      .map((message, index) =>
        messageHTML(message, index, { editing: state.session.editingMessageIndex === index }),
      )
      .join('');
  }

  container.innerHTML = html;
  enhance(container);

  if (preserveScroll) {
    container.scrollTop = previousScroll;
    return;
  }

  const last = container.lastElementChild;
  if (last && last.classList.contains('msg')) {
    const alignBottom = last.classList.contains('user') || last.classList.contains('file');
    container.scrollTop = alignBottom ? container.scrollHeight : last.offsetTop - 15;
  }
}

export function appendMessageToView(message, index) {
  const container = $('#chat-container');
  if (!container) return;

  container.querySelector('.empty-chat-msg')?.remove();
  mountMessage(container, message, index, {
    editing: state.session.editingMessageIndex === index,
  });
  scrollToBottom();
}

export function scrollToMessage(index, align = 'top') {
  const container = $('#chat-container');
  const element = container?.querySelector(`.msg[data-index="${index}"]`);
  if (!container || !element) return;
  container.scrollTop = align === 'bottom' ? container.scrollHeight : element.offsetTop - 15;
}
