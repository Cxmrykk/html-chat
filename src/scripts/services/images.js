import { EVENTS } from '../store/events.js';
import { state, emit } from '../store/state.js';
import { GLOBAL_SETTINGS } from '../core/settings-schema.js';
import { pickNumber } from '../core/values.js';
import { attachmentsOf, sendsImages, normalizeAttachment } from '../core/attachments.js';
import * as imageCache from '../data/image-cache.js';

/**
 * Original images: taking them in, keeping them for the session (and, within
 * a cap, across reloads), restoring them from files, and turning attachments
 * into what a request sends.
 *
 * A chat stores only an attachment's record (`core/attachments.js`). The
 * original is held here by hash, in memory as an object URL, and copied into
 * the Cache API (`data/image-cache.js`) while it fits. An image found in
 * neither is a placeholder: shown pixelated, and sent scaled up to the
 * original's size, since endpoints refuse images that small.
 *
 * Status changes are announced with `EVENTS.IMAGES` so anything showing the
 * image can swap the placeholder for the original in place.
 */

/** The longest side of a placeholder, in pixels. */
const PLACEHOLDER_MAX_SIDE = 16;
const DEFAULT_CACHE_MB = 100;

/** hash -> { blob, url }: originals held this session. */
const originals = new Map();
/** hash -> 'checking' | 'missing', for hashes with no original held. */
const lookups = new Map();
/** hash -> Promise of the cache lookup in flight. */
const pendingLookups = new Map();
/** hash -> data URL of an original, as sent. */
const wireOriginals = new Map();
/** `${width}x${height}:${placeholder}` -> data URL of the upscaled placeholder. */
const wirePlaceholders = new Map();

function announce(hash) {
  emit(EVENTS.IMAGES, { hash });
}

/* ------------------------------------------------------------------ *
 * Hashing
 * ------------------------------------------------------------------ */

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A stable 64-bit hash for contexts without SubtleCrypto. Not cryptographic. */
function cyrb64(bytes) {
  let h1 = 0xdeadbeef ^ bytes.length;
  let h2 = 0x41c6ce57 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 2654435761);
    h2 = Math.imul(h2 ^ bytes[i], 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

function hasSubtle() {
  return typeof crypto !== 'undefined' && typeof crypto.subtle?.digest === 'function';
}

const ALGORITHMS = {
  sha256: {
    available: hasSubtle,
    run: async (buffer) => toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))),
  },
  cyrb64: {
    available: () => true,
    run: async (buffer) => cyrb64(new Uint8Array(buffer)),
  },
};

function preferredAlgorithm() {
  return ALGORITHMS.sha256.available() ? 'sha256' : 'cyrb64';
}

function algorithmOf(hash) {
  return String(hash).split('-')[0];
}

function isAvailable(algorithm) {
  return Boolean(ALGORITHMS[algorithm]?.available());
}

async function hashWith(algorithm, buffer) {
  return `${algorithm}-${await ALGORITHMS[algorithm].run(buffer)}`;
}

/* ------------------------------------------------------------------ *
 * Holding originals
 * ------------------------------------------------------------------ */

export function cacheCapBytes() {
  const mb = pickNumber(
    DEFAULT_CACHE_MB,
    state.data.config.imageCacheMB,
    GLOBAL_SETTINGS.imageCacheMB.default,
  );
  return Math.max(0, mb) * 1024 * 1024;
}

function hold(hash, blob) {
  if (originals.has(hash)) return;
  originals.set(hash, { blob, url: URL.createObjectURL(blob) });
  lookups.delete(hash);
  wireOriginals.delete(hash);
}

/** Keep `blob` as the original of `hash`: in memory now, and in the cache if it fits. */
export function keepOriginal(hash, blob) {
  hold(hash, blob);
  // Not awaited: the cache is a convenience, and fails soft.
  imageCache.putImage(hash, blob, cacheCapBytes());
  announce(hash);
}

/** Bring the cache back under the configured cap. */
export function trimImageCache() {
  return imageCache.trimImages(cacheCapBytes());
}

/** The object URL of a held original, or null. */
export function imageUrlFor(hash) {
  return originals.get(hash)?.url ?? null;
}

/** 'original' | 'checking' | 'missing' | 'unknown' (not looked for yet). */
export function imageStatus(hash) {
  if (originals.has(hash)) return 'original';
  return lookups.get(hash) || 'unknown';
}

/**
 * The original's bytes, from memory or the cache, or null when only the
 * placeholder is left. A hash once found missing is not looked for again:
 * only a restore can bring it back, and that holds it in memory.
 */
export function originalBlob(hash) {
  const held = originals.get(hash);
  if (held) return Promise.resolve(held.blob);
  if (lookups.get(hash) === 'missing') return Promise.resolve(null);

  if (!pendingLookups.has(hash)) {
    lookups.set(hash, 'checking');
    pendingLookups.set(
      hash,
      (async () => {
        const blob = await imageCache.getImage(hash);
        pendingLookups.delete(hash);
        // Restored while the cache was being read.
        if (originals.has(hash)) return originals.get(hash).blob;
        if (blob) hold(hash, blob);
        else lookups.set(hash, 'missing');
        announce(hash);
        return blob;
      })(),
    );
  }
  return pendingLookups.get(hash);
}

