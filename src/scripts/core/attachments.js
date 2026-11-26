/**
 * Images attached to a message. A chat only ever stores a stand-in:
 *
 *   { hash, name, type, width, height, size, placeholder }
 *
 * `hash` identifies the original's bytes (`<algorithm>-<hex>`), `width` and
 * `height` are its pixel size, and `placeholder` is a tiny PNG data URL of it,
 * shown pixelated at the original's aspect ratio. The original lives only in
 * memory and in a capped cache (`services/images.js`). When neither has it,
 * the placeholder is what is shown and, scaled up to the original size, what
 * is sent.
 *
 * Only user messages carry images on the wire: the chat completions API
 * accepts image parts nowhere else.
 */

const PLACEHOLDER_PREFIX = /^data:image\/[a-z0-9.+-]+;base64,/i;
const HASH_PATTERN = /^[a-z0-9]+-[0-9a-f]+$/i;

function positiveInt(value) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

/** An attachment reduced to known fields, or null if it cannot be shown. */
export function normalizeAttachment(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.hash !== 'string' || !HASH_PATTERN.test(value.hash)) return null;
  if (typeof value.placeholder !== 'string' || !PLACEHOLDER_PREFIX.test(value.placeholder)) {
    return null;
  }

  const width = positiveInt(value.width);
  const height = positiveInt(value.height);
  if (!width || !height) return null;

  return {
    hash: value.hash.toLowerCase(),
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'image',
    type: typeof value.type === 'string' && value.type.startsWith('image/') ? value.type : 'image/png',
    width,
    height,
    size: positiveInt(value.size) || 0,
    placeholder: value.placeholder,
  };
}

export function normalizeAttachments(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeAttachment).filter(Boolean);
}

export function attachmentsOf(message) {
  return Array.isArray(message?.attachments) ? message.attachments : [];
}

/** Whether a message's images go out with it. */
export function sendsImages(message) {
  return message?.role === 'user';
}

/** How an image reads in copied or exported markdown. */
export function attachmentNote(attachment) {
  return `*[Image: ${attachment.name || 'image'} (${attachment.width}×${attachment.height})]*`;
}
