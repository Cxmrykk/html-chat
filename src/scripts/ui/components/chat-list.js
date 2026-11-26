import { $ } from '../dom.js';
import { state } from '../../store/state.js';
import { escapeHTML } from '../../core/format.js';
import { pickBoolean } from '../../core/values.js';
import { GLOBAL_SETTINGS } from '../../core/settings-schema.js';
import { chatTimestamp, dateGroupLabel } from '../../core/chat-dates.js';
import { ICON_RENAME, ICON_DELETE } from '../icons.js';

/**
 * The sidebar's chat list. It always fills the height the sidebar leaves it
 * and scrolls on its own (see `#chat-list` in `styles/sidebar.css`), so
 * nothing here sizes it.
 *
 * With Chat Date Groups on, a heading goes before each run of chats created
 * on the same day, week, month (see `core/chat-dates.js`). The list is sorted
 * newest first, so each heading appears once.
 */

function chatItemHTML(chat) {
  return `
    <div class="chat-item${chat.id === state.data.currentChatId ? ' active' : ''}"
         data-id="${escapeHTML(chat.id)}">
      <div class="chat-item-title" data-command="chat.open"
           title="Export: Alt+Click · Copy transcript: Ctrl+Click">${escapeHTML(chat.title)}</div>
      <div class="chat-item-actions">
        <button data-command="chat.rename" title="Rename">${ICON_RENAME}</button>
        <button data-command="chat.delete" title="Delete">${ICON_DELETE}</button>
      </div>
    </div>`;
}

function groupHeadingHTML(label) {
  return `<div class="chat-date-group" role="heading" aria-level="4">${escapeHTML(label)}</div>`;
}

export function renderChatList() {
  const list = $('#chat-list');
  if (!list) return;

  if (!state.data.chats.length) {
    list.innerHTML = '<p class="list-empty">No chats. Start a new one.</p>';
    return;
  }

  const grouped = pickBoolean(
    true,
    state.data.config.chatDateGroups,
    GLOBAL_SETTINGS.chatDateGroups.default,
  );
  const now = Date.now();
  let previous = null;
  let html = '';

  for (const chat of state.data.chats) {
    if (grouped) {
      const label = dateGroupLabel(chatTimestamp(chat), now);
      if (label !== previous) {
        html += groupHeadingHTML(label);
        previous = label;
      }
    }
    html += chatItemHTML(chat);
  }

  list.innerHTML = html;
}
