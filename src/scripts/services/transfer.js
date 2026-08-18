import { EVENTS } from '../store/events.js';
import {
  state,
  emit,
  findFile,
  persistFiles,
  persistChatIndex,
  persistPrefs,
} from '../store/state.js';
import * as chatsRepo from '../data/chats-repo.js';
import * as chunksRepo from '../data/chunks-repo.js';
import { encodeVectorToBase64, decodeBase64ToVector } from '../core/vector.js';
import { computeProgress } from '../core/progress.js';
import { stopEmbedding } from './embedding.js';

/** Import/export of chats and of chunk+vector bundles. */

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

  for (const chat of imported) {
    if (!chat.id || !chat.messages) continue;
    if (existingIds.has(chat.id)) continue;
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

export async function exportVectors(fileId) {
  const chunks = await chunksRepo.listChunks(fileId);
  if (!chunks.length) throw new Error('No chunks found.');

  downloadJSON(`file-vectors-${fileId}.json`, {
    model: state.data.config.embeddingsModel,
    chunks: chunks.map((chunk) => ({
      text: chunk.text,
      raw: chunk.raw !== undefined ? chunk.raw : chunk.text,
      vector_b64: encodeVectorToBase64(chunk.vector),
    })),
  });
}

export async function importVectors(fileId, rawJson) {
  const imported = JSON.parse(rawJson);
  if (!imported.chunks || !Array.isArray(imported.chunks)) {
    throw new Error('Invalid format.');
  }
  if (imported.model !== state.data.config.embeddingsModel) {
    throw new Error(
      `Model mismatch!\n\nExported model: '${imported.model}'\n` +
        `Current model: '${state.data.config.embeddingsModel}'\n\n` +
        `Import cancelled. To bypass this, edit the 'model' field in the JSON ` +
        `to match your current model.`,
    );
  }

  const meta = findFile(fileId);
  if (!meta) throw new Error('File not found.');

  stopEmbedding(fileId);

  const chunks = imported.chunks.map((entry, index) => ({
    index,
    text: entry.text,
    raw: entry.raw !== undefined ? entry.raw : entry.text,
    vector: entry.vector_b64
      ? decodeBase64ToVector(entry.vector_b64)
      : entry.vector
        ? new Float32Array(entry.vector)
        : null,
  }));

  meta.customChunks = JSON.stringify(
    chunks.map((chunk) => chunk.raw),
    null,
    2,
  );

  await chunksRepo.replaceChunks(fileId, chunks);

  const embeddedCount = chunks.filter((chunk) => chunk.vector).length;
  const { exactProgress, progress } = computeProgress({
    chunkCount: chunks.length,
    embeddedCount,
  });
  meta.chunkCount = chunks.length;
  meta.embeddedCount = embeddedCount;
  meta.exactProgress = exactProgress;
  meta.progress = progress;
  meta.isEmbedding = false;

  await persistFiles();
  emit(EVENTS.FILES);
  emit(EVENTS.FILE_PROGRESS, { id: fileId });
}
