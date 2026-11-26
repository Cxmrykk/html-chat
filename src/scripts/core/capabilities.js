import { formatCompactCount } from './format.js';

/**
 * What a model can do, as far as its endpoint is willing to say.
 *
 *   { source, chat, tools, vision, thinking, reasoningLevels, contextLength }
 *
 * Every field is `null` when unknown, and unknown always means "behave as if
 * there were no capability data at all": tools are offered, and the user's
 * own reasoning levels are used. Only an explicit `false` takes anything away.
 *
 * The OpenAI spec has no capability fields, so they are read from three
 * places:
 *
 *   - `/models` entries (`source: 'openai'`). The official API carries none,
 *     but several compatible servers do: OpenRouter's `supported_parameters`
 *     and `architecture.input_modalities`, a `capabilities` array or object,
 *     flat `supports_*` flags, a context length (`context_length`, vLLM's
 *     `max_model_len`, ...), and a list of reasoning efforts under any of
 *     `LEVEL_FIELDS`.
 *   - LiteLLM's `/model/info` or `/model_group/info` (`source: 'litellm'`):
 *     `supports_function_calling`, `supports_vision`, `supports_reasoning`,
 *     `mode`, `max_input_tokens`, and `supports_<level>_reasoning_effort`
 *     flags for levels beyond low / medium / high.
 *   - Ollama's `/api/show` (`source: 'ollama'`): its `capabilities` list
 *     (`completion`, `tools`, `vision`, `thinking`, `embedding`, ...) and the
 *     context length in `model_info`.
 *
 * `reasoningLevels` are the `reasoning_effort` values the model accepts, in
 * increasing order. `none`, when listed, is a real request not to think and
 * is sent; `DEFAULT_EFFORT` is never sent and leaves the choice to the server.
 */

export const CAPABILITY_SOURCES = ['openai', 'litellm', 'ollama'];

const SOURCE_LABELS = { openai: '/models', litellm: 'LiteLLM', ollama: 'Ollama' };

/** The effort choice that sends no `reasoning_effort` at all. */
export const DEFAULT_EFFORT = 'default';

/** Known efforts in increasing order; anything else sorts after them. */
const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];

/** Fields a `/models` entry may list its reasoning efforts under. */
const LEVEL_FIELDS = [
  'reasoning_efforts',
  'supported_reasoning_efforts',
  'reasoning_effort_levels',
  'reasoning_levels',
  'thinking_levels',
];

/** Fields a `/models` entry may give its context length under. */
const CONTEXT_FIELDS = ['context_length', 'context_window', 'max_model_len', 'max_input_tokens'];

/** Names a capability goes by, across servers. */
const FEATURE_ALIASES = {
  tools: ['tools', 'tool_use', 'tool_calling', 'function_calling', 'functions'],
  thinking: ['thinking', 'reasoning'],
  vision: ['vision', 'image', 'images', 'image_input'],
};

const FIELDS = ['source', 'chat', 'tools', 'vision', 'thinking', 'reasoningLevels', 'contextLength'];

export function emptyCapabilities() {
  return {
    source: null,
    chat: null,
    tools: null,
    vision: null,
    thinking: null,
    reasoningLevels: null,
    contextLength: null,
  };
}

/* ------------------------------------------------------------------ *
 * Normalising
 * ------------------------------------------------------------------ */

function bool(value) {
  return typeof value === 'boolean' ? value : null;
}

