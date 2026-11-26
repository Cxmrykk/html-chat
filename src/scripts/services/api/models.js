import { modelEntriesFrom, modelEntryId, modelIdsFrom } from '../../core/models.js';
import {
  capabilitiesFromModelEntry,
  capabilitiesFromLiteLLM,
  capabilitiesFromOllamaShow,
  mergeCapabilities,
  isKnown,
} from '../../core/capabilities.js';

/**
 * Model discovery: the `/models` list, and what each model can do.
 *
 * The OpenAI spec stops at ids, so capabilities are also asked of the two
 * servers that publish them, at their native routes beside the OpenAI ones
 * (the base URL without its `/v1`):
 *
 *   - LiteLLM: `GET /model/info`, falling back to `GET /model_group/info`;
 *   - Ollama:  `GET /api/version` to recognise it, then `POST /api/show`
 *              once per model.
 *
 * A probe that fails only means "not this kind of server". Takes config
 * explicitly; touches no state.
 */

/** Hosts known to be neither, where probing would only log failed requests. */
const NO_PROBE_HOSTS = ['api.openai.com', 'openrouter.ai'];

/** `/api/show` requests in flight at once. */
const OLLAMA_CONCURRENCY = 4;

function baseOf(config) {
  return (config.url || '').trim().replace(/\/+$/, '');
}

/** Where provider-native routes live: the base URL without its OpenAI `/v1` suffix. */
function rootOf(base) {
  return base.replace(/\/v1$/i, '');
}

function skipsProbes(base) {
  try {
    const host = new URL(base).hostname.toLowerCase();
    return NO_PROBE_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
  } catch {
    return true;
  }
}

function authHeaders(config) {
  // Local servers need no key, and some reject an empty Bearer token.
  return config.key ? { Authorization: `Bearer ${config.key}` } : {};
}

async function requestJSON(url, { config, signal, method = 'GET', body } = {}) {
  const headers = authHeaders(config);
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(url, {
    method,
    headers,
    signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const message =
      detail.error?.message || (typeof detail.error === 'string' ? detail.error : '');
    throw new Error(message || `HTTP ${response.status}`);
  }
  return response.json();
}

/** Run a probe; anything but the user's abort resolves with null. */
async function probe(run, signal) {
  try {
    return await run();
  } catch (error) {
    if (error.name === 'AbortError' || signal?.aborted) throw error;
    return null;
  }
}

async function eachLimited(items, limit, run) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/* ------------------------------------------------------------------ *
 * LiteLLM
 * ------------------------------------------------------------------ */

/**
 * `{ [model]: capabilities }` from a LiteLLM list, or null if it is not one.
 * A model served by several deployments is listed once per deployment; the
 * first entry wins, and later ones only fill in what it left unknown.
 */
function liteLLMMap(payload, idOf, infoOf) {
  const entries = Array.isArray(payload?.data) ? payload.data : null;
  if (!entries || !entries.length) return null;

  const map = {};
  for (const entry of entries) {
    const id = idOf(entry);
    if (typeof id !== 'string' || !id) continue;
    const caps = capabilitiesFromLiteLLM(infoOf(entry));
    map[id] = map[id] ? mergeCapabilities(caps, map[id]) : caps;
  }
  return Object.keys(map).length ? map : null;
}

/**
 * `/model/info` carries the full model map, including the per-level effort
 * flags; `/model_group/info` is the fallback for keys that may not read it.
 */
async function probeLiteLLM(config, root, signal) {
  const detailed = await probe(() => requestJSON(`${root}/model/info`, { config, signal }), signal);
  const fromDetailed = liteLLMMap(
    detailed,
    (entry) => entry?.model_name,
    (entry) => entry?.model_info,
  );
  if (fromDetailed) return fromDetailed;

  const grouped = await probe(
    () => requestJSON(`${root}/model_group/info`, { config, signal }),
    signal,
  );
  return liteLLMMap(
    grouped,
    (entry) => entry?.model_group,
    (entry) => entry,
  );
}

/* ------------------------------------------------------------------ *
 * Ollama
 * ------------------------------------------------------------------ */

async function probeOllama(config, root, ids, signal) {
  const version = await probe(() => requestJSON(`${root}/api/version`, { config, signal }), signal);
  if (typeof version?.version !== 'string') return null;

  const map = {};
  await eachLimited(ids, OLLAMA_CONCURRENCY, async (id) => {
    const shown = await probe(
      () =>
        requestJSON(`${root}/api/show`, { config, signal, method: 'POST', body: { model: id } }),
      signal,
    );
    if (shown) map[id] = capabilitiesFromOllamaShow(shown, id);
  });
  return Object.keys(map).length ? map : null;
}

/* ------------------------------------------------------------------ *
 * Catalog
 * ------------------------------------------------------------------ */

/**
 * The model ids `/models` lists, and `{ [id]: capabilities }` for every model
 * anything is known about. `/models` failing is an error; a probe failing is
 * not. `probe: false` reads `/models` alone.
 */
export async function fetchModelCatalog(config, { signal, probe: shouldProbe = true } = {}) {
  const base = baseOf(config);
  const payload = await requestJSON(`${base}/models`, { config, signal });
  const ids = modelIdsFrom(payload);

  const capabilities = {};
  for (const entry of modelEntriesFrom(payload)) {
    const id = modelEntryId(entry);
    if (!id) continue;
    const caps = capabilitiesFromModelEntry(entry);
    if (isKnown(caps)) capabilities[id] = caps;
  }

  if (shouldProbe && !skipsProbes(base)) {
    const root = rootOf(base);
    const [litellm, ollama] = await Promise.all([
      probeLiteLLM(config, root, signal),
      probeOllama(config, root, ids, signal),
    ]);
    // A native answer is more specific than a `/models` entry, so it wins.
    for (const [id, caps] of Object.entries(litellm || ollama || {})) {
      capabilities[id] = mergeCapabilities(capabilities[id], caps);
    }
  }

  return { ids, capabilities };
}
