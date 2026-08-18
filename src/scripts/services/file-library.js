import { EVENTS } from '../store/events.js';
import {
  state,
  emit,
  findFile,
  persistFiles,
  invalidateContext,
} from '../store/state.js';
import * as filesRepo from '../data/files-repo.js';
import * as chunksRepo from '../data/chunks-repo.js';
import { refreshFileChunks, stopEmbedding } from './embedding.js';
import { fullFileContent } from './retrieval.js';
import { appendMessage } from './conversation.js';
import { estimateTokens } from '../core/tokens.js';
import { pickNumber } from '../core/values.js';

/** Upload, replace, delete and insert files. */

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

/** Insert a file into the current chat, whole or as a retrieval placeholder. */
export async function insertFileMessage(fileId, mode = 'full') {
  const meta = findFile(fileId);
  if (!meta) return;

  const config = state.data.config;
  let content = '';
  let approxTokens = estimateTokens('x'.repeat(meta.textLength || 0));

  if (mode === 'full') {
    content = await fullFileContent(fileId);
    approxTokens = estimateTokens(content);
  }

  await appendMessage({
    role: 'file',
    fileId: meta.id,
    fileName: meta.name,
    prompt: '',
    mode,
    approxTokens,
    content,
    maxTokens: pickNumber(5000, config.maxRagTokens),
    ragThreshold: pickNumber(0, config.ragThreshold),
  });

  invalidateContext();
}
