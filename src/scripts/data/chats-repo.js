import * as idb from './idb.js';
import { KEYS } from './keys.js';
import { normalizeChat } from '../core/chats.js';

/**
 * Chats are stored as an index record plus one record per chat, so opening the
 * app does not deserialise every message of every conversation at once. Chats
 * have no names, so the index holds only their ids.
 *
 * Every record read passes through `normalizeChat`, so the rest of the app
 * only ever sees the current message model. Nothing is rewritten eagerly; a
 * chat is saved in its new shape the next time it changes.
 */

function toIndex(chats) {
  return chats.map((chat) => ({ id: chat.id }));
}

/** Migrates legacy single-record chat format to index-and-record architecture. */
export async function migrateLegacyChats() {
  const legacy = await idb.get(KEYS.legacyChats);
  if (!Array.isArray(legacy) || legacy.length === 0) return null;
  const chats = legacy.map(normalizeChat);
  await saveAllChats(chats);
  await idb.remove(KEYS.legacyChats);
  return chats;
}

export async function loadChats() {
  const migrated = await migrateLegacyChats();
  if (migrated) return migrated;

  const index = (await idb.get(KEYS.chatIndex)) || [];
  const chats = [];
  for (const entry of index) {
    const record = await idb.get(KEYS.chat(entry.id));
    chats.push(normalizeChat(record || { id: entry.id, messages: [] }));
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

/**
 * Delete the chats named in `ids`, leaving `remaining` in the index. Records
 * are removed one by one rather than by prefix: the index itself
 * (`mf_chat_index`) shares the chat records' prefix.
 */
export async function deleteChats(ids, remaining) {
  await saveChatIndex(remaining);
  for (const id of ids) await idb.remove(KEYS.chat(id));
}
