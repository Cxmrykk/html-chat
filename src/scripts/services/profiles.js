import { EVENTS } from '../store/events.js';
import {
  state,
  emit,
  findFile,
  findProfile,
  isConfigured,
  persistProfiles,
  persistFiles,
  invalidateContext,
} from '../store/state.js';
import { normalizeProfile, validateProfile, extensionOf } from '../core/rag-profile.js';
import { indexFile, clearIndex } from './indexing.js';

/** Creating, changing and deleting search profiles, and assigning them to files. */

export function filesUsing(profileId) {
  return state.data.files.filter((file) => file.profileId === profileId);
}

/** Every profile, those claiming this file's extension first. */
export function profilesForFile(fileName) {
  const extension = extensionOf(fileName);
  return state.data.profiles
    .map((profile) => ({
      profile,
      matches: Boolean(extension) && profile.extensions.includes(extension),
    }))
    .sort((a, b) => Number(b.matches) - Number(a.matches) || a.profile.name.localeCompare(b.profile.name));
}

/** Files with no profile yet whose extension is one of `extensions`. */
export function unconfiguredFilesFor(extensions) {
  const wanted = new Set(extensions);
  return state.data.files.filter((file) => !isConfigured(file) && wanted.has(extensionOf(file.name)));
}

function newProfileId() {
  return `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function sortProfiles() {
  state.data.profiles.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Save a profile: replace the one with its id, or (with `asNew`, or when
 * there is none) add it under a fresh id. Replacing one re-indexes every file
 * that uses it. Resolves with the stored profile.
 */
export async function saveProfile(draft, { asNew = false } = {}) {
  const profile = normalizeProfile(draft);
  const errors = validateProfile(profile, { forSave: true });
  if (errors.length) throw new Error(errors.join(' '));

  const existing = !asNew && profile.id ? findProfile(profile.id) : null;
  profile.id = existing ? existing.id : newProfileId();
  profile.updatedAt = Date.now();

  if (existing) state.data.profiles.splice(state.data.profiles.indexOf(existing), 1, profile);
  else state.data.profiles.push(profile);
  sortProfiles();

  await persistProfiles();
  emit(EVENTS.PROFILES);

  if (existing) {
    for (const file of filesUsing(profile.id)) await indexFile(file.id);
    emit(EVENTS.FILES);
    emit(EVENTS.CHAT_FILES);
  }
  invalidateContext();
  return profile;
}

/** Point files at a profile and index them under it. */
export async function assignProfile(fileIds, profileId) {
  if (!findProfile(profileId)) throw new Error('That profile no longer exists.');
  const files = fileIds.map((id) => findFile(id)).filter(Boolean);
  for (const file of files) file.profileId = profileId;
  await persistFiles();

  for (const file of files) await indexFile(file.id);

  invalidateContext();
  emit(EVENTS.FILES);
  emit(EVENTS.CHAT_FILES);
}

/** Delete a profile. The files that used it become unconfigured. */
export async function deleteProfile(id) {
  if (!findProfile(id)) return;
  const users = filesUsing(id);
  state.data.profiles = state.data.profiles.filter((profile) => profile.id !== id);

  for (const file of users) {
    file.profileId = null;
    await clearIndex(file.id);
  }

  await persistProfiles();
  await persistFiles();
  invalidateContext();
  emit(EVENTS.PROFILES);
  emit(EVENTS.FILES);
  emit(EVENTS.CHAT_FILES);
}
