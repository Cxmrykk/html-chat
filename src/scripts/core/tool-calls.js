import { estimateTokens } from './tokens.js';
import { isSendable, isThinking } from './roles.js';
import { roundsOf } from './thinking.js';
import { REASONING_FIELDS, isReasoningField, replayableBlocks } from './reasoning.js';

/**
 * Tool calls on the wire: assembling them from streamed fragments, parsing
 * their arguments, and turning a transcript into a request the API will accept.
 *
 * In the transcript, every call a turn makes lives in its thinking message,
 * grouped by round — one round per request (see `core/thinking.js`):
 *
 *   { role: 'thinking', rounds: [{ thinking, text?, reasoning?,
 *       calls: [{ id, name, arguments, result?, status, startedAt?, seconds?, collapsed }] }] }
 *
 * `arguments` is the raw JSON string the model wrote and `result` the text
 * that was sent back. `status` is described in `core/tools.js`, `reasoning` in
 * `core/reasoning.js`. On the wire, each round with an answered call is one
 * assistant message carrying the round's `text` as its content, its answered
 * calls, and (within the current turn) its reasoning, followed by one `tool`
 * message per answered call. A round's `thinking` is display only.
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

function hasResult(call) {
  return typeof call?.result === 'string' && Boolean(call.name);
}

function toWireCall(call) {
  return {
    id: call.id,
    type: 'function',
    function: { name: call.name, arguments: call.arguments || '{}' },
  };
}

/**
 * The reasoning fields for one round's wire assistant message.
 *
 * `replay` is null outside the current turn, where nothing is sent back.
 * Inside it, reasoning goes only to the model that wrote it: a signature is
 * meaningless to any other, and a different provider may reject the field.
 * Signed thinking blocks are always sent, because Anthropic refuses a
 * continuation without them. Plain text goes back only under a field the user
 * named, and only if that is a known reasoning field, so no setting can ever
 * overwrite `content` or `tool_calls`.
 */
function reasoningFields(reasoning, replay) {
  if (!replay || !reasoning || !reasoning.model || reasoning.model !== replay.model) return {};

  const fields = {};
  const blocks = replayableBlocks(reasoning.blocks);
  if (blocks.length) fields.thinking_blocks = blocks;
  if (isReasoningField(replay.echoField) && typeof reasoning.text === 'string' && reasoning.text) {
    fields[replay.echoField] = reasoning.text;
  }
  return fields;
}

/**
 * The wire messages for one thinking message: per round, the text and the
 * answered calls with their reasoning, then the results. A round whose calls
 * were never answered sends its text alone, if it wrote any; its reasoning is
 * dropped with the calls it belonged to.
 */
function wireRounds(message, replay) {
  const payload = [];

  for (const round of roundsOf(message)) {
    const text = typeof round?.text === 'string' ? round.text : '';
    const answered = (Array.isArray(round?.calls) ? round.calls : []).filter(hasResult);

    if (!answered.length) {
      if (text) payload.push({ role: 'assistant', content: text });
      continue;
    }

    payload.push(
      {
        role: 'assistant',
        content: text || null,
        tool_calls: answered.map(toWireCall),
        ...reasoningFields(round.reasoning, replay),
      },
      ...answered.map((call) => ({ role: 'tool', tool_call_id: call.id, content: call.result })),
    );
  }

  return payload;
}

function lastUserIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i;
  }
  return -1;
}

/**
 * The messages that go to the API.
 *
 * Servers reject a request in which a tool result has no preceding call, or a
 * call has no result. Stopping a turn, hitting the round limit, or reloading
 * mid-execution all leave calls without results, so the rules are applied
 * here, once:
 *
 *   - transcript-only rows (errors) are dropped, and so is every thinking
 *     message's reasoning text;
 *   - each round of a thinking message becomes an assistant message carrying
 *     the calls that have a result, followed by those results;
 *   - a call with no result is left out, and a round left with none is
 *     reduced to its text, or dropped if it has none;
 *   - reasoning is replayed only for rounds after the latest user message —
 *     the turn in progress, which is all any provider requires — and only to
 *     `model`. With no `model`, nothing is replayed.
 *
 * Everything is reduced to wire fields, so presentational ones never leave.
 */
export function buildApiMessages(messages, { model = '', echoField = '' } = {}) {
  const sendable = (messages || []).filter(isSendable);
  const turnStart = lastUserIndex(sendable) + 1;
  const payload = [];

  for (let i = 0; i < sendable.length; i++) {
    const message = sendable[i];

    if (isThinking(message)) {
      const replay = model && i >= turnStart ? { model, echoField } : null;
      payload.push(...wireRounds(message, replay));
      continue;
    }

    payload.push({ role: message.role, content: message.content || '' });
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
    for (const block of message.thinking_blocks || []) {
      total += (block.thinking || '').length + (block.data || '').length;
    }
    for (const field of REASONING_FIELDS) {
      if (typeof message[field] === 'string') total += message[field].length;
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
