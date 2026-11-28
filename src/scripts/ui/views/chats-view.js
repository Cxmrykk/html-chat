import { $ } from '../dom.js';
import { state, currentChat } from '../../store/state.js';
import { escapeHTML } from '../../core/format.js';
import { pickNumber } from '../../core/values.js';
import { GLOBAL_SETTINGS } from '../../core/settings-schema.js';
import { groupChatsByDate, chatTimestamp, chatTimeLabel } from '../../core/chat-dates.js';
import { createMatcher, searchChat } from '../../core/chat-search.js';
import { chatPreview } from '../../core/chat-summary.js';
import { messageMarkdown } from '../components/message.js';
import { actionRowHTML } from '../components/settings-list.js';
import { chatStatsLabel, chatActionsHTML } from '../components/chat-list.js';

/**
 * The chats page, opened from the Your Chats heading. It opens with the
 * actions on chats as a whole: exporting the open chat or every chat,
 * importing, Reset Chats, and where Auto-Purge stands. Under them, every
 * chat, grouped by date as in the sidebar.
 *
 * The search typed in the bottom bar (`state.session.chatSearch`) narrows
 * the list to chats whose text matches — every message as copy would give it,
 * reasoning and tool calls included — and shows how many matches each has,
 * with the first in context. Clicking a result opens the chat at the message
 * it was found in.
 */

const NO_MESSAGES = 'No messages yet.';

function noteHTML(text, extra = '') {
  return `<p class="settings-note${extra ? ` ${extra}` : ''}">${escapeHTML(text)}</p>`;
}

function chatCount(count) {
  return count === 1 ? '1 chat' : `${count} chats`;
}

function purgeLabel() {
  const days = pickNumber(0, state.data.config.autoPurgeDays, GLOBAL_SETTINGS.autoPurgeDays.default);
  return days > 0 ? `After ${days} day${days === 1 ? '' : 's'} unchanged` : 'Off';
}

function actionsHTML() {
  const chats = state.data.chats;
  const open = currentChat();
  const removable = chats.filter((chat) => !chat.locked).length;
  const locked = chats.length - removable;

  const cards = [
    actionRowHTML({
      command: 'chat.exportCurrent',
      label: 'Export Current Chat',
      value: open ? chatTimeLabel(chatTimestamp(open), { grouped: false }) || 'Open chat' : 'No chat open',
      title: 'Download the open chat as a JSON file',
      disabled: !open,
    }),
    actionRowHTML({
      command: 'chat.export',
      label: 'Export All Chats',
      value: chats.length ? chatCount(chats.length) : 'No chats',
      title: 'Download every chat as one JSON file',
      disabled: !chats.length,
    }),
    actionRowHTML({
      command: 'chats.import',
      label: 'Import Chats',
      value: 'One chat or all',
      title: 'Import a file made by Export Current Chat or Export All Chats. Chats whose id already exists are skipped.',
    }),
    actionRowHTML({
      command: 'chat.resetAll',
      label: 'Reset Chats',
      value: removable
        ? `Delete ${chatCount(removable)}${locked ? `, keep ${locked} locked` : ''}`
        : chats.length
          ? 'All locked'
          : 'No chats',
      title: 'Delete every chat that is not locked. Export them first to keep a copy.',
      disabled: !removable,
    }),
    actionRowHTML({
      command: 'settings.toggle',
      label: 'Auto-Purge',
      value: purgeLabel(),
      title: 'Change Auto-Purge Days under Chats, in the settings. Locked chats are never purged.',
    }),
  ];

  return `
    <div class="settings-category">
      <h3>Manage</h3>
    </div>
    <div class="settings-group">${cards.join('')}</div>`;
}

function snippetHTML(hit) {
  const { before, match, after } = hit.snippet;
  return `
    <span class="chat-result-snippet">
      <span class="chat-result-role">${escapeHTML(hit.role || '')}</span>${escapeHTML(before)}<mark>${escapeHTML(match)}</mark>${escapeHTML(after)}
    </span>`;
}

