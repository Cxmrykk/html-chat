/**
 * Which date heading a chat falls under in the sidebar.
 *
 * A chat's id is the `Date.now()` of its creation, so that is the date it is
 * grouped by. The last week gets one heading per day: "Today", "Yesterday",
 * then the date itself (e.g. "Nov 24"). Older chats are grouped into the
 * previous 30 days, then by month, with the year added once it is not the
 * current one.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many days back each day gets a heading of its own. */
const DAILY_DAYS = 7;
const RECENT_DAYS = 30;

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

/** A day of the last week, e.g. "Nov 24". */
function dayLabel(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** A month, e.g. "October", or "October 2025" outside the current year. */
function monthLabel(timestamp, now) {
  const date = new Date(timestamp);
  const month = date.toLocaleString(undefined, { month: 'long' });
  return date.getFullYear() === new Date(now).getFullYear()
    ? month
    : `${month} ${date.getFullYear()}`;
}

/** The heading for a chat created at `timestamp`. */
export function dateGroupLabel(timestamp, now = Date.now()) {
  if (timestamp === null || timestamp === undefined) return 'Undated';

  // Rounded: a day across a daylight-saving change is not 24 hours long.
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < DAILY_DAYS) return dayLabel(timestamp);
  if (days < RECENT_DAYS) return 'Previous 30 Days';
  return monthLabel(timestamp, now);
}
