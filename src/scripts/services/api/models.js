import { modelIdsFrom } from '../../core/models.js';

/** Models endpoint client. Takes config explicitly; touches no state. */
export async function fetchModels(config, signal) {
  const base = (config.url || '').replace(/\/+$/, '');
  const headers = {};
  // Local servers need no key, and some reject an empty Bearer token.
  if (config.key) headers.Authorization = `Bearer ${config.key}`;

  const response = await fetch(`${base}/models`, { headers, signal });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error?.message || `HTTP ${response.status}`);
  }
  return modelIdsFrom(await response.json());
}