function matchCount(hit) {
  const count = `${hit.count}${hit.capped ? '+' : ''}`;
  return `${count} match${hit.count === 1 && !hit.capped ? '' : 'es'}`;
}

function rowHTML(chat, hit) {
  const id = escapeHTML(chat.id);
  const classes = ['chat-result'];
  if (chat.id === state.data.currentChatId) classes.push('active');
  if (chat.locked) classes.push('locked');

  const time = chatTimeLabel(chatTimestamp(chat), { grouped: true });
  const head = [
    time ? `<span class="chat-result-time">${escapeHTML(time)}</span>` : '',
    `<span class="chat-stats" data-chat-stats="${id}">${escapeHTML(chatStatsLabel(chat))}</span>`,
    hit ? `<span class="chat-result-count">${escapeHTML(matchCount(hit))}</span>` : '',
  ].join('');

  const body = hit
    ? snippetHTML(hit)
    : `<span class="chat-result-preview">${escapeHTML(chatPreview(chat) || NO_MESSAGES)}</span>`;

  const title = hit
    ? 'Open this chat at the first match (Export: Alt+Click · Copy transcript: Ctrl+Click)'
    : 'Open this chat (Export: Alt+Click · Copy transcript: Ctrl+Click)';

  return `
    <div class="${classes.join(' ')}" data-id="${id}">
      <button class="chat-result-main" data-command="chat.open"${
        hit ? ` data-key="${hit.messageIndex}"` : ''
      } title="${escapeHTML(title)}">
        <span class="chat-result-head">${head}</span>
        ${body}
      </button>
      ${chatActionsHTML(chat)}
    </div>`;
}

function groupsHTML(entries) {
  const hits = new Map(entries.map((entry) => [entry.chat.id, entry.hit]));
  return groupChatsByDate(entries.map((entry) => entry.chat))
    .map(
      ({ label, chats }) => `
        <div class="chat-manager-group">
          <h4 class="chat-manager-date">${escapeHTML(label)}</h4>
          ${chats.map((chat) => rowHTML(chat, hits.get(chat.id))).join('')}
        </div>`,
    )
    .join('');
}

function listHTML() {
  const chats = state.data.chats;
  if (!chats.length) return noteHTML('No chats yet. Start a new one, or import some above.');

  const matcher = createMatcher(state.session.chatSearch);
  if (!matcher.ok) return noteHTML(`Invalid pattern: ${matcher.error}`, 'chat-search-error');

  if (matcher.empty) {
    const locked = chats.filter((chat) => chat.locked).length;
    const summary = `${chatCount(chats.length)}${locked ? `, ${locked} locked` : ''}.`;
    return noteHTML(summary) + groupsHTML(chats.map((chat) => ({ chat, hit: null })));
  }

  const textOf = (message) => messageMarkdown(message);
  const entries = chats
    .map((chat) => ({ chat, hit: searchChat(chat, matcher, textOf) }))
    .filter((entry) => entry.hit);

  if (!entries.length) return noteHTML(`No chat matches (searched ${chatCount(chats.length)}).`);
  return noteHTML(`${entries.length} of ${chatCount(chats.length)} match.`) + groupsHTML(entries);
}

export function renderChatsView() {
  const container = $('#chat-container');
  if (!container) return;

  // Re-rendering keeps the scroll; coming from another view starts at the top.
  const previous = container.querySelector(':scope > .settings-panel')?.dataset.page;
  const scroll = previous === 'chats' ? container.scrollTop : 0;

  container.innerHTML = `
    <div class="settings-panel chats-panel" data-page="chats">
      <div class="settings-header">
        <h2>Your Chats</h2>
      </div>
      ${actionsHTML()}
      <div class="settings-category">
        <h3>Chats</h3>
      </div>
      <div class="chat-manager-list">${listHTML()}</div>
    </div>`;

  container.scrollTop = scroll;
}
