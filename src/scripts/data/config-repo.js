import * as idb from './idb.js';
import { KEYS } from './keys.js';
import { GLOBAL_SETTINGS } from '../core/settings-schema.js';
import { normalizeModelList } from '../core/models.js';

const BASE_CONFIG = {
  url: 'https://api.openai.com/v1',
  key: '',
  models: [],
  jsExecution: false,
  lastModel: '',
  reasoningEffort: 'none',
  availableReasoningLevels: 'none\nlow\nmedium\nhigh',
  autoCollapseCode: true,
  codeCollapseThreshold: 20,
  codeCollapsePreviewLines: 5,
  showCodeCollapseHint: true,
};

/**
 * Fields from before JavaScript execution became a tool: the switch carries
 * over under its new name, and the system prompt that used to drive the
 * feature has no successor (the tool's description does that job now).
 */
function migrateLegacyFields(stored) {
  const config = { ...stored };
  if (config.jsExecution === undefined && config.godMode !== undefined) {
    config.jsExecution = Boolean(config.godMode);
  }
  delete config.godMode;
  delete config.godModePrompt;
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
  return config;
}

export function saveConfig(config) {
  return idb.set(KEYS.config, config);
}
