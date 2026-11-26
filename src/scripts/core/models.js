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
 * The entries of a `/models` response. The spec says `{ data: [{ id }] }`; a
 * few servers answer with a bare array or a `models` key.
 */
export function modelEntriesFrom(payload) {
  const entries = Array.isArray(payload) ? payload : payload?.data ?? payload?.models ?? [];
  return Array.isArray(entries) ? entries : [];
}

/** An entry's id: the entry itself if it is a string, else `id`, else `name`. */
export function modelEntryId(entry) {
  const id = typeof entry === 'string' ? entry : entry?.id ?? entry?.name;
  return typeof id === 'string' ? id.trim() : '';
}

/** Ids from a `/models` response, sorted. */
export function modelIdsFrom(payload) {
  return normalizeModelList(modelEntriesFrom(payload).map(modelEntryId)).sort((a, b) =>
    a.localeCompare(b),
  );
}
