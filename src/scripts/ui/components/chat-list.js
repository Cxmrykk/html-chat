import { $ } from '../dom.js';
import { state } from '../../store/state.js';
import { escapeHTML } from '../../core/format.js';
import { pickBoolean } from '../../core/values.js';
import { GLOBAL_SETTINGS } from '../../core/settings-schema.js';
import { groupChatsByDate } from '../../core/chat-dates.js';
import { ICON_RENAME, ICON_DELETE, ICON_CHEVRON_DOWN, ICON_CHEVRON_UP } from '../icons.js';

/**
 * The sidebar's chat list. It always fills the height the sidebar leaves it
 * and scrolls on its own (see `#chat-list` in `styles/sidebar.css`), so
 * nothing here sizes it.
 *
 * With Chat Date Groups on, the chats sit under date headings (see
 * `core/chat-dates.js`). Each heading is a button that folds its group; a
 * folded group still shows the open chat, so switching chats from the
 * keyboard never lands on one that cannot be seen.
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

/** The heading: the date, then the chevron right beside it. */
function groupHeadingHTML(label, collapsed) {
  const hint = collapsed ? 'Show these chats' : 'Hide these chats';
  return `
    <button class="chat-date-group${collapsed ? ' collapsed' : ''}" data-command="chat.toggleGroup"
            data-key="${escapeHTML(label)}" aria-expanded="${collapsed ? 'false' : 'true'}"
            title="${hint}">
      <span class="chat-date-label">${escapeHTML(label)}</span>
      ${collapsed ? ICON_CHEVRON_DOWN : ICON_CHEVRON_UP}
    </button>`;
}

function groupedHTML(chats) {
  const collapsed = new Set(state.session.collapsedChatGroups || []);

  return groupChatsByDate(chats)
    .map(({ label, chats: members }) => {
      const folded = collapsed.has(label);
      const shown = folded
        ? members.filter((chat) => chat.id === state.data.currentChatId)
        : members;
      return groupHeadingHTML(label, folded) + shown.map(chatItemHTML).join('');
    })
    .join('');
}

export function renderChatList() {
  const list = $('#chat-list');
  if (!list) return;

  const chats = state.data.chats;
  if (!chats.length) {
    list.innerHTML = '<p class="list-empty">No chats. Start a new one.</p>';
    return;
  }

  const grouped = pickBoolean(
    true,
    state.data.config.chatDateGroups,
    GLOBAL_SETTINGS.chatDateGroups.default,
  );

  list.innerHTML = grouped ? groupedHTML(chats) : chats.map(chatItemHTML).join('');
}
