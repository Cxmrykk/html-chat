import { EVENTS } from '../store/events.js';
import { state, emit, findFile, isConfigured, persistFiles, invalidateContext } from '../store/state.js';
import * as filesRepo from '../data/files-repo.js';
import * as chunksRepo from '../data/chunks-repo.js';
import * as sectionsRepo from '../data/sections-repo.js';
import { indexFile } from './indexing.js';
import { stopEmbeddingAndWait } from './embedding.js';

/**
 * Upload, replace and delete the files that chats can search. A new file has
 * no profile: nothing is indexed until one is chosen in the configurator.
 */

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
    profileId: null,
    textLength: text.length,
    sectionCount: 0,
    indexError: '',
    progress: 0,
    exactProgress: 0,
    isEmbedding: false,
    chunkCount: 0,
    embeddedCount: 0,
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
  if (isConfigured(meta)) await indexFile(id);
  invalidateContext();
  emit(EVENTS.FILES);
}

export async function deleteFile(id) {
  await stopEmbeddingAndWait(id);
  state.data.files = state.data.files.filter((file) => file.id !== id);
  await filesRepo.deleteFileData(id);
  await chunksRepo.deleteChunks(id);
  await sectionsRepo.deleteSections(id);
  await persistFiles();
  // Chats that had it attached now offer the model one file fewer.
  invalidateContext();
  emit(EVENTS.FILES);
  emit(EVENTS.CHAT_FILES);
}

export async function getFileText(id) {
  const data = await filesRepo.loadFileData(id);
  return data ? data.text : '';
}

/** Per-file settings from before search profiles. None of them carries over. */
const LEGACY_FIELDS = [
  'customChunks',
  'customChunker',
  'retrievalFunc',
  'dedupFunc',
  'mergeChunksFunc',
  'fileWrapperFunc',
  'maxRagTokens',
  'ragThreshold',
  'chunkMaxTokens',
];

/**
 * Files from before search profiles have no `profileId` at all. Their
 * chunks overlapped, which sections cannot, so their vectors cannot be
 * reused: the old records are dropped and the file comes up unconfigured, to
 * be set up in the configurator like a new upload.
 */
export async function migrateLegacyFiles() {
  let changed = false;
  for (const meta of state.data.files) {
    if ('profileId' in meta) continue;
    for (const field of LEGACY_FIELDS) delete meta[field];
    await chunksRepo.deleteChunks(meta.id);
    Object.assign(meta, {
      profileId: null,
      sectionCount: 0,
      indexError: '',
      progress: 0,
      exactProgress: 0,
      isEmbedding: false,
      chunkCount: 0,
      embeddedCount: 0,
    });
    changed = true;
  }
  if (changed) await persistFiles();
}
