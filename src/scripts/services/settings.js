import { EVENTS } from '../store/events.js';
import { state, emit, persistConfig, invalidateContext } from '../store/state.js';
import {
  GLOBAL_SETTINGS,
  PER_MODEL_KEYS,
  isPerModel,
  describeSetting,
} from '../core/settings-schema.js';
import { coerceForStorage, pickBoolean } from '../core/values.js';
import { modelNamesFrom } from '../core/models.js';
import {
  coerceOverride,
  modelOverride,
  isOmitted,
  withOverride,
  withoutModel,
} from '../core/model-params.js';
import { refreshModels, ensureActiveModel, imageModels } from './models.js';
import { trimImageCache } from './images.js';

/**
 * The global advanced settings, the per-model overrides of the LLM
 * parameters among them, and the hand-picked model lists.
 *
 * Every setting function takes an optional `model`. Without one (or for a
 * setting that is not per-model) it works on the global value, which is the
 * default for every model; with one it works on that model's override.
 */

/** Settings that change what model discovery asks for, so the list is fetched again. */
const DISCOVERY_KEYS = ['probeCapabilities'];
/** Settings (and lists) that change which models the dropdown offers. */
const MODEL_LIST_KEYS = ['extraModels', 'imageModels', 'modelFilterMode', 'modelFilterList'];
/** Settings that change how much the image cache may hold. */
const IMAGE_CACHE_KEYS = ['imageCacheMB'];
/**
 * Settings that change how the chat lists are drawn: the date groups, and
 * how many images each chat counts as sending.
 */
const CHAT_LIST_KEYS = ['chatDateGroups', 'sendGeneratedImages'];

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
  // A model that is no longer offered (one just identified as an image
  // model, or filtered out, say) must not stay selected.
  if (keys.some((key) => MODEL_LIST_KEYS.includes(key))) ensureActiveModel();
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

/** Flip an On/Off setting. */
export async function toggleSetting(key) {
  const entry = GLOBAL_SETTINGS[key];
  if (!entry || entry.type !== 'boolean') return;
  const current = pickBoolean(pickBoolean(false, entry.default), state.data.config[key]);
  state.data.config[key] = !current;
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
 * global setting. Per-model overrides are kept either way for other models,
 * and the model lists are not settings, so they are kept too.
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

/* ------------------------------------------------------------------ *
 * Model lists
 * ------------------------------------------------------------------ */

/**
 * Mark `id` as an image model, or unmark it (Identify Image Models). An
 * unmarked model also leaves the tools' exclusions, so marking it again
 * allows it, like any new one.
 */
export async function toggleImageModel(id) {
  if (!id) return;
  const config = state.data.config;
  const selected = modelNamesFrom(config.imageModels);
  if (selected.includes(id)) {
    config.imageModels = selected.filter((entry) => entry !== id);
    config.imageToolExcluded = modelNamesFrom(config.imageToolExcluded).filter(
      (entry) => entry !== id,
    );
  } else {
    config.imageModels = [...selected, id];
  }
  await afterMutation(['imageModels']);
}

/** Let the image tools use image model `id`, or stop them (Toggle Image Models). */
export async function toggleImageToolModel(id) {
  if (!id || !imageModels().includes(id)) return;
  const config = state.data.config;
  const excluded = modelNamesFrom(config.imageToolExcluded);
  config.imageToolExcluded = excluded.includes(id)
    ? excluded.filter((entry) => entry !== id)
    : [...excluded, id];
  await afterMutation(['imageToolExcluded']);
}

/** Add `id` to the model filter's list, or take it off (Filter Models). */
export async function toggleModelFilter(id) {
  if (!id) return;
  const config = state.data.config;
  const list = modelNamesFrom(config.modelFilterList);
  config.modelFilterList = list.includes(id)
    ? list.filter((entry) => entry !== id)
    : [...list, id];
  await afterMutation(['modelFilterList']);
}

/* ------------------------------------------------------------------ *
 * Connection
 * ------------------------------------------------------------------ */

/** Save connection configuration options, and the sidebar's tool switches. */
export async function saveConnectionConfig({ url, key, jsExecution, imageGeneration }) {
  Object.assign(state.data.config, {
    url,
    key,
    jsExecution: Boolean(jsExecution),
    imageGeneration: Boolean(imageGeneration),
  });
  await persistConfig();
  invalidateContext();
  emit(EVENTS.SESSION);
}

/**
 * A different model may take different tools and reasoning levels, so the
 * dropdown's description follows it.
 */
export function setActiveModel(model) {
  state.data.config.lastModel = model;
  invalidateContext();
  emit(EVENTS.MODELS);
  return persistConfig();
}
