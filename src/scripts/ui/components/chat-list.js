import { $ } from '../dom.js';
import { state } from '../../store/state.js';
import { escapeHTML } from '../../core/format.js';
import { pickInteger } from '../../core/values.js';
import { ICON_RENAME, ICON_DELETE } from '../icons.js';

const ROW_HEIGHT = '1.6em + 17px';

function applyMaxHeight(list, limit) {
  const max = pickInteger(0, limit);
  if (max > 0) {
    list.style.maxHeight = `calc(${max} * (${ROW_HEIGHT}))`;
    list.style.overflowY = 'auto';
  } else {
    list.style.maxHeight = '';
    list.style.overflowY = '';
  }
}

export function renderChatList() {
  const list = $('#chat-list');
  if (!list) return;

  applyMaxHeight(list, state.data.config.maxVisibleChats);

  if (!state.data.chats.length) {
    list.innerHTML = '<p class="list-empty">No chats. Start a new one.</p>';
    return;
  }

  list.innerHTML = state.data.chats
    .map(
      (chat) => `
      <div class="chat-item${chat.id === state.data.currentChatId ? ' active' : ''}"
           data-id="${escapeHTML(chat.id)}">
        <div class="chat-item-title" data-command="chat.open"
             title="Export: Alt+Click · Copy transcript: Ctrl+Click">${escapeHTML(chat.title)}</div>
        <div class="chat-item-actions">
          <button data-command="chat.rename" title="Rename">${ICON_RENAME}</button>
          <button data-command="chat.delete" title="Delete">${ICON_DELETE}</button>
        </div>
      </div>`,
    )
    .join('');
}
