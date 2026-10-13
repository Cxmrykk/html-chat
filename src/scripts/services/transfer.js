import { EVENTS } from '../store/events.js';
import { state, emit, persistChatIndex, persistPrefs } from '../store/state.js';
import * as chatsRepo from '../data/chats-repo.js';
import { normalizeChat } from '../core/chats.js';

/** Import/export of chats. */

export function downloadJSON(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function exportAllChats() {
  downloadJSON(`html-chat-export-${Date.now()}.json`, state.data.chats);
}

export function exportChat(id) {
  const chat = state.data.chats.find((entry) => entry.id === id);
  if (!chat) return;
  downloadJSON(`chat-timestamp-${chat.id}.json`, [chat]);
}

export async function importChats(rawJson) {
  const imported = JSON.parse(rawJson);
  if (!Array.isArray(imported)) {
    throw new Error('Invalid format: expected an array of chats.');
  }

  const existingIds = new Set(state.data.chats.map((chat) => chat.id));
  let added = 0;

  for (const entry of imported) {
    if (!entry || !entry.id || !entry.messages) continue;
    if (existingIds.has(entry.id)) continue;
    // Exports from before tool calling still carry `file` messages.
    const chat = normalizeChat(entry);
    state.data.chats.push(chat);
    existingIds.add(chat.id);
    await chatsRepo.saveChat(chat);
    added++;
  }

  state.data.chats.sort((a, b) => Number(b.id) - Number(a.id));
  if (!state.data.currentChatId && state.data.chats.length) {
    state.data.currentChatId = state.data.chats[0].id;
  }

  await persistChatIndex();
  await persistPrefs();
  emit(EVENTS.CHATS);
  emit(EVENTS.MESSAGES);
  return added;
}
