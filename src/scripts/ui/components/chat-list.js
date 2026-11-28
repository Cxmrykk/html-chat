import { $, $$ } from '../dom.js';
import { state } from '../../store/state.js';
import { escapeHTML } from '../../core/format.js';
import { pickBoolean } from '../../core/values.js';
import { GLOBAL_SETTINGS } from '../../core/settings-schema.js';
import { groupChatsByDate } from '../../core/chat-dates.js';
import {
  chatName,
  chatStats,
  describeChatStats,
  describeChatStatsFully,
  chatPreview,
} from '../../core/chat-summary.js';
import { sendsGeneratedImages } from '../../services/images.js';
import { ICON_RENAME, ICON_DELETE, ICON_CHEVRON_DOWN, ICON_CHEVRON_UP } from '../icons.js';

/**
 * The sidebar's chat list. It always fills the height the sidebar leaves it
 * and scrolls on its own (see `#chat-list` in `styles/sidebar.css`), so
 * nothing here sizes it.
 *
 * A named chat reads its name. Any other reads its token count and how many
 * images it sends (`core/chat-summary.js`), e.g. "1.2k tokens + 5". The
 * tooltip always gives the counts in full and how the chat began. The counts
 * are cached, and refreshed in place whenever a chat's context changes
 * (`updateChatStats`), wherever they are shown. Whether generated images are
 * counted follows Send Generated Images.
 *
 * With Chat Date Groups on, the chats sit under date headings (see
 * `core/chat-dates.js`). Each heading is a button that folds its group; a
 * folded group still shows the open chat, so switching chats from the
 * keyboard never lands on one that cannot be seen.
 */

const ITEM_HINT = 'Export: Alt+Click · Copy transcript: Ctrl+Click';

/** `{ label, detail }` for a chat's counts, cached until its context or Send Generated Images changes. */
function summaryOf(chat) {
  const generated = sendsGeneratedImages();
  const cache = state.runtime.chatStats;
  let entry = cache.get(chat.id);
  if (!entry || entry.generated !== generated) {
    const stats = chatStats(chat, { generated });
    entry = { generated, label: describeChatStats(stats), detail: describeChatStatsFully(stats) };
    cache.set(chat.id, entry);
  }
  return entry;
}

/** A chat's counts, e.g. "1.2k tokens + 5". */
export function chatStatsLabel(chat) {
  return summaryOf(chat).label;
}

/** What hovering a chat shows: its counts in full, how it began, and what clicks do. */
function itemTooltip(chat) {
  const lines = [summaryOf(chat).detail, chatPreview(chat)].filter(Boolean);
  return `${lines.join('\n')}\n\n${ITEM_HINT}`;
}

/** A chat's rename and delete buttons, shared by the sidebar and the chats page. */
export function chatActionsHTML(chat) {
  const renameTitle = chatName(chat)
    ? 'Rename (empty removes the name)'
    : 'Name this chat: it then shows its name and is kept by Auto-Purge and Reset Chats';
  return `
    <div class="chat-item-actions">
      <button data-command="chat.rename" title="${escapeHTML(renameTitle)}">${ICON_RENAME}</button>
      <button data-command="chat.delete" title="Delete">${ICON_DELETE}</button>
    </div>`;
}

function isGrouped() {
  return pickBoolean(true, state.data.config.chatDateGroups, GLOBAL_SETTINGS.chatDateGroups.default);
}

function chatItemHTML(chat) {
  const id = escapeHTML(chat.id);
  const name = chatName(chat);
  const classes = ['chat-item'];
  if (chat.id === state.data.currentChatId) classes.push('active');
  if (name) classes.push('named');

  const label = name
    ? `<span class="chat-name">${escapeHTML(name)}</span>`
    : `<span class="chat-stats" data-chat-stats="${id}">${escapeHTML(chatStatsLabel(chat))}</span>`;

  return `
    <div class="${classes.join(' ')}" data-id="${id}">
      <div class="chat-item-title" data-command="chat.open" data-chat-preview="${id}"
           title="${escapeHTML(itemTooltip(chat))}">${label}</div>
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

  list.innerHTML = isGrouped() ? groupedHTML(chats) : chats.map(chatItemHTML).join('');
}

/** Bring every shown count and tooltip of one chat up to date, in place. */
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
