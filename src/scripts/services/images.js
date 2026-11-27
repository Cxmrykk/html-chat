import { EVENTS } from '../store/events.js';
import { state, emit } from '../store/state.js';
import { GLOBAL_SETTINGS } from '../core/settings-schema.js';
import { pickNumber, pickInteger, pickBoolean } from '../core/values.js';
import { allImagesOf, imagesToSend, normalizeAttachment } from '../core/attachments.js';
import * as imageCache from '../data/image-cache.js';
import { visionScaling, scalingKey, scaledSize, scaleImageBlob } from './image-scaling.js';

/**
 * Original images: taking them in, keeping them for the session (and, within
 * a cap, across reloads), restoring them from files, and turning attachments
 * into what a request sends.
 *
 * A chat stores only an attachment's record (`core/attachments.js`). The
 * original is held here by hash, in memory as an object URL, and copied into
 * the Cache API (`data/image-cache.js`) while it fits. An image found in
 * neither is a placeholder: shown pixelated, and sent scaled up to the
 * original's size, since endpoints refuse images that small. Images the model
 * generated are held exactly the same way.
 *
 * What a chat model is sent is scaled down to Vision Max Pixels first
 * (`services/image-scaling.js`), placeholders included.
 *
 * The user is warned before placeholders are sent, once per set: hashes they
 * have agreed to send as placeholders are remembered for the session, and
 * only a placeholder not among them warns again.
 *
 * Status changes are announced with `EVENTS.IMAGES` so anything showing the
 * image can swap the placeholder for the original in place.
 */

/**
 * Fallbacks for the Placeholder Width and Placeholder Max Pixels settings: a
 * placeholder starts this wide (never wider than the original), and is halved
 * in width until it holds at most this many pixels.
 */
const DEFAULT_PLACEHOLDER_WIDTH = 64;
const DEFAULT_PLACEHOLDER_MAX_PIXELS = 64 * 64;
/**
 * Placeholders are lossy: their colours need only be close. WebP keeps
 * transparency; where a browser cannot encode it, a PNG with each colour
 * channel rounded to `PNG_LEVELS` levels compresses nearly as well.
 */
const PLACEHOLDER_QUALITY = 0.5;
const PNG_LEVELS = 16;

const DEFAULT_CACHE_MB = 100;

/** hash -> { blob, url }: originals held this session. */
const originals = new Map();
/** hash -> 'checking' | 'missing', for hashes with no original held. */
const lookups = new Map();
/** hash -> Promise of the cache lookup in flight. */
const pendingLookups = new Map();
/** hash -> Map<scaling key, data URL of the original, as sent>. */
const wireOriginals = new Map();
/** `${width}x${height}:${placeholder}` -> data URL of the upscaled placeholder. */
const wirePlaceholders = new Map();
/** Hashes the user has agreed to send as placeholders this session. */
const acknowledged = new Set();

function announce(hash) {
  emit(EVENTS.IMAGES, { hash });
}

/** Whether Send Generated Images is on: images the model made go back to it. */
export function sendsGeneratedImages() {
  return pickBoolean(
    false,
    state.data.config.sendGeneratedImages,
    GLOBAL_SETTINGS.sendGeneratedImages.default,
  );
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
 * Placeholders
 * ------------------------------------------------------------------ */

/** A configured positive whole number, else its fallback. */
function positiveSetting(key, fallback) {
  const value = pickInteger(fallback, state.data.config[key], GLOBAL_SETTINGS[key].default);
  return value >= 1 ? value : fallback;
}

/** The configured starting width and pixel budget for new placeholders. */
export function placeholderLimits() {
  return {
    width: positiveSetting('placeholderWidth', DEFAULT_PLACEHOLDER_WIDTH),
    maxPixels: positiveSetting('placeholderMaxPixels', DEFAULT_PLACEHOLDER_MAX_PIXELS),
  };
}

/**
 * The placeholder's pixel size for an original of `width` × `height`.
 *
 * It starts `limits.width` wide (or the original's width, if narrower) at the
 * original's aspect ratio, and while it holds more than `limits.maxPixels`,
 * its width is halved and its height worked out again. An image too tall to
 * fit even one pixel wide has its height cut to the budget; the viewer and
 * the wire use the original's size, so only the stored thumbnail is squashed.
 */
export function placeholderSize(width, height, limits = placeholderLimits()) {
  const { width: startWidth, maxPixels } = limits;
  const heightFor = (w) => Math.max(1, Math.round((height * w) / width));

  let w = Math.max(1, Math.min(startWidth, width));
  let h = heightFor(w);
  while (w > 1 && w * h > maxPixels) {
    w = Math.max(1, Math.floor(w / 2));
    h = heightFor(w);
  }
  if (w * h > maxPixels) h = Math.max(1, Math.floor(maxPixels / w));
  return { width: w, height: h };
}

/** Round every colour channel to `PNG_LEVELS` levels, so the PNG compresses. Alpha is kept. */
function quantize(context, width, height) {
  const step = 255 / (PNG_LEVELS - 1);
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.round(Math.round(data[i] / step) * step);
    data[i + 1] = Math.round(Math.round(data[i + 1] / step) * step);
    data[i + 2] = Math.round(Math.round(data[i + 2] / step) * step);
  }
  context.putImageData(image, 0, 0);
}

