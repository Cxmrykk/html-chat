import { GLOBAL_SETTINGS, isPerModel } from './settings-schema.js';
import { isBlank, pick, coerceForStorage } from './values.js';

/**
 * Per-model overrides of the LLM parameters (the settings marked `perModel`):
 *
 *   config.modelParams = { [modelId]: { [settingKey]: value } }
 *
 * A request to a model uses its override where it has one, and the global
 * value (the default for every model) otherwise. An override is never blank:
 * removing it is what "inherit" means. The word `none` is an override of its
 * own: nothing is sent for that model, whatever the default says (for models
 * that reject `temperature`, say).
 */

export const OMIT = 'none';

export function isOmitted(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === OMIT;
}

/** A raw editor string as an override: a value, `OMIT`, or undefined (inherit). */
export function coerceOverride(raw, type) {
  if (isOmitted(raw)) return OMIT;
  const value = coerceForStorage(raw, type);
  return isBlank(value) ? undefined : value;
}

/** A stored or imported map reduced to known keys and valid, non-blank values. */
export function normalizeModelParams(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;

  for (const [model, params] of Object.entries(value)) {
    if (typeof model !== 'string' || !model.trim()) continue;
    if (!params || typeof params !== 'object' || Array.isArray(params)) continue;

    const kept = {};
    for (const [key, raw] of Object.entries(params)) {
      if (!isPerModel(key)) continue;
      const coerced = coerceOverride(raw, GLOBAL_SETTINGS[key].type);
      if (coerced !== undefined) kept[key] = coerced;
    }
    if (Object.keys(kept).length) out[model] = kept;
  }
  return out;
}

/** The override `model` has for `key`, or undefined when it inherits. */
export function modelOverride(config, model, key) {
  if (!model || !isPerModel(key)) return undefined;
  const value = config?.modelParams?.[model]?.[key];
  return isBlank(value) ? undefined : value;
}

/** Whether `model` overrides anything at all. */
export function hasOverrides(config, model) {
  const params = model ? config?.modelParams?.[model] : null;
  return Boolean(params) && Object.keys(params).length > 0;
}

/**
 * The value a request to `model` uses for `key`. Blank or `OMIT` means
 * nothing is sent.
 */
export function effectiveParam(config, model, key) {
  return pick(modelOverride(config, model, key), config?.[key]);
}

/** `params` with `model`'s override of `key` set, or removed when `value` is undefined. Pure. */
export function withOverride(params, model, key, value) {
  const all = { ...(params || {}) };
  const own = { ...(all[model] || {}) };
  if (value === undefined) delete own[key];
  else own[key] = value;
  if (Object.keys(own).length) all[model] = own;
  else delete all[model];
  return all;
}

/** `params` without any override for `model`. Pure. */
export function withoutModel(params, model) {
  const all = { ...(params || {}) };
  delete all[model];
  return all;
}
