import * as idb from './idb.js';
import { KEYS } from './keys.js';

/** Transient fields that must never reach storage. */
const TRANSIENT_FIELDS = ['_embeddingLoopActive', 'embeddingSpeed', 'embeddingEta'];

function serialiseMeta(meta) {
  const copy = { ...meta };
  for (const field of TRANSIENT_FIELDS) delete copy[field];
  return copy;
}

export async function loadFileMetas() {
  const metas = (await idb.get(KEYS.files)) || [];
  return metas.map(serialiseMeta);
}

export function saveFileMetas(metas) {
  return idb.set(KEYS.files, metas.map(serialiseMeta));
}

export function loadFileData(id) {
  return idb.get(KEYS.fileData(id));
}

export function saveFileData(data) {
  return idb.set(KEYS.fileData(data.id), data);
}

export function deleteFileData(id) {
  return idb.remove(KEYS.fileData(id));
}
