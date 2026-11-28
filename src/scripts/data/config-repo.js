import * as idb from './idb.js';
import { KEYS } from './keys.js';
import { GLOBAL_SETTINGS } from '../core/settings-schema.js';
import { normalizeModelList, modelNamesFrom, mergeModelLists } from '../core/models.js';
import { normalizeCapabilityMap, DEFAULT_EFFORT } from '../core/capabilities.js';
import { normalizeModelParams } from '../core/model-params.js';

const BASE_CONFIG = {
  url: 'https://api.openai.com/v1',
  key: '',
  models: [],
  /** `{ [modelId]: capabilities }`, cached from the last discovery (core/capabilities.js). */
  modelCapabilities: {},
  /** `{ [modelId]: { [settingKey]: value } }`, per-model LLM parameters (core/model-params.js). */
  modelParams: {},
  /** The models picked by hand as image models (Identify Image Models). */
  imageModels: [],
  /** Image models the image tools may not use (Toggle Image Models). Every other one they may. */
  imageToolExcluded: [],
  /** The models Filter Models names: hidden or shown alone, per Model Filter Mode. */
  modelFilterList: [],
  jsExecution: false,
  /** The sidebar's Image Manipulation switch: whether the image tools may be offered. */
  imageGeneration: false,
  lastModel: '',
  reasoningEffort: DEFAULT_EFFORT,
  availableReasoningLevels: 'none\nlow\nmedium\nhigh',
  autoCollapseCode: true,
  codeCollapseThreshold: 20,
  codeCollapsePreviewLines: 5,
  showCodeCollapseHint: true,
};

/**
 * Global settings that no longer exist. File search has been removed, and
 * with it every setting that configured it: tool descriptions, embeddings,
 * the retrieval budget and its batching, and the sidebar's file list. The
 * chat list now always fills the sidebar, so its height limit is gone too.
 * Image models can no longer be chatted with directly, so the switch that
 * offered them in the dropdown, and the parameters sent with those requests,
 * are gone as well.
 */
const RETIRED_FIELDS = [
  'godModePrompt',
  'searchToolDescription',
  'fileWrapperFunc',
  'ragThreshold',
  'chunkMaxTokens',
  'textSearchToolDescription',
  'regexSearchToolDescription',
  'semanticSearchToolDescription',
  'embeddingsUrl',
  'embeddingsKey',
  'embeddingsModel',
  'maxRagTokens',
  'chunkBatchSize',
  'chunkBatchMaxTokens',
  'maxVisibleFiles',
  'maxVisibleChats',
  'imageModelsInChat',
  'imageParams',
];

/**
 * Defaults that have since changed, as they were stored. A default is stored
 * as the schema's string, while a value the user saved is coerced to a number
 * (`core/values.js`), so a stored string equal to the old default was never
 * chosen: it is dropped, and the new default takes its place.
 */
const RETIRED_DEFAULTS = {
  visionMaxPixels: '0',
  editMaxPixels: '1048576',
};

/**
 * Image models used to be typed into a text setting (Image Models), on top of
 * those the endpoint reported, and the image tools were given an allow-list
 * (Image Tool Models). Both lists become the identified image models, and
 * every one of them the old allow-list did not name is excluded from the
 * tools, so the tools keep offering exactly what they did. Models that were
 * only reported as image models are not carried over: nothing records them.
 */
function migrateImageModels(stored, config) {
  if (stored.imageToolExcluded !== undefined) return;
  if (stored.imageModels === undefined && stored.imageToolModels === undefined) return;
  const manual = modelNamesFrom(stored.imageModels);
  const allowed = modelNamesFrom(stored.imageToolModels);
  config.imageModels = mergeModelLists(manual, allowed);
  config.imageToolExcluded = config.imageModels.filter((id) => !allowed.includes(id));
}

/**
 * Fields from before JavaScript execution became a tool: the switch carries
 * over under its new name, and the system prompt that used to drive the
 * feature has no successor (the tool's description does that job now).
 *
 * Before capabilities, a reasoning effort of `none` meant "send nothing". It
 * now means "do not think" for a model whose endpoint reports it, which an
 * Ollama model would obey. A record from before capabilities (it has no
 * `modelCapabilities`) keeps its meaning as `default`, once.
 */
function migrateLegacyFields(stored) {
  const config = { ...stored };
  if (config.jsExecution === undefined && config.godMode !== undefined) {
    config.jsExecution = Boolean(config.godMode);
  }
  delete config.godMode;
  for (const field of RETIRED_FIELDS) delete config[field];
  for (const [key, old] of Object.entries(RETIRED_DEFAULTS)) {
    if (config[key] === old) delete config[key];
  }

  if (stored.modelCapabilities === undefined && stored.reasoningEffort === 'none') {
    config.reasoningEffort = DEFAULT_EFFORT;
  }

  migrateImageModels(stored, config);
  delete config.imageToolModels;
  return config;
}

/**
 * Any config record (stored, or imported from a settings export) brought up
 * to the current shape: legacy fields migrated, missing schema keys filled
 * with their defaults, and every list and map validated.
 */
export function normalizeConfig(record) {
  const stored = migrateLegacyFields(record && typeof record === 'object' ? record : {});
  const config = { ...BASE_CONFIG, ...stored };
  for (const [key, entry] of Object.entries(GLOBAL_SETTINGS)) {
    if (config[key] === undefined) config[key] = entry.default;
  }
  // Legacy installs stored a comma-separated string; it becomes the initial cache.
  config.models = normalizeModelList(config.models);
  config.modelCapabilities = normalizeCapabilityMap(config.modelCapabilities);
  config.modelParams = normalizeModelParams(config.modelParams);
  config.imageModels = modelNamesFrom(config.imageModels);
  config.imageToolExcluded = modelNamesFrom(config.imageToolExcluded);
  config.modelFilterList = modelNamesFrom(config.modelFilterList);
  config.jsExecution = Boolean(config.jsExecution);
  config.imageGeneration = Boolean(config.imageGeneration);
  config.url = typeof config.url === 'string' ? config.url : BASE_CONFIG.url;
  config.key = typeof config.key === 'string' ? config.key : '';
  return config;
}

/** Load the config, filling in any schema keys the stored record predates. */
export async function loadConfig() {
  return normalizeConfig((await idb.get(KEYS.config)) || {});
}

export function saveConfig(config) {
  return idb.set(KEYS.config, config);
}
