import { state } from '../store/state.js';
import { requestImageGeneration, requestImageEdit } from './api/images.js';
import { ingestImage } from './images.js';
import { parseJSONObject } from '../core/values.js';
import { TOOL_IMAGE_OPTIONS } from '../core/tools.js';

/**
 * Making images with an image model, for both ways in: an image model chosen
 * in chat, and the image tools. A prompt alone generates; a prompt with
 * images to start from edits. What comes back is held like any pasted image
 * (`services/images.js`) and resolves as attachment records.
 */

/** Fields the request sets itself, never from Image Parameters. */
const RESERVED = ['model', 'prompt', 'image', 'image[]'];

const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * The extra fields of an image request: Image Parameters, with the per-call
 * options (`size`, `quality`, `background`) a tool call set on top. Throws
 * when Image Parameters is not a JSON object.
 */
export function imageRequestParams(options = {}) {
  const parsed = parseJSONObject(state.data.config.imageParams);
  if (!parsed.ok) throw new Error(`The Image Parameters setting is not a JSON object: ${parsed.error}`);

  const params = {};
  for (const [key, value] of Object.entries(parsed.value)) {
    if (!RESERVED.includes(key)) params[key] = value;
  }
  for (const key of TOOL_IMAGE_OPTIONS) {
    const value = options?.[key];
    if (typeof value === 'string' && value.trim()) params[key] = value.trim();
  }
  return params;
}

/** A file name for a generated image, from its model and type. */
function generatedName(model, at, count, type) {
  const base =
    String(model || 'image')
      .split('/')
      .pop()
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'image';
  const suffix = count > 1 ? `-${at + 1}` : '';
  return `${base}-${Date.now()}${suffix}.${EXTENSIONS[type] || 'png'}`;
}

/**
 * Generate (no `sources`) or edit (`sources`: `{ blob, name }`) with `model`,
 * and resolve with `{ records, revisedPrompt }`. A reply with no image is an
 * error.
 */
export async function createImages({ model, prompt, sources = [], params = {}, signal }) {
  const config = state.data.config;
  const reply = sources.length
    ? await requestImageEdit({ config, model, prompt, images: sources, params, signal })
    : await requestImageGeneration({ config, model, prompt, params, signal });

  if (!reply.images.length) throw new Error('The server answered without an image.');

  const records = [];
  for (let at = 0; at < reply.images.length; at++) {
    const blob = reply.images[at];
    records.push(
      await ingestImage(blob, { name: generatedName(model, at, reply.images.length, blob.type) }),
    );
  }
  return { records, revisedPrompt: reply.revisedPrompt };
}
