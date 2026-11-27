import { roundsOf } from './thinking.js';

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
 * Images also come from the model: an image model's reply carries them as an
 * assistant message's attachments, and an image tool call carries what it made
 * as the call's own `attachments`. Those are sent back only when Send
 * Generated Images is on, and never as assistant content (the chat
 * completions API accepts image parts only from users): `core/tool-calls.js`
 * sends them in a user message of their own.
 *
 * Every image has a short id, `img_` and the start of its hash, which is how
 * the model names one to the image tools.
 */

const PLACEHOLDER_PREFIX = /^data:image\/[a-z0-9.+-]+;base64,/i;
const HASH_PATTERN = /^[a-z0-9]+-[0-9a-f]+$/i;

/** Hex digits of the hash an image id carries. */
const REF_LENGTH = 12;
/** The fewest hex digits an id may be cut to and still be looked up. */
const MIN_REF_LENGTH = 6;

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

/** The images of anything that may carry them: a message, or a tool call. */
export function attachmentsOf(holder) {
  return Array.isArray(holder?.attachments) ? holder.attachments : [];
}

/** The images the tool calls of a thinking message made. */
export function callImagesOf(message) {
  return roundsOf(message).flatMap((round) =>
    (Array.isArray(round?.calls) ? round.calls : []).flatMap(attachmentsOf),
  );
}

/** Every image a message holds: its own, and those of its tool calls. */
export function allImagesOf(message) {
  return [...attachmentsOf(message), ...callImagesOf(message)];
}

/** Whether a message's own images go out with it. */
export function sendsImages(message) {
  return message?.role === 'user';
}

/**
 * The images a request built from this message sends: a user message's own,
 * and with `generated`, what the model made (an image model's reply, the
 * images of tool calls).
 */
export function imagesToSend(message, { generated = false } = {}) {
  if (sendsImages(message)) return attachmentsOf(message);
  if (!generated) return [];
  if (message?.role === 'assistant') return attachmentsOf(message);
  return callImagesOf(message);
}

/** The id the model knows an image by, e.g. `img_1a2b3c4d5e6f`. */
export function imageRef(attachment) {
  const hash = String(attachment?.hash || '');
  const hex = hash.slice(hash.indexOf('-') + 1);
  return `img_${hex.slice(0, REF_LENGTH)}`;
}

/** How an image is introduced to the model, ahead of its pixels. */
export function imageLabel(attachment) {
  return `[${imageRef(attachment)}: ${attachment.name || 'image'}, ${attachment.width}×${attachment.height}]`;
}

/**
 * The image in `list` that `ref` names: an id, the id with its label still on
 * it, or a full hash. Null when none matches.
 */
export function findImageByRef(list, ref) {
  const wanted = String(ref ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\[/, '')
    .split(/[:\]\s]/)[0]
    .replace(/^img[_-]?/, '');
  if (wanted.length < MIN_REF_LENGTH) return null;

  for (const attachment of list || []) {
    const hash = String(attachment?.hash || '').toLowerCase();
    const hex = hash.slice(hash.indexOf('-') + 1);
    if (hash === wanted || hex.startsWith(wanted)) return attachment;
  }
  return null;
}

/** How an image reads in copied or exported markdown. */
export function attachmentNote(attachment) {
  return `*[Image: ${attachment.name || 'image'} (${attachment.width}×${attachment.height})]*`;
}