/** Start looking for an original nobody has asked about yet. */
export function requestImage(hash) {
  if (imageStatus(hash) === 'unknown') originalBlob(hash);
}

/* ------------------------------------------------------------------ *
 * Taking images in
 * ------------------------------------------------------------------ */

export function isImageFile(file) {
  return Boolean(file) && typeof file.type === 'string' && file.type.startsWith('image/');
}

async function decode(blob, name) {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('This browser cannot decode images here.');
  }
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new Error(`"${name}" could not be read as an image.`);
  }
}

/** The pixelated stand-in: at most `PLACEHOLDER_MAX_SIDE` on its longest side. */
function placeholderOf(bitmap) {
  const scale = Math.min(1, PLACEHOLDER_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/** Hash, measure and hold one image file, and resolve with its attachment record. */
export async function ingestImage(file) {
  const name = file.name || 'image';
  const buffer = await file.arrayBuffer();
  const bitmap = await decode(file, name);

  let record;
  try {
    record = normalizeAttachment({
      hash: await hashWith(preferredAlgorithm(), buffer),
      name,
      type: file.type || 'image/png',
      width: bitmap.width,
      height: bitmap.height,
      size: file.size,
      placeholder: placeholderOf(bitmap),
    });
  } finally {
    bitmap.close?.();
  }

  if (!record) throw new Error(`"${name}" could not be read as an image.`);
  keepOriginal(record.hash, file);
  return record;
}

/** Ingest several files; a file that fails is reported, not fatal. */
export async function ingestImages(files) {
  const records = [];
  const errors = [];
  for (const file of files) {
    try {
      records.push(await ingestImage(file));
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { records, errors };
}

/* ------------------------------------------------------------------ *
 * Restoring
 * ------------------------------------------------------------------ */

/** Every hash, in any chat, whose original is not held right now. */
export function placeholderHashes() {
  const hashes = new Set();
  for (const chat of state.data.chats) {
    for (const message of chat.messages) {
      for (const attachment of attachmentsOf(message)) {
        if (!originals.has(attachment.hash)) hashes.add(attachment.hash);
      }
    }
  }
  return hashes;
}

/**
 * Which files are the originals of which targets. Each file is hashed with
 * every algorithm the targets were hashed with.
 * Resolves with `{ matches: Map<hash, File>, unmatched: File[] }`.
 */
export async function matchImageFiles(files, targets) {
  const wanted = new Set(targets);
  const algorithms = [...new Set([...wanted].map(algorithmOf))].filter(isAvailable);
  const matches = new Map();
  const unmatched = [];

  for (const file of files) {
    let hit = null;
    if (isImageFile(file) && algorithms.length) {
      const buffer = await file.arrayBuffer();
      for (const algorithm of algorithms) {
        const hash = await hashWith(algorithm, buffer);
        if (wanted.has(hash)) {
          hit = hash;
          break;
        }
      }
    }
    if (hit) matches.set(hit, file);
    else unmatched.push(file);
  }

  return { matches, unmatched };
}

export function restoreOriginals(matches) {
  for (const [hash, file] of matches) keepOriginal(hash, file);
}

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

/** The attachments a request built from `messages` would send as placeholders. */
export async function missingImages(messages) {
  const missing = [];
  for (const message of messages || []) {
    if (!sendsImages(message)) continue;
    for (const attachment of attachmentsOf(message)) {
      if (!(await originalBlob(attachment.hash))) missing.push(attachment);
    }
  }
  return missing;
}

function readDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function originalDataURL(hash, blob, type) {
  if (!wireOriginals.has(hash)) {
    const typed = blob.type.startsWith('image/') ? blob : new Blob([blob], { type });
    wireOriginals.set(hash, await readDataURL(typed));
  }
  return wireOriginals.get(hash);
}

/** The placeholder at the original's pixel size, blocks kept sharp. */
async function upscaledPlaceholder(attachment) {
  const key = `${attachment.width}x${attachment.height}:${attachment.placeholder}`;
  if (!wirePlaceholders.has(key)) {
    const image = new Image();
    image.src = attachment.placeholder;
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = attachment.width;
    canvas.height = attachment.height;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, attachment.width, attachment.height);
    wirePlaceholders.set(key, canvas.toDataURL('image/png'));
  }
  return wirePlaceholders.get(key);
}

/** `Map<hash, data URL>` for every image a request built from `messages` sends. */
export async function wireImages(messages) {
  const images = new Map();
  for (const message of messages || []) {
    if (!sendsImages(message)) continue;
    for (const attachment of attachmentsOf(message)) {
      if (images.has(attachment.hash)) continue;
      const blob = await originalBlob(attachment.hash);
      images.set(
        attachment.hash,
        blob
          ? await originalDataURL(attachment.hash, blob, attachment.type)
          : await upscaledPlaceholder(attachment),
      );
    }
  }
  return images;
}
