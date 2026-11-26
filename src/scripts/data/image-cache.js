/**
 * Original images, kept in the Cache API so they survive a reload. Chats never
 * hold them.
 *
 * The cache is capped: each entry records its size and when it was stored, and
 * the oldest go first. Every operation fails soft. A browser without the Cache
 * API (some do not offer it to file:// pages or private windows) simply keeps
 * originals in memory only.
 */

const CACHE_NAME = 'html-chat-images-v1';
/** Cache keys must be http(s) URLs; this one never reaches the network. */
const KEY_BASE = 'https://html-chat.invalid/images/';
const SIZE_HEADER = 'x-image-size';
const STORED_HEADER = 'x-stored-at';

let opened = null;

function openCache() {
  if (!opened) {
    opened = (async () => {
      try {
        if (typeof caches === 'undefined') return null;
        return await caches.open(CACHE_NAME);
      } catch {
        return null;
      }
    })();
  }
  return opened;
}

function keyFor(hash) {
  return `${KEY_BASE}${encodeURIComponent(hash)}`;
}

/** The original stored under `hash`, or null. */
export async function getImage(hash) {
  const cache = await openCache();
  if (!cache) return null;
  try {
    const response = await cache.match(keyFor(hash));
    return response ? await response.blob() : null;
  } catch {
    return null;
  }
}

async function listEntries(cache) {
  const entries = [];
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    if (!response) continue;
    entries.push({
      request,
      size: Number(response.headers.get(SIZE_HEADER)) || 0,
      storedAt: Number(response.headers.get(STORED_HEADER)) || 0,
    });
  }
  return entries;
}

/** Remove the oldest entries until at most `capBytes` are stored. `keep` is never removed. */
export async function trimImages(capBytes, keep = null) {
  const cache = await openCache();
  if (!cache) return;
  try {
    const entries = await listEntries(cache);
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    entries.sort((a, b) => a.storedAt - b.storedAt);

    const kept = keep ? keyFor(keep) : null;
    for (const entry of entries) {
      if (total <= capBytes) break;
      if (entry.request.url === kept) continue;
      await cache.delete(entry.request);
      total -= entry.size;
    }
  } catch {
    /* A cache that cannot be read is a cache that cannot be trimmed. */
  }
}

/**
 * Store an original, then trim back to the cap. An image larger than the
 * whole cap is not stored. Resolves with whether it was stored.
 */
export async function putImage(hash, blob, capBytes) {
  const cache = await openCache();
  if (!cache) return false;
  try {
    if (!(capBytes > 0) || blob.size > capBytes) {
      await cache.delete(keyFor(hash));
      return false;
    }
    await cache.put(
      keyFor(hash),
      new Response(blob, {
        headers: {
          'content-type': blob.type || 'application/octet-stream',
          [SIZE_HEADER]: String(blob.size),
          [STORED_HEADER]: String(Date.now()),
        },
      }),
    );
    await trimImages(capBytes, hash);
    return true;
  } catch {
    // Quota exceeded, or storage disabled: memory still has it.
    return false;
  }
}
