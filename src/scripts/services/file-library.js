import { EVENTS } from '../store/events.js';
import { state, emit, findFile, persistFiles, invalidateContext } from '../store/state.js';
import * as filesRepo from '../data/files-repo.js';
import * as chunksRepo from '../data/chunks-repo.js';
import { refreshFileChunks, startEmbedding, stopEmbedding } from './embedding.js';

/** Upload, replace and delete the files that chats can search. */

function uniqueName(name) {
  let candidate = name;
  let counter = 1;
  while (state.data.files.some((file) => file.name === candidate)) {
    candidate = `${name} (${counter++})`;
  }
  return candidate;
}

export async function addFile(name, text) {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const meta = {
    id,
    name: uniqueName(name),
    progress: 0,
    exactProgress: 0,
    isEmbedding: false,
    chunkCount: 0,
    embeddedCount: 0,
    textLength: text.length,
  };

  state.data.files.unshift(meta);
  await filesRepo.saveFileData({ id, name: meta.name, text });
  await persistFiles();
  emit(EVENTS.FILES);

  // A file exists to be searched, so indexing starts at once. Not awaited: it
  // runs in the background, and is a no-op without an embeddings model.
  startEmbedding(id);
  return id;
}

export async function replaceFileContents(id, text) {
  const meta = findFile(id);
  if (!meta) return;

  const data = (await filesRepo.loadFileData(id)) || { id, name: meta.name, text: '' };
  data.text = text;
  meta.textLength = text.length;

  await filesRepo.saveFileData(data);
  await persistFiles();
  await refreshFileChunks(id);
  emit(EVENTS.FILES);
}

export async function deleteFile(id) {
  stopEmbedding(id);
  state.data.files = state.data.files.filter((file) => file.id !== id);
  await filesRepo.deleteFileData(id);
  await chunksRepo.deleteChunks(id);
  await persistFiles();
  // Chats that had it attached now offer the model one file fewer.
  invalidateContext();
  emit(EVENTS.FILES);
}

export async function setFileText(id, text) {
  const meta = findFile(id);
  if (!meta) return;
  const data = await filesRepo.loadFileData(id);
  if (!data) return;

  data.text = text;
  meta.textLength = text.length;
  await filesRepo.saveFileData(data);
  await persistFiles();
  await refreshFileChunks(id);
}

export async function getFileText(id) {
  const data = await filesRepo.loadFileData(id);
  return data ? data.text : '';
}
