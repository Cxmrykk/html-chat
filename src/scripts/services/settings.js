import { EVENTS } from '../store/events.js';
import { state, emit, persistConfig, invalidateContext } from '../store/state.js';
import {
  GLOBAL_SETTINGS,
  PER_MODEL_KEYS,
  isPerModel,
  describeSetting,
} from '../core/settings-schema.js';
import { coerceForStorage } from '../core/values.js';
import {
  coerceOverride,
  modelOverride,
  isOmitted,
  withOverride,
  withoutModel,
} from '../core/model-params.js';
import { refreshModels } from './models.js';
import { trimImageCache } from './images.js';

/**
 * The global advanced settings, and the per-model overrides of the LLM
 * parameters among them.
 *
 * Every function takes an optional `model`. Without one (or for a setting
 * that is not per-model) it works on the global value, which is the default
 * for every model; with one it works on that model's override.
 */

/** Settings that change what model discovery asks for, so the list is fetched again. */
const DISCOVERY_KEYS = ['probeCapabilities'];
/** Settings that change how much the image cache may hold. */
const IMAGE_CACHE_KEYS = ['imageCacheMB'];
/** Settings that change how the chat list is drawn. */
const CHAT_LIST_KEYS = ['chatDateGroups'];

/** Whether `key` is read and written as `model`'s override. */
function isScoped(key, model) {
  return Boolean(model) && isPerModel(key);
}

/** Current stored global value for a key. */
export function readSetting(key) {
  return state.data.config[key];
}

/**
 * The summary shown next to a setting in the list. For a model's override:
 * its value, "Not sent" for `none`, or what it inherits.
 */
export function describeScopedSetting(key, model = null) {
  const config = state.data.config;
  const global = describeSetting(GLOBAL_SETTINGS, key, config[key]);
  if (!isScoped(key, model)) return global;

  const override = modelOverride(config, model, key);
  if (override === undefined) return `Inherit (${global})`;
  if (isOmitted(override)) return 'Not sent';
  return describeSetting(GLOBAL_SETTINGS, key, override);
}

/**
 * Editor contents. Globally: the stored value, or the schema default when
 * unset. For a model: its override, or empty when it inherits.
 */
export function readEditorValue(key, model = null) {
  const entry = GLOBAL_SETTINGS[key];
  if (!entry) return '';

  if (isScoped(key, model)) {
    const override = modelOverride(state.data.config, model, key);
    return override === undefined ? '' : String(override);
  }

  const value = state.data.config[key];
  return value !== undefined && value !== '' ? String(value) : entry.default;
}

async function afterMutation(keys) {
  await persistConfig();
  // Extra models change the dropdown; tool settings change what every
  // request carries.
  emit(EVENTS.MODELS);
  invalidateContext();
  // Not awaited: the dropdown shows its loading state meanwhile.
  if (keys.some((key) => DISCOVERY_KEYS.includes(key))) refreshModels();
  // Not awaited: a smaller cap evicts the oldest originals in the background.
  if (keys.some((key) => IMAGE_CACHE_KEYS.includes(key))) trimImageCache();
  if (keys.some((key) => CHAT_LIST_KEYS.includes(key))) emit(EVENTS.CHATS);
}

function setOverride(model, key, value) {
  const config = state.data.config;
  config.modelParams = withOverride(config.modelParams, model, key, value);
}

export async function saveSetting(key, rawValue, model = null) {
  const entry = GLOBAL_SETTINGS[key];
  if (!entry) return;
  if (isScoped(key, model)) {
    // Blank removes the override: the model inherits the default again.
    setOverride(model, key, coerceOverride(rawValue, entry.type));
  } else {
    state.data.config[key] = coerceForStorage(rawValue, entry.type);
  }
  await afterMutation([key]);
}

export async function resetSetting(key, model = null) {
  const entry = GLOBAL_SETTINGS[key];
  if (!entry) return;
  if (isScoped(key, model)) setOverride(model, key, undefined);
  else state.data.config[key] = entry.default;
  await afterMutation([key]);
}

/**
 * With a model: remove every override it has. Without one: reset every
 * global setting. Per-model overrides are kept either way for other models.
 */
export async function resetAllSettings(model = null) {
  const config = state.data.config;
  if (model) {
    config.modelParams = withoutModel(config.modelParams, model);
    await afterMutation(PER_MODEL_KEYS);
    return;
  }
  for (const [key, entry] of Object.entries(GLOBAL_SETTINGS)) {
    config[key] = entry.default;
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
