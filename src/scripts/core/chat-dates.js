/**
 * Which date heading a chat falls under in the sidebar, and how its time is
 * written.
 *
 * A chat's id is the `Date.now()` of its creation, so that is the date it is
 * grouped by. The last 30 days get one heading per day: "Today",
 * "Yesterday", then the date itself (e.g. "Nov 24"). Everything before that
 * shares a single "Older" heading.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many days back each day gets a heading of its own. */
const DAILY_DAYS = 30;

export const OLDER_LABEL = 'Older';

/** Midnight, local time, of the day `time` falls on. */
function startOfDay(time) {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** When the chat was created, or null if its id is not a timestamp. */
export function chatTimestamp(chat) {
  const time = Number(chat?.id);
  return Number.isFinite(time) && time > 0 ? time : null;
}

/** A day of the last 30, e.g. "Nov 24". */
function dayLabel(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The heading for a chat created at `timestamp`. */
export function dateGroupLabel(timestamp, now = Date.now()) {
  if (timestamp === null || timestamp === undefined) return OLDER_LABEL;

  // Rounded: a day across a daylight-saving change is not 24 hours long.
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < DAILY_DAYS) return dayLabel(timestamp);
  return OLDER_LABEL;
}

/**
 * When a chat was created, as shown beside it. Under a heading that already
 * names the day (`grouped`), the time alone, e.g. "14:32". Otherwise the
 * time for today, and the day as well for any other: "Nov 24, 14:32", or
 * "Nov 24, 2024" for another year.
 */
export function chatTimeLabel(timestamp, { grouped = true, now = Date.now() } = {}) {
  if (timestamp === null || timestamp === undefined) return '';
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const label = dateGroupLabel(timestamp, now);
  if (label === 'Today' || (grouped && label !== OLDER_LABEL)) return time;

  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const day = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return sameYear ? `${day}, ${time}` : day;
}

/**
 * Chats split into runs under one heading each, in list order:
 * `[{ label, chats }]`. The list is sorted newest first, so each heading
 * appears once.
 */
export function groupChatsByDate(chats, now = Date.now()) {
  const groups = [];
  for (const chat of chats) {
    const label = dateGroupLabel(chatTimestamp(chat), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.chats.push(chat);
    else groups.push({ label, chats: [chat] });
  }
  return groups;
}
