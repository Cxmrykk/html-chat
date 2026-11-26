import * as idb from './idb.js';
import { KEYS } from './keys.js';
import { GLOBAL_SETTINGS } from '../core/settings-schema.js';
import { normalizeModelList } from '../core/models.js';
import { normalizeCapabilityMap, DEFAULT_EFFORT } from '../core/capabilities.js';

const BASE_CONFIG = {
  url: 'https://api.openai.com/v1',
  key: '',
  models: [],
  /** `{ [modelId]: capabilities }`, cached from the last discovery (core/capabilities.js). */
  modelCapabilities: {},
  jsExecution: false,
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
];

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

  if (stored.modelCapabilities === undefined && stored.reasoningEffort === 'none') {
    config.reasoningEffort = DEFAULT_EFFORT;
  }
  return config;
}

/** Load the config, filling in any schema keys the stored record predates. */
export async function loadConfig() {
  const stored = migrateLegacyFields((await idb.get(KEYS.config)) || {});
  const config = { ...BASE_CONFIG, ...stored };
  for (const [key, entry] of Object.entries(GLOBAL_SETTINGS)) {
    if (config[key] === undefined) config[key] = entry.default;
  }
  // Legacy installs stored a comma-separated string; it becomes the initial cache.
  config.models = normalizeModelList(config.models);
  config.modelCapabilities = normalizeCapabilityMap(config.modelCapabilities);
  return config;
}

export function saveConfig(config) {
  return idb.set(KEYS.config, config);
}
