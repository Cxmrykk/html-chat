import * as idb from './idb.js';
import { KEYS } from './keys.js';
import { normalizeProfile } from '../core/rag-profile.js';

/**
 * Search profiles: one record holding the whole list. Every profile read
 * passes through `normalizeProfile`, so the rest of the app only ever sees
 * complete ones. A profile without an id is unusable and dropped.
 */

export async function loadProfiles() {
  const stored = await idb.get(KEYS.profiles);
  if (!Array.isArray(stored)) return [];
  return stored
    .map(normalizeProfile)
    .filter((profile) => profile.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function saveProfiles(profiles) {
  return idb.set(KEYS.profiles, profiles);
}
