import * as idb from './idb.js';
import { KEYS } from './keys.js';

/**
 * A file's sections as last parsed: one record per file,
 *
 *   { profileId, profileUpdatedAt, textLength, sections, error }
 *
 * The first three say which profile and which text the sections were
 * computed from, so a reader can tell when they have gone stale. `error` is
 * the parser's failure, if it failed (the file is then one section).
 */

export function loadSections(fileId) {
  return idb.get(KEYS.sections(fileId));
}

export function saveSections(fileId, record) {
  return idb.set(KEYS.sections(fileId), record);
}

export function deleteSections(fileId) {
  return idb.remove(KEYS.sections(fileId));
}
