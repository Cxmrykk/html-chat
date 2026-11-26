/**
 * Which date heading a chat falls under in the sidebar.
 *
 * A chat's id is the `Date.now()` of its creation, so that is the date it is
 * grouped by. Recent chats get relative headings; older ones are grouped by
 * month, with the year added once it is not the current one.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** The heading for a chat created at `timestamp`. */
export function dateGroupLabel(timestamp, now = Date.now()) {
  if (timestamp === null || timestamp === undefined) return 'Undated';

  // Rounded: a day across a daylight-saving change is not 24 hours long.
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 Days';
  if (days < 30) return 'Previous 30 Days';

  const date = new Date(timestamp);
  const month = date.toLocaleString(undefined, { month: 'long' });
  return date.getFullYear() === new Date(now).getFullYear()
    ? month
    : `${month} ${date.getFullYear()}`;
}
