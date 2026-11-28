import { state } from '../store/state.js';
import { GLOBAL_SETTINGS } from '../core/settings-schema.js';
import { pickBoolean, pickNumber } from '../core/values.js';

/**
 * Fitting a generated image to the size an image tool asked for.
 *
 * Image models sometimes return an image a few pixels larger than requested.
 * With Auto-Crop on, an image no smaller than requested in either dimension,
 * with at most Auto-Crop Tolerance percent more pixels, is cropped from its
 * top-left corner to the requested size. The crop copies pixels one to one
 * and is saved as PNG, so nothing is lost. Anything else — larger than that,
 * smaller in either dimension (it cannot be enlarged without distorting it),
 * or any difference while Auto-Crop is off — is left as it is.
 *
 * Every outcome but an exact match comes with a note for the tool result, so
 * the model knows what it got.
 */

const SIZE_PATTERN = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i;

/** `{ width, height }` from a size such as "1024x1024", or null for anything else ("auto"). */
export function requestedSize(size) {
  const match = SIZE_PATTERN.exec(String(size ?? ''));
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** `{ enabled, tolerance }`, the tolerance in percent of the requested pixels. */
export function autoCropSettings() {
  const config = state.data.config;
  return {
    enabled: pickBoolean(true, config.autoCrop, GLOBAL_SETTINGS.autoCrop.default),
    tolerance: Math.max(
      0,
      pickNumber(5, config.autoCropTolerance, GLOBAL_SETTINGS.autoCropTolerance.default),
    ),
  };
}

/**
 * What to do with an image of `actual` size for a request of `requested`:
 * 'none' (it matches), 'smaller', 'off' (larger, Auto-Crop off), 'tooLarge'
 * or 'crop'. `excess` is how many more pixels it has, as a fraction.
 */
export function cropDecision(actual, requested, { enabled, tolerance }) {
  if (actual.width === requested.width && actual.height === requested.height) {
    return { action: 'none', excess: 0 };
  }
  if (actual.width < requested.width || actual.height < requested.height) {
    return { action: 'smaller', excess: 0 };
  }
  const excess = (actual.width * actual.height) / (requested.width * requested.height) - 1;
  if (!enabled) return { action: 'off', excess };
  if (excess * 100 > tolerance + 1e-9) return { action: 'tooLarge', excess };
  return { action: 'crop', excess };
}

function percent(fraction) {
  return (fraction * 100).toFixed(1).replace(/\.0$/, '');
}

function cropTopLeft(bitmap, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.drawImage(bitmap, 0, 0, width, height, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the cropped image.'))),
      'image/png',
    );
  });
}

async function decode(blob) {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    return await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  } catch {
    try {
      return await createImageBitmap(blob);
    } catch {
      return null;
    }
  }
}

/**
 * `blob` fitted to `size` (the size the tool call asked for), and a note for
 * the model saying what was done, or '' when there was nothing to say.
 */
export async function fitToRequestedSize(blob, size, settings = autoCropSettings()) {
  const requested = requestedSize(size);
  if (!requested) return { blob, note: '' };

  const bitmap = await decode(blob);
  if (!bitmap) return { blob, note: '' };

  try {
    const actual = { width: bitmap.width, height: bitmap.height };
    const got = `${actual.width}×${actual.height}`;
    const wanted = `${requested.width}×${requested.height}`;
    const { action, excess } = cropDecision(actual, requested, settings);

    switch (action) {
      case 'none':
        return { blob, note: '' };
      case 'smaller':
        return {
          blob,
          note: `returned at ${got}, smaller than the requested ${wanted}; left as it is, since it cannot be enlarged without distorting it`,
        };
      case 'off':
        return {
          blob,
          note: `returned at ${got} instead of the requested ${wanted}; Auto-Crop is off, so it was left as it is`,
        };
      case 'tooLarge':
        return {
          blob,
          note: `returned at ${got}, ${percent(excess)}% more pixels than the requested ${wanted}, beyond the ${settings.tolerance}% Auto-Crop allowance; left as it is`,
        };
      default: {
        try {
          const cropped = await cropTopLeft(bitmap, requested.width, requested.height);
          return {
            blob: cropped,
            note: `returned at ${got}; cropped losslessly from the top-left corner to the requested ${wanted} (${percent(excess)}% more pixels than requested, within the ${settings.tolerance}% allowance)`,
          };
        } catch {
          return {
            blob,
            note: `returned at ${got} instead of the requested ${wanted}; it could not be cropped, so it was left as it is`,
          };
        }
      }
    }
  } finally {
    bitmap.close?.();
  }
}
