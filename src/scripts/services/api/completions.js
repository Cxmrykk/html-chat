import { GLOBAL_SETTINGS } from '../../core/settings-schema.js';
import { isBlank } from '../../core/values.js';

/**
 * Chat completions client. Handles both streaming and non-streaming responses
 * behind one interface: `onDelta` fires per chunk, the promise resolves with
 * the complete text.
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

export function isStreamingEnabled(config) {
  return config.streamResponse !== 'false';
}

async function parseStream(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data: ')) continue;
      if (line === 'data: [DONE]') continue;
      try {
        const payload = JSON.parse(line.slice(6));
        const delta = payload.choices?.[0]?.delta?.content;
        if (delta) text += delta;
      } catch {
        /* partial or non-JSON keepalive frame */
      }
    }
    onDelta?.(text);
  }

  return text;
}

export async function requestCompletion({ config, model, messages, signal, onDelta }) {
  const stream = isStreamingEnabled(config);

  const response = await fetch(`${config.url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream,
      ...buildParameters(config),
    }),
    signal,
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error?.message || `HTTP ${response.status}`);
  }

  if (!stream) {
    const payload = await response.json();
    const text = payload.choices?.[0]?.message?.content || '';
    onDelta?.(text);
    return text;
  }

  return parseStream(response, onDelta);
}