function positiveInt(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function lowerNames(list) {
  return list
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function rank(level) {
  const index = EFFORT_ORDER.indexOf(level);
  return index === -1 ? EFFORT_ORDER.length : index;
}

/** Unique, lower-cased effort values in increasing order, or null if there are none. */
export function normalizeLevels(value) {
  if (!Array.isArray(value)) return null;
  const levels = [...new Set(lowerNames(value))].filter((level) => level !== DEFAULT_EFFORT);
  if (!levels.length) return null;
  return levels.sort((a, b) => rank(a) - rank(b));
}

/** Make the fields agree with each other. */
function settle(caps) {
  if (caps.reasoningLevels && caps.thinking === null) {
    caps.thinking = caps.reasoningLevels.some((level) => level !== 'none');
  }
  if (caps.thinking === false) caps.reasoningLevels = null;
  return caps;
}

/** Capabilities from anything: a stored record, an import, or nothing. */
export function normalizeCapabilities(value) {
  if (!value || typeof value !== 'object') return emptyCapabilities();
  return settle({
    source: CAPABILITY_SOURCES.includes(value.source) ? value.source : null,
    chat: bool(value.chat),
    tools: bool(value.tools),
    vision: bool(value.vision),
    thinking: bool(value.thinking),
    reasoningLevels: normalizeLevels(value.reasoningLevels),
    contextLength: positiveInt(value.contextLength),
  });
}

/** A `{ [modelId]: capabilities }` map, as stored in the config. */
export function normalizeCapabilityMap(value) {
  const map = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return map;
  for (const [id, caps] of Object.entries(value)) {
    if (typeof id === 'string' && id.trim()) map[id] = normalizeCapabilities(caps);
  }
  return map;
}

/** Whether anything at all is known about what the model can do. */
export function isKnown(caps) {
  const c = normalizeCapabilities(caps);
  return FIELDS.some((field) => field !== 'source' && c[field] !== null);
}

/** `base` with every field `override` knows replaced by its value. */
export function mergeCapabilities(base, override) {
  const out = normalizeCapabilities(base);
  const next = normalizeCapabilities(override);
  for (const field of FIELDS) {
    if (next[field] !== null) out[field] = next[field];
  }
  return settle(out);
}

function assignKnown(caps, flags) {
  for (const [key, value] of Object.entries(flags)) {
    if (value !== null && value !== undefined && caps[key] === null) caps[key] = value;
  }
}

/* ------------------------------------------------------------------ *
 * OpenAI-compatible `/models` entries
 * ------------------------------------------------------------------ */

/**
 * Features from a list of capability names. `exhaustive` lists are taken to
 * name everything the model can do, so a missing name is a `false`.
 */
function flagsFromNames(names, { exhaustive = false } = {}) {
  const list = lowerNames(names);
  const flags = {};
  for (const [feature, aliases] of Object.entries(FEATURE_ALIASES)) {
    const found = aliases.some((alias) => list.includes(alias));
    flags[feature] = found ? true : exhaustive ? false : null;
  }
  if (list.includes('completion') || list.includes('chat')) flags.chat = true;
  else if (list.includes('embedding') || list.includes('embeddings')) flags.chat = false;
  return flags;
}

/** Features from an object of flags, e.g. `{ tools: true, reasoning: false }`. */
function flagsFromObject(object) {
  const flags = {};
  for (const [feature, aliases] of Object.entries(FEATURE_ALIASES)) {
    for (const alias of aliases) {
      const value = object[alias] ?? object[`supports_${alias}`];
      if (typeof value === 'boolean') {
        flags[feature] = value;
        break;
      }
    }
  }
  return flags;
}

function levelsFrom(...sources) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const field of LEVEL_FIELDS) {
      const levels = normalizeLevels(source[field]);
      if (levels) return levels;
    }
    const nested = normalizeLevels(source.efforts);
    if (nested) return nested;
  }
  return null;
}

