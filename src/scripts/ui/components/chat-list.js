import { $, $$ } from '../dom.js';
import { state } from '../../store/state.js';
import { escapeHTML } from '../../core/format.js';
import { pickBoolean } from '../../core/values.js';
import { GLOBAL_SETTINGS } from '../../core/settings-schema.js';
import { groupChatsByDate, chatTimestamp, chatTimeLabel } from '../../core/chat-dates.js';
import { chatStats, describeChatStats, chatPreview } from '../../core/chat-summary.js';
import {
  ICON_LOCK,
  ICON_UNLOCK,
  ICON_DELETE,
  ICON_CHEVRON_DOWN,
  ICON_CHEVRON_UP,
} from '../icons.js';

/**
 * The sidebar's chat list. It always fills the height the sidebar leaves it
 * and scrolls on its own (see `#chat-list` in `styles/sidebar.css`), so
 * nothing here sizes it.
 *
 * Chats have no names: each reads when it was made and its token and image
 * count (`core/chat-summary.js`), and its tooltip shows how it began. The
 * counts are cached, and refreshed in place whenever a chat's context changes
 * (`updateChatStats`), wherever they are shown.
 *
 * With Chat Date Groups on, the chats sit under date headings (see
 * `core/chat-dates.js`). Each heading is a button that folds its group; a
 * folded group still shows the open chat, so switching chats from the
 * keyboard never lands on one that cannot be seen.
 */

const ITEM_HINT = 'Export: Alt+Click · Copy transcript: Ctrl+Click';

/** A chat's token and image count, e.g. "1.2k tokens · 2 images". Cached until its context changes. */
export function chatStatsLabel(chat) {
  const cache = state.runtime.chatStats;
  let label = cache.get(chat.id);
  if (label === undefined) {
    label = describeChatStats(chatStats(chat));
    cache.set(chat.id, label);
  }
  return label;
}

function itemTooltip(chat) {
  const preview = chatPreview(chat);
  return preview ? `${preview}\n\n${ITEM_HINT}` : ITEM_HINT;
}

/** A chat's lock and delete buttons, shared by the sidebar and the chats page. */
export function chatActionsHTML(chat) {
  const locked = chat.locked === true;
  const lockTitle = locked
    ? 'Locked: kept by Auto-Purge and Reset Chats. Click to unlock.'
    : 'Lock: keep this chat from Auto-Purge and Reset Chats';
  return `
    <div class="chat-item-actions">
      <button class="lock-btn" data-command="chat.toggleLock" aria-pressed="${locked}"
              title="${escapeHTML(lockTitle)}">${locked ? ICON_LOCK : ICON_UNLOCK}</button>
      <button data-command="chat.delete" title="Delete">${ICON_DELETE}</button>
    </div>`;
}

function isGrouped() {
  return pickBoolean(true, state.data.config.chatDateGroups, GLOBAL_SETTINGS.chatDateGroups.default);
}

function chatItemHTML(chat, grouped) {
  const id = escapeHTML(chat.id);
  const classes = ['chat-item'];
  if (chat.id === state.data.currentChatId) classes.push('active');
  if (chat.locked) classes.push('locked');
  const time = chatTimeLabel(chatTimestamp(chat), { grouped });

  return `
    <div class="${classes.join(' ')}" data-id="${id}">
      <div class="chat-item-title" data-command="chat.open" data-chat-preview="${id}"
           title="${escapeHTML(itemTooltip(chat))}">
        ${time ? `<span class="chat-item-time">${escapeHTML(time)}</span>` : ''}
        <span class="chat-stats" data-chat-stats="${id}">${escapeHTML(chatStatsLabel(chat))}</span>
      </div>
      ${chatActionsHTML(chat)}
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
      return groupHeadingHTML(label, folded) + shown.map((chat) => chatItemHTML(chat, true)).join('');
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

  list.innerHTML = isGrouped()
    ? groupedHTML(chats)
    : chats.map((chat) => chatItemHTML(chat, false)).join('');
}

/** Bring every shown count and preview of one chat up to date, in place. */
export function updateChatStats(id) {
  if (!id) return;
  const chat = state.data.chats.find((entry) => entry.id === id);
  if (!chat) return;

  const selector = CSS.escape(id);
  const label = chatStatsLabel(chat);
  for (const element of $$(`[data-chat-stats="${selector}"]`)) {
    if (element.textContent !== label) element.textContent = label;
  }
  const tooltip = itemTooltip(chat);
  for (const element of $$(`[data-chat-preview="${selector}"]`)) {
    if (element.title !== tooltip) element.title = tooltip;
  }
}
