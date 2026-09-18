/** Model id lists: normalising whatever shape they arrive in. */

/** Accepts an array or a legacy comma-separated string; returns trimmed, unique ids. */
export function normalizeModelList(value) {
  const items = Array.isArray(value) ? value : String(value ?? '').split(',');
  const ids = new Set();
  for (const item of items) {
    const id = typeof item === 'string' ? item.trim() : '';
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Union of several lists, first occurrence wins the position. */
export function mergeModelLists(...lists) {
  return normalizeModelList(lists.flatMap(normalizeModelList));
}

/**
 * Ids from a `/models` response. The spec says `{ data: [{ id }] }`; a few
 * servers answer with a bare array, a `models` key, or `name` instead of `id`.
 */
export function modelIdsFrom(payload) {
  const entries = Array.isArray(payload) ? payload : payload?.data ?? payload?.models ?? [];
  if (!Array.isArray(entries)) return [];
  const ids = entries.map((entry) => (typeof entry === 'string' ? entry : entry?.id ?? entry?.name));
  return normalizeModelList(ids).sort((a, b) => a.localeCompare(b));
}
