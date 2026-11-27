import { estimateTokens } from './tokens.js';
import { isSendable, isThinking, isPreamble } from './roles.js';
import { roundsOf } from './thinking.js';
import { REASONING_FIELDS, isReasoningField, replayableBlocks } from './reasoning.js';
import { attachmentsOf, sendsImages, imageLabel } from './attachments.js';

/**
 * Tool calls on the wire: assembling them from streamed fragments, parsing
 * their arguments, and turning a transcript into a request the API will accept.
 *
 * In the transcript, every call a turn makes lives in a thinking message,
 * grouped by round — one round per request (see `core/thinking.js`):
 *
 *   { role: 'thinking', rounds: [{ thinking, text?, continues?, reasoning?,
 *       calls: [{ id, name, arguments, result?, status, startedAt?, seconds?,
 *                 collapsed, attachments? }] }] }
 *
 * `arguments` is the raw JSON string the model wrote and `result` the text
 * that was sent back. `attachments` are the images an image tool made
 * (`core/attachments.js`). `status` is described in `core/tools.js`,
 * `reasoning` in `core/reasoning.js`. On the wire, each round with an answered
 * call is one assistant message carrying the round's text as its content, its
 * answered calls, and (within the current turn) its reasoning, followed by one
 * `tool` message per answered call. A round's `thinking` is display only.
 *
 * Text written before a round's calls is a preamble message just before the
 * thinking message, whose first round `continues` it: the two are sent as the
 * one assistant message the model produced.
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

/* ------------------------------------------------------------------ *
 * Images
 * ------------------------------------------------------------------ */

/**
 * Image parts for `list`, from `images` (`Map<hash, url>`). With `label`, each
 * image is introduced by a text part naming its id, so the model can refer to
 * it. An image with no url is left out.
 */
function imageParts(list, images, label) {
  const parts = [];
  if (!images) return parts;
  for (const attachment of list) {
    const url = images.get(attachment.hash);
    if (!url) continue;
    if (label) parts.push({ type: 'text', text: imageLabel(attachment) });
    parts.push({ type: 'image_url', image_url: { url } });
  }
  return parts;
}

const GENERATED_NOTE = 'The images generated just above, sent back so you can check them:';

/**
 * Images the model made, as the user message that carries them back: the
 * API takes image parts only from users. Null when there are none to send.
 */
function generatedMessage(list, images) {
  const parts = imageParts(list, images, true);
  if (!parts.length) return null;
  return { role: 'user', content: [{ type: 'text', text: GENERATED_NOTE }, ...parts] };
}

/**
 * The wire messages for one thinking message: per round, the text and the
 * answered calls with their reasoning, then the results, then (when
 * generated images go back) the images the calls made. A round whose calls
 * were never answered sends its text alone, if it wrote any; its reasoning is
 * dropped with the calls it belonged to. `lead` is the preamble before the
 * message, which is the text of a first round that continues it.
 */
function wireRounds(message, replay, lead, wire) {
  const payload = [];
  const rounds = roundsOf(message);

  for (let k = 0; k < rounds.length; k++) {
    const round = rounds[k];
    const own = typeof round?.text === 'string' ? round.text : '';
    const text = k === 0 && round?.continues ? [lead, own].filter(Boolean).join('\n\n') : own;
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

    if (wire.sendGenerated) {
      const extra = generatedMessage(answered.flatMap(attachmentsOf), wire.images);
      if (extra) payload.push(extra);
    }
  }

  return payload;
}

/** What precedes reasoning carried into a user message by a retry. */
const CARRIED_NOTE = 'Your reasoning from an earlier attempt at this reply, kept so it is not lost:';

function withCarried(text, carried) {
  if (!carried) return text;
  const block = `${CARRIED_NOTE}\n<previous_reasoning>\n${carried}\n</previous_reasoning>`;
  return text ? `${text}\n\n${block}` : block;
}

/**
 * A message's wire content: its text (with `carried` reasoning after it), or
 * with images and a role that may carry them, a text part followed by the
 * image parts of its attachments (each labelled with its id when
 * `wire.labelImages`).
 */
function wireContent(message, wire, carried = '') {
  const text = withCarried(message.content || '', carried);
  if (!wire.images || !sendsImages(message)) return text;

  const parts = imageParts(attachmentsOf(message), wire.images, wire.labelImages);
  if (!parts.length) return text;
  return text ? [{ type: 'text', text }, ...parts] : parts;
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
 *   - a preamble is the text of the round right after it that continues it,
 *     so the two become that one assistant message; a preamble with nothing
 *     after it is plain assistant text;
 *   - a call with no result is left out, and a round left with none is
 *     reduced to its text, or dropped if it has none;
 *   - reasoning is replayed only for rounds after the latest user message —
 *     the turn in progress, which is all any provider requires — and only to
 *     `model`. With no `model`, nothing is replayed;
 *   - `carriedReasoning`, from a retry, is appended to the latest user
 *     message's text;
 *   - user messages carry their images as content parts when `images` maps
 *     each attachment's hash to a url, each introduced by its id when
 *     `labelImages` (the image tools are offered). Without `images`, only
 *     text is built (the context estimate does that);
 *   - with `sendGenerated`, images the model made — by an image tool call,
 *     or as an image model's reply — follow in a user message of their own,
 *     right after the tool results or the reply.
 *
 * Everything is reduced to wire fields, so presentational ones never leave.
 */
export function buildApiMessages(
  messages,
  {
    model = '',
    echoField = '',
    images = null,
    carriedReasoning = '',
    sendGenerated = false,
    labelImages = false,
  } = {},
) {
  const sendable = (messages || []).filter(isSendable);
  const userAt = lastUserIndex(sendable);
  const turnStart = userAt + 1;
  const replayFor = (i) => (model && i >= turnStart ? { model, echoField } : null);
  const wire = {
    images,
    sendGenerated: Boolean(images) && Boolean(sendGenerated),
    labelImages: Boolean(labelImages),
  };
  const payload = [];

  for (let i = 0; i < sendable.length; i++) {
    const message = sendable[i];

    if (isThinking(message)) {
      payload.push(...wireRounds(message, replayFor(i), '', wire));
      continue;
    }

    if (isPreamble(message)) {
      const next = sendable[i + 1];
      if (isThinking(next) && roundsOf(next)[0]?.continues) {
        payload.push(...wireRounds(next, replayFor(i + 1), message.content || '', wire));
        i++;
        continue;
      }
      payload.push({ role: 'assistant', content: message.content || '' });
      continue;
    }

    const carried = i === userAt ? carriedReasoning : '';
    payload.push({ role: message.role, content: wireContent(message, wire, carried) });

    if (wire.sendGenerated && message.role === 'assistant') {
      const extra = generatedMessage(attachmentsOf(message), images);
      if (extra) payload.push(extra);
    }
  }

  return payload;
}

/** Text characters of a wire content value; image parts are not counted. */
function contentChars(content) {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce(
    (sum, part) => sum + (part?.type === 'text' && typeof part.text === 'string' ? part.text.length : 0),
    0,
  );
}

/** Characters of text in a built payload, for the context estimate. */
export function payloadChars(payload) {
  let total = 0;
  for (const message of payload) {
    total += contentChars(message.content);
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
