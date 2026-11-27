import { state } from '../store/state.js';
import { GLOBAL_SETTINGS, optionValue } from '../core/settings-schema.js';
import { pickInteger } from '../core/values.js';

/**
 * Scaling images down to a pixel budget before they are sent: to an image
 * model to edit (Edit Max Pixels), and to a chat model to look at (Vision Max
 * Pixels). Only what goes out is scaled; the chat and the image cache keep
 * the original.
 *
 * An image within its budget is sent untouched, bytes and all. One over it
 * is scaled to the largest size that fits at the same aspect ratio, with the
 * configured method, and re-encoded in its own format (PNG for anything a
 * canvas cannot write). Fails soft: an image that cannot be decoded or
 * re-encoded here is sent as it is.
 */

/** Canvas smoothing for the smooth methods. */
const SMOOTHING = { high: 'high', medium: 'medium', low: 'low' };
/** Formats a canvas writes that are worth keeping. */
const OUTPUT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const LOSSY_QUALITY = 0.92;

function scalingFor(pixelsKey, methodKey) {
  const config = state.data.config;
  const budget = pickInteger(Number(GLOBAL_SETTINGS[pixelsKey].default), config[pixelsKey]);
  return {
    maxPixels: Math.max(0, budget),
    method: optionValue(methodKey, config[methodKey]),
  };
}

/** `{ maxPixels, method }` for images sent to be edited. */
export function editScaling() {
  return scalingFor('editMaxPixels', 'editScalingMethod');
}

/** `{ maxPixels, method }` for images sent to a chat model. */
export function visionScaling() {
  return scalingFor('visionMaxPixels', 'visionScalingMethod');
}

/** A key that tells scalings apart, for caching what was sent. */
export function scalingKey({ maxPixels, method }) {
  return maxPixels > 0 ? `${maxPixels}:${method}` : 'full';
}

/**
 * The size an image of `width` × `height` is sent at under `maxPixels`:
 * itself when it fits (or there is no budget), otherwise the largest whole
 * size at the same aspect ratio that does.
 */
export function scaledSize(width, height, maxPixels) {
  const pixels = width * height;
  if (!(maxPixels > 0) || !(pixels > maxPixels)) return { width, height, scaled: false };
  const factor = Math.sqrt(maxPixels / pixels);
  return {
    width: Math.max(1, Math.floor(width * factor)),
    height: Math.max(1, Math.floor(height * factor)),
    scaled: true,
  };
}

function draw(source, width, height, method) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (method === 'nearest') {
    context.imageSmoothingEnabled = false;
  } else {
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = SMOOTHING[method] || 'high';
  }
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

/**
 * Draw `bitmap` at `width` × `height`. Progressive halving shrinks it by
 * half at a time while it is still at least twice the target, then draws the
 * last step smoothly: closer to a true downscale than one big jump.
 */
function resample(bitmap, width, height, method) {
  if (method !== 'stepped') return draw(bitmap, width, height, method);

  let current = bitmap;
  let w = bitmap.width;
  let h = bitmap.height;
  while (Math.floor(w / 2) >= width && Math.floor(h / 2) >= height) {
    w = Math.floor(w / 2);
    h = Math.floor(h / 2);
    current = draw(current, w, h, 'medium');
  }
  return draw(current, width, height, 'high');
}

function encode(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the scaled image.'))),
      type,
      LOSSY_QUALITY,
    );
  });
}

function outputTypeOf(type) {
  return OUTPUT_TYPES.includes(type) ? type : 'image/png';
}

/**
 * `blob`, scaled down to `scaling` if it is over it. `known` (`{ width,
 * height }`, an attachment's size) lets an image that fits skip decoding.
 */
export async function scaleImageBlob(blob, scaling, known = null) {
  const { maxPixels = 0, method = 'high' } = scaling || {};
  if (!(maxPixels > 0)) return blob;
  if (known && !scaledSize(known.width, known.height, maxPixels).scaled) return blob;
  if (typeof createImageBitmap !== 'function') return blob;

  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return blob;
  }

  try {
    const size = scaledSize(bitmap.width, bitmap.height, maxPixels);
    if (!size.scaled) return blob;
    return await encode(resample(bitmap, size.width, size.height, method), outputTypeOf(blob.type));
  } catch {
    return blob;
  } finally {
    bitmap.close?.();
  }
}
