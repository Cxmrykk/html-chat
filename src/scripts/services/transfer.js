import { EVENTS } from '../store/events.js';
import {
  state,
  emit,
  persistConfig,
  persistChatIndex,
  persistPrefs,
  invalidateContext,
} from '../store/state.js';
import * as chatsRepo from '../data/chats-repo.js';
import { normalizeConfig } from '../data/config-repo.js';
import { normalizeChat } from '../core/chats.js';
import { ensureActiveModel, refreshModels } from './models.js';

/**
 * Import and export: one chat, every chat, or the settings.
 *
 * Chats are exported as an array of chat records (one record for a single
 * chat). Settings are exported as an object tagged with `SETTINGS_FORMAT`,
 * holding the config minus `PRIVATE_FIELDS`. An import reads any of them and
 * says which it found (`parseImport`); applying it is a separate step, so the
 * caller can ask first.
 */

const SETTINGS_FORMAT = 'html-chat-settings';
const SETTINGS_VERSION = 1;

/**
 * Config fields a settings export leaves out: the API key, which must not
 * end up in a file that gets passed around, and the model list and
 * capabilities, which are a cache that discovery fetches again.
 */
const PRIVATE_FIELDS = ['key', 'models', 'modelCapabilities'];

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

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

export function exportAllChats() {
  downloadJSON(`html-chat-export-${Date.now()}.json`, state.data.chats);
}

export function exportChat(id) {
  const chat = state.data.chats.find((entry) => entry.id === id);
  if (!chat) return;
  downloadJSON(`chat-timestamp-${chat.id}.json`, [chat]);
}

export function exportSettings() {
  const settings = JSON.parse(JSON.stringify(state.data.config));
  for (const field of PRIVATE_FIELDS) delete settings[field];
  downloadJSON(`html-chat-settings-${Date.now()}.json`, {
    format: SETTINGS_FORMAT,
    version: SETTINGS_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
  });
}

/* ------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------ */

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * What a file holds: `{ kind: 'chats', chats }` (an export of all chats, of
 * one chat, or a bare chat record) or `{ kind: 'settings', settings }`.
 * Throws when it is neither.
 */
export function parseImport(rawJson) {
  let data;
  try {
    data = JSON.parse(rawJson);
  } catch {
    throw new Error('The file is not valid JSON.');
  }

  if (Array.isArray(data)) return { kind: 'chats', chats: data };

  if (isPlainObject(data)) {
    if (data.format === SETTINGS_FORMAT && isPlainObject(data.settings)) {
      return { kind: 'settings', settings: data.settings };
    }
    if (data.id && Array.isArray(data.messages)) return { kind: 'chats', chats: [data] };
  }

  throw new Error(
    'Unrecognised file: expected a chat export (one chat or all of them) or a settings export.',
  );
}

/** Add the chats of an import, skipping any whose id already exists. Resolves with how many were added. */
export async function addChats(imported) {
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

/**
 * Replace the settings with an imported set. The API key is kept unless the
 * file carries one, and the cached model list is kept until discovery
 * refreshes it (the base URL may have changed). The result goes through the
 * same normalisation as a stored config, so an older or hand-edited export
 * is brought up to date.
 */
export async function applySettings(imported) {
  const current = state.data.config;
  const key = typeof imported.key === 'string' && imported.key.trim() ? imported.key : current.key;

  state.data.config = normalizeConfig({
    ...imported,
    key,
    models: current.models,
    modelCapabilities: current.modelCapabilities,
  });
  ensureActiveModel();
  await persistConfig();

  invalidateContext();
  emit(EVENTS.SESSION);
  emit(EVENTS.MODELS);
  // Date groups, collapsing and the JavaScript banner may have changed.
  emit(EVENTS.CHATS);
  emit(EVENTS.MESSAGES);
  // Not awaited: the dropdown shows its loading state meanwhile.
  refreshModels();
}

/** The Code Execution switch an imported set of settings would leave. */
export function importedCodeExecution(settings) {
  return Boolean(settings?.jsExecution ?? settings?.godMode);
}
