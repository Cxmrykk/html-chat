import { EVENTS } from '../store/events.js';
import { state, emit, persistConfig, invalidateContext } from '../store/state.js';
import { GLOBAL_SETTINGS } from '../core/settings-schema.js';
import { coerceForStorage } from '../core/values.js';

/** The global advanced settings. */

/** Current stored value for a key, ready to display in the list. */
export function readSetting(key) {
  return state.data.config[key];
}

/** Editor contents: the stored value, or the schema default when unset. */
export function readEditorValue(key) {
  const entry = GLOBAL_SETTINGS[key];
  if (!entry) return '';
  const value = state.data.config[key];
  return value !== undefined && value !== '' ? String(value) : entry.default;
}

async function afterMutation() {
  await persistConfig();
  // Extra models change the dropdown; Max Visible Chats changes the chat list;
  // tool settings change what every request carries.
  emit(EVENTS.MODELS);
  emit(EVENTS.CHATS);
  invalidateContext();
}

export async function saveSetting(key, rawValue) {
  const entry = GLOBAL_SETTINGS[key];
  if (!entry) return;
  state.data.config[key] = coerceForStorage(rawValue, entry.type);
  await afterMutation();
}

export async function resetSetting(key) {
  const entry = GLOBAL_SETTINGS[key];
  if (!entry) return;
  state.data.config[key] = entry.default;
  await afterMutation();
}

export async function resetAllSettings() {
  for (const [key, entry] of Object.entries(GLOBAL_SETTINGS)) {
    state.data.config[key] = entry.default;
  }
  await afterMutation();
}

/** Save connection configuration options. */
export async function saveConnectionConfig({ url, key, jsExecution }) {
  Object.assign(state.data.config, { url, key, jsExecution });
  await persistConfig();
  invalidateContext();
  emit(EVENTS.SESSION);
}

export function setActiveModel(model) {
  state.data.config.lastModel = model;
  return persistConfig();
}
