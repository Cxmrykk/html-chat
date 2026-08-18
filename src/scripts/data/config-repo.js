import * as idb from './idb.js';
import { KEYS } from './keys.js';
import { GLOBAL_SETTINGS } from '../core/settings-schema.js';

const BASE_CONFIG = {
  url: 'https://api.openai.com/v1',
  key: '',
  models: 'gpt-4o, gpt-4-turbo, gpt-3.5-turbo',
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
  return config;
}

export function saveConfig(config) {
  return idb.set(KEYS.config, config);
}
