import { EVENTS } from '../store/events.js';
import { state, emit, persistConfig, invalidateContext } from '../store/state.js';
import { GLOBAL_SETTINGS } from '../core/settings-schema.js';
import { coerceForStorage } from '../core/values.js';
import { resetAllEmbeddings } from './indexing.js';

/** The global advanced settings. Per-file search configuration lives in profiles. */

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

async function afterMutation(previousEmbeddingsModel) {
  await persistConfig();
  if (previousEmbeddingsModel !== state.data.config.embeddingsModel) {
    await resetAllEmbeddings();
  }
  // Extra models change the dropdown; the embeddings model changes which
  // search methods can run, and so the tools, the file list and the banner.
  emit(EVENTS.MODELS);
  emit(EVENTS.CHAT_FILES);
  emit(EVENTS.FILES);
  invalidateContext();
}

export async function saveSetting(key, rawValue) {
  const entry = GLOBAL_SETTINGS[key];
  if (!entry) return;
  const previousModel = state.data.config.embeddingsModel;
  state.data.config[key] = coerceForStorage(rawValue, entry.type);
  await afterMutation(previousModel);
}

export async function resetSetting(key) {
  const entry = GLOBAL_SETTINGS[key];
  if (!entry) return;
  const previousModel = state.data.config.embeddingsModel;
  state.data.config[key] = entry.default;
  await afterMutation(previousModel);
}

export async function resetAllSettings() {
  const previousModel = state.data.config.embeddingsModel;
  for (const [key, entry] of Object.entries(GLOBAL_SETTINGS)) {
    state.data.config[key] = entry.default;
  }
  await afterMutation(previousModel);
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