/** What a `/models` entry says about its model. Most say nothing. */
export function capabilitiesFromModelEntry(entry) {
  const caps = emptyCapabilities();
  if (!entry || typeof entry !== 'object') return caps;
  caps.source = 'openai';

  const declared = entry.capabilities;
  if (Array.isArray(declared)) assignKnown(caps, flagsFromNames(declared, { exhaustive: true }));
  else if (declared && typeof declared === 'object') assignKnown(caps, flagsFromObject(declared));

  // OpenRouter lists every request parameter the model honours.
  if (Array.isArray(entry.supported_parameters)) {
    const params = lowerNames(entry.supported_parameters);
    assignKnown(caps, {
      tools: params.includes('tools'),
      thinking:
        params.includes('reasoning') ||
        params.includes('include_reasoning') ||
        params.includes('reasoning_effort'),
    });
  }

  const modalities = entry.architecture?.input_modalities;
  if (Array.isArray(modalities)) assignKnown(caps, { vision: lowerNames(modalities).includes('image') });

  assignKnown(caps, flagsFromObject(entry));

  caps.reasoningLevels = levelsFrom(entry, declared, entry.reasoning);

  for (const field of CONTEXT_FIELDS) {
    const length = positiveInt(entry[field]);
    if (length) {
      caps.contextLength = length;
      break;
    }
  }
  if (!caps.contextLength) caps.contextLength = positiveInt(entry.meta?.n_ctx_train);

  return settle(caps);
}

/* ------------------------------------------------------------------ *
 * LiteLLM
 * ------------------------------------------------------------------ */

const LITELLM_BASE_LEVELS = ['low', 'medium', 'high'];
const LITELLM_LEVEL_FLAG = /^supports_([a-z]+)_reasoning_effort$/;
const LITELLM_CHAT_MODES = ['chat', 'completion', 'responses'];

/**
 * A reasoning model takes low / medium / high; anything beyond that (`none`,
 * `minimal`, `xhigh`) is flagged per model in LiteLLM's model map, and an
 * explicit `false` removes a base level.
 */
function liteLLMLevels(info) {
  const levels = new Set(LITELLM_BASE_LEVELS);
  for (const [key, value] of Object.entries(info)) {
    const match = LITELLM_LEVEL_FLAG.exec(key);
    if (!match || typeof value !== 'boolean') continue;
    if (value) levels.add(match[1]);
    else levels.delete(match[1]);
  }
  return normalizeLevels([...levels]);
}

/**
 * One LiteLLM model: a `/model_group/info` entry, or the `model_info` of a
 * `/model/info` entry. Both use the same field names.
 */
export function capabilitiesFromLiteLLM(info) {
  const caps = emptyCapabilities();
  caps.source = 'litellm';
  if (!info || typeof info !== 'object') return caps;

  caps.tools = bool(info.supports_function_calling);
  caps.vision = bool(info.supports_vision);
  caps.thinking = bool(info.supports_reasoning);

  if (caps.tools === null && Array.isArray(info.supported_openai_params)) {
    caps.tools = lowerNames(info.supported_openai_params).includes('tools');
  }
  if (typeof info.mode === 'string' && info.mode) {
    caps.chat = LITELLM_CHAT_MODES.includes(info.mode.toLowerCase());
  }
  caps.contextLength = positiveInt(info.max_input_tokens);
  if (caps.thinking) caps.reasoningLevels = liteLLMLevels(info);

  return settle(caps);
}

/* ------------------------------------------------------------------ *
 * Ollama
 * ------------------------------------------------------------------ */

/**
 * Ollama's OpenAI-compatible endpoint maps `reasoning_effort` onto `think`:
 * `none` turns thinking off, anything else turns it on. Only gpt-oss also
 * reads the level itself, and it cannot be switched off at all. Every other
 * thinking model is on or off, so it is offered `none` and one "on" value.
 */
const OLLAMA_LEVELED = ['low', 'medium', 'high'];
const OLLAMA_SWITCHED = ['none', 'high'];

function takesEffortLevels(payload, id) {
  const details = payload.details || {};
  const families = [details.family, ...(Array.isArray(details.families) ? details.families : [])];
  const architecture = payload.model_info?.['general.architecture'];
  return (
    [...families, architecture].some((name) => typeof name === 'string' && /^gpt-?oss$/i.test(name)) ||
    /gpt-oss/i.test(id || '')
  );
}

