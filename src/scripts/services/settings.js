import { EVENTS } from '../store/events.js';
import { state, emit, persistConfig, invalidateContext } from '../store/state.js';
import { GLOBAL_SETTINGS } from '../core/settings-schema.js';
import { coerceForStorage } from '../core/values.js';
import { refreshModels } from './models.js';
import { trimImageCache } from './images.js';

/** The global advanced settings. */

/** Settings that change what model discovery asks for, so the list is fetched again. */
const DISCOVERY_KEYS = ['probeCapabilities'];
/** Settings that change how much the image cache may hold. */
const IMAGE_CACHE_KEYS = ['imageCacheMB'];

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

async function afterMutation(keys) {
  await persistConfig();
  // Extra models change the dropdown; Max Visible Chats changes the chat list;
  // tool settings change what every request carries.
  emit(EVENTS.MODELS);
  emit(EVENTS.CHATS);
  invalidateContext();
  // Not awaited: the dropdown shows its loading state meanwhile.
  if (keys.some((key) => DISCOVERY_KEYS.includes(key))) refreshModels();
  // Not awaited: a smaller cap evicts the oldest originals in the background.
  if (keys.some((key) => IMAGE_CACHE_KEYS.includes(key))) trimImageCache();
}

export async function saveSetting(key, rawValue) {
  const entry = GLOBAL_SETTINGS[key];
  if (!entry) return;
  state.data.config[key] = coerceForStorage(rawValue, entry.type);
  await afterMutation([key]);
}

export async function resetSetting(key) {
  const entry = GLOBAL_SETTINGS[key];
  if (!entry) return;
  state.data.config[key] = entry.default;
  await afterMutation([key]);
}

export async function resetAllSettings() {
  for (const [key, entry] of Object.entries(GLOBAL_SETTINGS)) {
    state.data.config[key] = entry.default;
  }
  await afterMutation(Object.keys(GLOBAL_SETTINGS));
}

/** Save connection configuration options. */
export async function saveConnectionConfig({ url, key, jsExecution }) {
  Object.assign(state.data.config, { url, key, jsExecution });
  await persistConfig();
  invalidateContext();
  emit(EVENTS.SESSION);
}

/**
 * A different model may take different tools and reasoning levels, so the
 * context estimate and the dropdown's description follow it.
 */
export function setActiveModel(model) {
  state.data.config.lastModel = model;
  invalidateContext();
  emit(EVENTS.MODELS);
  return persistConfig();
}
