import { state } from '../store/state.js';
import { requestImageGeneration, requestImageEdit } from './api/images.js';
import { ingestImage } from './images.js';
import { editScaling, scaleImageBlob } from './image-scaling.js';
import { parseJSONObject } from '../core/values.js';
import { TOOL_IMAGE_OPTIONS } from '../core/tools.js';

/**
 * Making images with an image model, for both ways in: an image model chosen
 * in chat, and the image tools. A prompt alone generates; a prompt with
 * images to start from edits, and those images are first scaled down to
 * Edit Max Pixels. What comes back is held like any pasted image
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
 * The extra fields of a request from an image model chosen in chat: Image
 * Parameters. Throws when it is not a JSON object.
 */
export function imageRequestParams() {
  const parsed = parseJSONObject(state.data.config.imageParams);
  if (!parsed.ok) throw new Error(`The Image Parameters setting is not a JSON object: ${parsed.error}`);

  const params = {};
  for (const [key, value] of Object.entries(parsed.value)) {
    if (!RESERVED.includes(key)) params[key] = value;
  }
  return params;
}

/**
 * The extra fields of a request from an image tool: only the per-call
 * options (`size`, `quality`, `background`) the call set. Image Parameters
 * are for chats with an image model alone.
 */
export function toolImageParams(options = {}) {
  const params = {};
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

/** `name` with the extension of `type`, for an image re-encoded on the way out. */
function renamed(name, type) {
  const extension = EXTENSIONS[type];
  if (!extension) return name;
  const base = String(name || 'image').replace(/\.[a-z0-9]+$/i, '') || 'image';
  return `${base}.${extension}`;
}

/** An edit's sources (`{ blob, name }`), each scaled down to Edit Max Pixels. */
async function scaledSources(sources) {
  const scaling = editScaling();
  const out = [];
  for (const source of sources) {
    const blob = await scaleImageBlob(source.blob, scaling);
    out.push(blob === source.blob ? source : { blob, name: renamed(source.name, blob.type) });
  }
  return out;
}

/**
 * Generate (no `sources`) or edit (`sources`: `{ blob, name }`) with `model`,
 * and resolve with `{ records, revisedPrompt }`. A reply with no image is an
 * error.
 */
export async function createImages({ model, prompt, sources = [], params = {}, signal }) {
  const config = state.data.config;
  const reply = sources.length
    ? await requestImageEdit({
        config,
        model,
        prompt,
        images: await scaledSources(sources),
        params,
        signal,
      })
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
