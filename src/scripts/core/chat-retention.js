import { chatTimestamp } from './chat-dates.js';

/**
 * Which chats Auto-Purge deletes: those unchanged for more than the chosen
 * number of days. A locked chat is never purged, nor is any in `keep` (the
 * open chat). A chat's last change is its `updatedAt`, or its creation for a
 * chat that has none.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** When the chat last changed, or null if that cannot be told. */
export function lastActivity(chat) {
  const updated = Number(chat?.updatedAt);
  if (Number.isFinite(updated) && updated > 0) return updated;
  return chatTimestamp(chat);
}

export function chatsToPurge(chats, days, { now = Date.now(), keep = [] } = {}) {
  if (!(days > 0)) return [];
  const cutoff = now - days * DAY_MS;
  const kept = new Set(keep);
  return (chats || []).filter((chat) => {
    if (!chat || chat.locked === true || kept.has(chat.id)) return false;
    const at = lastActivity(chat);
    return at !== null && at < cutoff;
  });
}
