import { estimateTokens } from './tokens.js';
import { isSendable, isToolResult, hasToolCalls } from './roles.js';

/**
 * Tool calls on the wire: assembling them from streamed fragments, parsing
 * their arguments, and turning a transcript into a request the API will accept.
 *
 * In the transcript a call is `{ id, name, arguments }` (arguments being the
 * raw JSON string the model wrote) on an assistant message's `toolCalls`, and
 * a result is a `tool` message carrying `toolCallId`.
 */

/**
 * Accumulates `delta.tool_calls` fragments into complete calls.
 *
 * The spec keys fragments by `index`, sends `id` and `function.name` once, and
 * streams `function.arguments` as string pieces. In practice servers also omit
 * `index`, omit `id`, send a whole call in one frame, or send `arguments` as an
 * object; all of those are absorbed here. `idPrefix` makes generated ids unique
 * to one request.
 */
export function createToolCallAccumulator({ idPrefix = 'call' } = {}) {
  const slots = [];

  const slotFor = (fragment) => {
    if (Number.isInteger(fragment.index)) return fragment.index;
    // No index: a known id continues its call, a new id or a second name
    // starts one, and anything else continues the latest call.
    if (fragment.id) {
      const known = slots.findIndex((slot) => slot && slot.id === fragment.id);
      return known !== -1 ? known : slots.length;
    }
    const last = slots.length - 1;
    if (last < 0) return 0;
    return fragment.function?.name && slots[last]?.name ? slots.length : last;
  };

  return {
    add(fragments) {
      if (!Array.isArray(fragments)) return;
      for (const fragment of fragments) {
        if (!fragment || typeof fragment !== 'object') continue;
        const index = slotFor(fragment);
        const slot = slots[index] || (slots[index] = { id: '', name: '', arguments: '' });

        if (typeof fragment.id === 'string' && fragment.id) slot.id = fragment.id;
        const fn = fragment.function || {};
        if (typeof fn.name === 'string' && fn.name) slot.name = fn.name;
        if (typeof fn.arguments === 'string') {
          slot.arguments += fn.arguments;
        } else if (fn.arguments && typeof fn.arguments === 'object') {
          slot.arguments = JSON.stringify(fn.arguments);
        }
      }
    },

    /** Total text received, so a caller can tell whether anything grew. */
    size() {
      return slots.reduce(
        (sum, slot) => (slot ? sum + slot.id.length + slot.name.length + slot.arguments.length : sum),
        0,
      );
    },

    /** Fresh copies of every call that has at least a name. */
    list() {
      const calls = [];
      slots.forEach((slot, index) => {
        if (!slot || !slot.name) return;
        calls.push({
          id: slot.id || `${idPrefix}_${index}`,
          name: slot.name,
          arguments: slot.arguments,
        });
      });
      return calls;
    },
  };
}

/** Calls from a complete (non-streamed) message. */
export function toolCallsOf(message, options) {
  const accumulator = createToolCallAccumulator(options);
  accumulator.add(message?.tool_calls);
  return accumulator.list();
}

/**
 * Parse a call's arguments. Never throws: a model that writes broken JSON gets
 * the parse error back as its tool result and can try again.
 */
export function parseToolArguments(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { ok: true, value: {} };
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'Tool arguments must be a JSON object.' };
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: `Tool arguments are not valid JSON: ${error.message}` };
  }
}

/** A cheap way to tell whether a list of calls changed between two deltas. */
export function toolCallsSignature(calls) {
  return (calls || [])
    .map((call) => `${call.id}:${call.name}:${(call.arguments || '').length}`)
    .join('|');
}

function toWireCall(call) {
  return {
    id: call.id,
    type: 'function',
    function: { name: call.name, arguments: call.arguments || '{}' },
  };
}

/**
 * The messages that go to the API.
 *
 * Servers reject a request in which a tool result has no preceding call, or a
 * call has no result. Deleting, forking, truncating for a retry, or stopping
 * mid-execution can all leave a transcript in that state, so rather than guard
 * every one of those actions the pairing is repaired here, once:
 *
 *   - transcript-only rows (errors, thinking) are dropped;
 *   - a call is sent only if its result directly follows its message;
 *   - a result is sent only as the answer to such a call;
 *   - an assistant message left with no text and no calls is dropped.
 *
 * Everything is reduced to wire fields, so presentational ones never leave.
 */
export function buildApiMessages(messages) {
  const sendable = (messages || []).filter(isSendable);
  const payload = [];

  for (let i = 0; i < sendable.length; i++) {
    const message = sendable[i];

    // Results are consumed with their assistant message below; one met here
    // has no call to answer.
    if (isToolResult(message)) continue;

    if (!hasToolCalls(message)) {
      payload.push({ role: message.role, content: message.content || '' });
      continue;
    }

    const results = [];
    while (i + 1 < sendable.length && isToolResult(sendable[i + 1])) {
      results.push(sendable[++i]);
    }

    const calls = [];
    const answers = [];
    for (const call of message.toolCalls) {
      const result = results.find((entry) => entry.toolCallId === call.id);
      if (!result) continue;
      calls.push(toWireCall(call));
      answers.push({ role: 'tool', tool_call_id: call.id, content: result.content || '' });
    }

    if (calls.length) {
      payload.push(
        { role: 'assistant', content: message.content || null, tool_calls: calls },
        ...answers,
      );
    } else if (message.content) {
      payload.push({ role: 'assistant', content: message.content });
    }
  }

  return payload;
}

/** Characters of text in a built payload, for the context estimate. */
export function payloadChars(payload) {
  let total = 0;
  for (const message of payload) {
    total += (message.content || '').length;
    for (const call of message.tool_calls || []) {
      total += call.function.name.length + call.function.arguments.length;
    }
  }
  return total;
}

/** Cap a tool result so one careless call cannot fill the context window. */
export function clampToolResult(text, maxTokens) {
  const value = text || '';
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return value;
  if (estimateTokens(value) <= maxTokens) return value;
  const kept = value.slice(0, maxTokens * 4);
  const dropped = value.length - kept.length;
  return `${kept}\n[Result truncated: ${dropped} more characters were cut to fit the result limit.]`;
}
