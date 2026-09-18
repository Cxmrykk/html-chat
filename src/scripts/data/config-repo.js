import * as idb from './idb.js';
import { KEYS } from './keys.js';
import { GLOBAL_SETTINGS } from '../core/settings-schema.js';
import { normalizeModelList } from '../core/models.js';

const BASE_CONFIG = {
  url: 'https://api.openai.com/v1',
  key: '',
  models: [],
  godMode: false,
  lastModel: '',
};

/** Load the config, filling in any schema keys the stored record predates. */
export async function loadConfig() {
  const stored = (await idb.get(KEYS.config)) || {};
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
