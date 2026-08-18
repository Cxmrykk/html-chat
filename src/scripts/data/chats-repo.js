import * as idb from './idb.js';
import { KEYS } from './keys.js';

/**
 * Chats are stored as an index record plus one record per chat, so opening the
 * app does not deserialise every message of every conversation at once.
 */

function toIndex(chats) {
  return chats.map((chat) => ({ id: chat.id, title: chat.title }));
}

/** Migrates legacy single-record chat format to index-and-record architecture. */
export async function migrateLegacyChats() {
  const legacy = await idb.get(KEYS.legacyChats);
  if (!Array.isArray(legacy) || legacy.length === 0) return null;
  await saveAllChats(legacy);
  await idb.remove(KEYS.legacyChats);
  return legacy;
}

export async function loadChats() {
  const migrated = await migrateLegacyChats();
  if (migrated) return migrated;

  const index = (await idb.get(KEYS.chatIndex)) || [];
  const chats = [];
  for (const entry of index) {
    const record = await idb.get(KEYS.chat(entry.id));
    chats.push(record || { id: entry.id, title: entry.title, messages: [] });
  }
  return chats;
}

export function saveChatIndex(chats) {
  return idb.set(KEYS.chatIndex, toIndex(chats));
}

export function saveChat(chat) {
  return idb.set(KEYS.chat(chat.id), chat);
}

export async function saveAllChats(chats) {
  await saveChatIndex(chats);
  await idb.setMany(chats.map((chat) => [KEYS.chat(chat.id), chat]));
}

/** Delete a chat's message record as well as its index entry. */
export async function deleteChat(id, remainingChats) {
  await idb.remove(KEYS.chat(id));
  await saveChatIndex(remainingChats);
}