function ollamaContextLength(info) {
  if (!info || typeof info !== 'object') return null;
  const architecture = info['general.architecture'];
  if (typeof architecture === 'string') {
    const length = positiveInt(info[`${architecture}.context_length`]);
    if (length) return length;
  }
  for (const [key, value] of Object.entries(info)) {
    if (!key.endsWith('.context_length')) continue;
    const length = positiveInt(value);
    if (length) return length;
  }
  return null;
}

/** One `/api/show` response. Its capability list names everything the model can do. */
export function capabilitiesFromOllamaShow(payload, id = '') {
  const caps = emptyCapabilities();
  caps.source = 'ollama';
  if (!payload || typeof payload !== 'object') return caps;

  if (Array.isArray(payload.capabilities)) {
    const names = lowerNames(payload.capabilities);
    caps.chat = names.includes('completion');
    caps.tools = names.includes('tools');
    caps.vision = names.includes('vision');
    caps.thinking = names.includes('thinking');
  }
  if (caps.thinking) {
    caps.reasoningLevels = takesEffortLevels(payload, id) ? OLLAMA_LEVELED : OLLAMA_SWITCHED;
  }
  caps.contextLength = ollamaContextLength(payload.model_info);

  return settle(caps);
}

/* ------------------------------------------------------------------ *
 * Reasoning effort
 * ------------------------------------------------------------------ */

/** The user's own level list: one per line. */
export function manualLevels(text) {
  const levels = [
    ...new Set(
      String(text ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
  return levels.length ? levels : ['none'];
}

/**
 * The effort choices for a model.
 *
 *   - The endpoint reported its levels: `default` first, then those levels.
 *   - The endpoint says it does not think: `default` alone.
 *   - Nothing reported: the user's own list, where `none` keeps its old
 *     meaning of "send nothing".
 *
 * `reported` tells which of these applies; `source` is who reported it.
 */
export function reasoningChoices(caps, manualText) {
  const c = normalizeCapabilities(caps);
  if (c.thinking === false) {
    return { levels: [DEFAULT_EFFORT], reported: true, source: c.source };
  }
  if (c.reasoningLevels) {
    return { levels: [DEFAULT_EFFORT, ...c.reasoningLevels], reported: true, source: c.source };
  }
  return { levels: manualLevels(manualText), reported: false, source: null };
}

/**
 * The `reasoning_effort` to send, or null to send none. A reported model only
 * receives a level it reported; an effort chosen for another model falls back
 * to the server's default rather than failing the request.
 */
export function reasoningEffortToSend(effort, caps, manualText) {
  const value = typeof effort === 'string' ? effort.trim() : '';
  if (!value || value === DEFAULT_EFFORT) return null;

  const { levels, reported } = reasoningChoices(caps, manualText);
  if (!reported) return value === 'none' ? null : value;
  return levels.includes(value) ? value : null;
}

/* ------------------------------------------------------------------ *
 * Display
 * ------------------------------------------------------------------ */

export function capabilitySourceLabel(source) {
  return SOURCE_LABELS[source] || 'the endpoint';
}

/** One line, e.g. "tools, thinking (low, medium, high), 131.1k context (Ollama)". */
export function describeCapabilities(caps) {
  const c = normalizeCapabilities(caps);
  if (!isKnown(c)) return '';

  const parts = [];
  if (c.chat === false) parts.push('not a chat model');
  if (c.tools !== null) parts.push(c.tools ? 'tools' : 'no tools');
  if (c.thinking !== null) {
    if (!c.thinking) parts.push('no thinking');
    else parts.push(c.reasoningLevels ? `thinking (${c.reasoningLevels.join(', ')})` : 'thinking');
  }
  if (c.vision) parts.push('vision');
  if (c.contextLength) {
    parts.push(`${formatCompactCount(c.contextLength) || c.contextLength} context`);
  }

  return `${parts.join(', ')} (${capabilitySourceLabel(c.source)})`;
}
