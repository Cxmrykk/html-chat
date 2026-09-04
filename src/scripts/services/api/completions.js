import { GLOBAL_SETTINGS } from '../../core/settings-schema.js';
import { isBlank } from '../../core/values.js';

/**
 * Chat completions client. Responses are always streamed: `onDelta` fires with
 * the full text accumulated so far, and the promise resolves with the complete
 * text.
 */

/** Build the sampling parameters from whichever schema entries are set. */
function buildParameters(config) {
  const params = {};
  for (const [key, entry] of Object.entries(GLOBAL_SETTINGS)) {
    if (!entry.payloadKey || isBlank(config[key])) continue;
    const raw = config[key];
    const value = entry.integer ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
    if (Number.isFinite(value)) params[entry.payloadKey] = value;
  }
  return params;
}

/**
 * Not every OpenAI-compatible server honours `stream: true`; a few answer with
 * a single JSON completion regardless. SSE never carries a JSON content type,
 * so this distinguishes the two without a user-facing setting.
 */
function isEventStream(response) {
  if (!response.body) return false;
  return !(response.headers.get('content-type') || '').includes('application/json');
}

/**
 * Consume an SSE body, accumulating deltas.
 *
 * `onDelta` fires at most once per network read, and only when the text
 * actually grew, so keepalive frames cannot trigger pointless re-renders.
 */
async function parseStream(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let text = '';

  const consume = (rawLine) => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      const frame = JSON.parse(payload);
      const delta = frame.choices?.[0]?.delta?.content;
      if (delta) text += delta;
    } catch {
      /* partial or non-JSON keepalive frame */
    }
  };

  const flush = (chunk) => {
    const before = text;
    for (const line of chunk) consume(line);
    if (text !== before) onDelta?.(text);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    // The tail may be half a line; keep it until the next read completes it.
    buffer = lines.pop() ?? '';
    flush(lines);
  }

  // Whatever the server sent without a trailing newline still counts.
  buffer += decoder.decode();
  flush(buffer.split('\n'));

  return text;
}

export async function requestCompletion({ config, model, messages, signal, onDelta }) {
  const response = await fetch(`${config.url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      ...buildParameters(config),
    }),
    signal,
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error?.message || `HTTP ${response.status}`);
  }

  if (!isEventStream(response)) {
    const payload = await response.json();
    const text = payload.choices?.[0]?.message?.content || '';
    onDelta?.(text);
    return text;
  }

  return parseStream(response, onDelta);
}