/**
 * Encode a drawn placeholder: lossy WebP where the browser can write it (it
 * hands back a PNG when it cannot), else a colour-reduced PNG.
 */
function encodePlaceholder(canvas, context) {
  const webp = canvas.toDataURL('image/webp', PLACEHOLDER_QUALITY);
  if (webp.startsWith('data:image/webp')) return webp;
  quantize(context, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/** The pixelated stand-in for a decoded image, as a data URL. */
function placeholderOf(bitmap) {
  const size = placeholderSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return encodePlaceholder(canvas, context);
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

/**
 * Hash, measure and hold one image — a file, or any blob given a `name` — and
 * resolve with its attachment record.
 */
export async function ingestImage(file, { name: givenName } = {}) {
  const name = givenName || file.name || 'image';
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
      for (const attachment of allImagesOf(message)) {
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

/**
 * The attachments a request built from `messages` would send as placeholders:
 * user images, and with Send Generated Images on, those the model made.
 */
export async function missingImages(messages) {
  const generated = sendsGeneratedImages();
  const missing = [];
  for (const message of messages || []) {
    for (const attachment of imagesToSend(message, { generated })) {
      if (!(await originalBlob(attachment.hash))) missing.push(attachment);
    }
  }
  return missing;
}

/**
 * What a send must warn about: every attachment that would go out as a
 * placeholder (`missing`), and the hashes among them the user has not yet
 * agreed to send that way (`unconfirmed`). Nothing unconfirmed, no warning.
 */
export async function placeholdersToConfirm(messages) {
  const missing = await missingImages(messages);
  const hashes = [...new Set(missing.map((attachment) => attachment.hash))];
  return {
    missing,
    hashes,
    unconfirmed: hashes.filter((hash) => !acknowledged.has(hash)),
  };
}

/** Remember that these placeholders may be sent without asking again. */
export function acknowledgePlaceholders(hashes) {
  for (const hash of hashes || []) acknowledged.add(hash);
}

function readDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataURLBlob(url) {
  const [head, data] = String(url).split(',');
  const type = /^data:([^;,]+)/.exec(head)?.[1] || 'image/png';
  const binary = atob(data || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** The original as a chat model is sent it: scaled to `scaling`, as a data URL. */
async function originalDataURL(attachment, blob, scaling) {
  const key = scalingKey(scaling);
  let byScaling = wireOriginals.get(attachment.hash);
  if (!byScaling) {
    byScaling = new Map();
    wireOriginals.set(attachment.hash, byScaling);
  }
  if (!byScaling.has(key)) {
    const typed = blob.type.startsWith('image/') ? blob : new Blob([blob], { type: attachment.type });
    const sent = await scaleImageBlob(typed, scaling, attachment);
    byScaling.set(key, await readDataURL(sent));
  }
  return byScaling.get(key);
}

/**
 * The placeholder at `size` (the original's pixel size unless told
 * otherwise), blocks kept sharp.
 */
async function upscaledPlaceholder(
  attachment,
  size = { width: attachment.width, height: attachment.height },
) {
  const key = `${size.width}x${size.height}:${attachment.placeholder}`;
  if (!wirePlaceholders.has(key)) {
    const image = new Image();
    image.src = attachment.placeholder;
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, size.width, size.height);
    wirePlaceholders.set(key, canvas.toDataURL('image/png'));
  }
  return wirePlaceholders.get(key);
}

/**
 * The image to upload for an attachment (an edit's source): the original, or
 * with `allowPlaceholder`, the upscaled placeholder. Null when neither may be
 * used. Not scaled here: an edit scales its sources itself.
 */
export async function uploadBlob(attachment, { allowPlaceholder = false } = {}) {
  const blob = await originalBlob(attachment.hash);
  if (blob) {
    return blob.type.startsWith('image/') ? blob : new Blob([blob], { type: attachment.type });
  }
  if (!allowPlaceholder) return null;
  return dataURLBlob(await upscaledPlaceholder(attachment));
}

/**
 * `Map<hash, data URL>` for every image a request built from `messages`
 * sends: user images, and with `generated`, those the model made. Each is
 * scaled down to Vision Max Pixels; a placeholder is drawn straight at that
 * size.
 */
export async function wireImages(messages, { generated = sendsGeneratedImages() } = {}) {
  const scaling = visionScaling();
  const images = new Map();
  for (const message of messages || []) {
    for (const attachment of imagesToSend(message, { generated })) {
      if (images.has(attachment.hash)) continue;
      const blob = await originalBlob(attachment.hash);
      images.set(
        attachment.hash,
        blob
          ? await originalDataURL(attachment, blob, scaling)
          : await upscaledPlaceholder(
              attachment,
              scaledSize(attachment.width, attachment.height, scaling.maxPixels),
            ),
      );
    }
  }
  return images;
}
