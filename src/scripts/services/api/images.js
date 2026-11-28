/**
 * Images API client: `/images/generations` for a prompt, `/images/edits` for a
 * prompt and the images to start from. OpenAI, LiteLLM and Ollama all serve
 * these beside their chat completions route.
 *
 * Both resolve with `{ images: Blob[], revisedPrompt }`. An image comes back
 * as base64 (`b64_json`) or as a URL, which is downloaded; a URL the browser
 * may not fetch (CORS) fails with an error the model can read. Takes config
 * explicitly; touches no state.
 */

/**
 * Models whose default answer is a URL, which expires and is often not
 * downloadable from a page. They are asked for base64 instead, unless the
 * request already names a format. Other models (gpt-image-*) reject the field.
 */
const URL_BY_DEFAULT = /dall-e/i;

/** Fields an edit form carries itself, never from the parameters. */
const FORM_FIELDS = ['model', 'prompt', 'image', 'image[]'];

function baseOf(config) {
  return (config.url || '').trim().replace(/\/+$/, '');
}

function authHeaders(config) {
  // Local servers need no key, and some reject an empty Bearer token.
  return config.key ? { Authorization: `Bearer ${config.key}` } : {};
}

async function failureOf(response) {
  const detail = await response.json().catch(() => ({}));
  const message =
    detail.error?.message ||
    (typeof detail.error === 'string' ? detail.error : '') ||
    (typeof detail.detail === 'string' ? detail.detail : '');
  return new Error(message || `HTTP ${response.status}`);
}

function withResponseFormat(model, params) {
  if ('response_format' in params || !URL_BY_DEFAULT.test(model)) return params;
  return { ...params, response_format: 'b64_json' };
}

/* ------------------------------------------------------------------ *
 * Reading the answer
 * ------------------------------------------------------------------ */

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.slice(start, end));
}

/** The image type the bytes say they are, or ''. */
function sniffType(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG') return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && ascii(bytes, 0, 3) === 'GIF') return 'image/gif';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return '';
}

function base64Bytes(text) {
  const data = text.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function typedBlob(blob) {
  if (blob.type.startsWith('image/')) return blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return new Blob([bytes], { type: sniffType(bytes) || 'image/png' });
}

async function download(url, signal) {
  let response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error(
      'The server answered with an image URL the browser could not download (most likely blocked by CORS). ' +
        'Try another image model.',
    );
  }
  if (!response.ok) throw new Error(`Could not download the generated image (HTTP ${response.status}).`);
  return typedBlob(await response.blob());
}

async function imageOf(entry, signal) {
  if (typeof entry?.b64_json === 'string' && entry.b64_json) {
    const bytes = base64Bytes(entry.b64_json);
    return new Blob([bytes], { type: sniffType(bytes) || 'image/png' });
  }
  if (typeof entry?.url === 'string' && entry.url) return download(entry.url, signal);
  return null;
}

async function readReply(response, signal) {
  const payload = await response.json();
  const entries = Array.isArray(payload?.data) ? payload.data : [];
  const images = [];
  let revisedPrompt = '';
  for (const entry of entries) {
    const blob = await imageOf(entry, signal);
    if (blob) images.push(blob);
    if (!revisedPrompt && typeof entry?.revised_prompt === 'string') revisedPrompt = entry.revised_prompt;
  }
  return { images, revisedPrompt };
}

/* ------------------------------------------------------------------ *
 * Requests
 * ------------------------------------------------------------------ */

export async function requestImageGeneration({ config, model, prompt, params = {}, signal }) {
  const response = await fetch(`${baseOf(config)}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(config) },
    body: JSON.stringify({ ...withResponseFormat(model, params), model, prompt }),
    signal,
  });
  if (!response.ok) throw await failureOf(response);
  return readReply(response, signal);
}

/**
 * `images` are `{ blob, name }`. One image goes as `image`; several as
 * `image[]`, the form OpenAI's multi-image edits take.
 */
export async function requestImageEdit({ config, model, prompt, images, params = {}, signal }) {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);

  for (const [key, value] of Object.entries(withResponseFormat(model, params))) {
    if (FORM_FIELDS.includes(key) || value === undefined || value === null) continue;
    form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }

  const field = images.length > 1 ? 'image[]' : 'image';
  for (const image of images) form.append(field, image.blob, image.name || 'image.png');

  const response = await fetch(`${baseOf(config)}/images/edits`, {
    method: 'POST',
    // No Content-Type: the browser sets the multipart boundary itself.
    headers: authHeaders(config),
    body: form,
    signal,
  });
  if (!response.ok) throw await failureOf(response);
  return readReply(response, signal);
}
