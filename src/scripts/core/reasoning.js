/**
 * A model's reasoning: separating it from its answer for display, and keeping
 * the part of it a provider needs sent back.
 *
 * OpenAI-compatible servers expose reasoning text in one of two ways: a
 * dedicated field beside `content`, or `<think>...</think>` written inline at
 * the very start of `content`. Both are reduced to `{ thinking, content }`
 * here.
 *
 * LiteLLM adds a third shape for Anthropic models: `thinking_blocks`, each
 * carrying a cryptographic `signature` over its text. Anthropic rejects a
 * tool-call continuation whose assistant message does not start with the
 * blocks it produced, so they are kept verbatim and replayed by
 * `core/tool-calls.js`. A `redacted_thinking` block carries only opaque `data`:
 * it cannot be shown, but it must be replayed all the same.
 */

/**
 * Plain-text reasoning fields, in the order they are read: DeepSeek / vLLM /
 * llama.cpp / LM Studio / LiteLLM, then OpenRouter / Ollama. These are also the
 * only names reasoning may be echoed back under.
 */
export const REASONING_FIELDS = ['reasoning_content', 'reasoning'];

export function isReasoningField(name) {
  return REASONING_FIELDS.includes(name);
}

const THINKING_BLOCK = 'thinking';
const REDACTED_BLOCK = 'redacted_thinking';

const REDACTED_NOTE = '*Part of this reasoning was encrypted by the provider and cannot be shown.*';

const TAGS = ['think', 'thinking'].map((name) => ({
  open: `<${name}>`,
  close: `</${name}>`,
  closePattern: new RegExp(`</${name}>`, 'i'),
}));

const LONGEST_OPEN_TAG = Math.max(...TAGS.map((tag) => tag.open.length));

/** The reasoning text carried by a streamed delta or a complete message, if any. */
export function reasoningOf(part) {
  for (const field of REASONING_FIELDS) {
    const value = part?.[field];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

/* ------------------------------------------------------------------ *
 * Inline tags
 * ------------------------------------------------------------------ */

/** True while `body` is a strict prefix of an opening tag, e.g. `<thi`. */
function couldBecomeOpenTag(body) {
  const head = body.toLowerCase();
  return TAGS.some((tag) => head.length < tag.open.length && tag.open.startsWith(head));
}

/** Drop a half-arrived closing tag (`...</thi`) from the end of streamed reasoning. */
function withoutPartialClose(text, closeTag) {
  const limit = Math.min(text.length, closeTag.length - 1);
  for (let size = limit; size > 0; size--) {
    if (text.slice(-size).toLowerCase() === closeTag.slice(0, size)) {
      return text.slice(0, -size);
    }
  }
  return text;
}

/**
 * Split inline reasoning tags out of the content accumulated so far.
 *
 * Designed to be re-run on the whole accumulated string after every delta, so
 * it needs no parser state. An opening tag only counts at the very start of
 * the reply; a closing tag with no opening tag is ordinary text, because a
 * reply that merely mentions the tag would otherwise lose its first half.
 *
 * While streaming (`final: false`), text that might still turn into an opening
 * tag is held back rather than shown as an answer that then has to be
 * retracted. `final: true` releases it.
 */
export function splitReasoning(text, { final = false } = {}) {
  const source = text || '';
  const body = source.trimStart();
  const head = body.slice(0, LONGEST_OPEN_TAG).toLowerCase();
  const tag = TAGS.find((candidate) => head.startsWith(candidate.open));

  if (!tag) {
    if (!final && couldBecomeOpenTag(body)) return { thinking: '', content: '' };
    return { thinking: '', content: source };
  }

  const inner = body.slice(tag.open.length);
  const close = tag.closePattern.exec(inner);

  if (!close) {
    const visible = final ? inner : withoutPartialClose(inner, tag.close);
    return { thinking: visible.trim(), content: '' };
  }

  return {
    thinking: inner.slice(0, close.index).trim(),
    content: inner.slice(close.index + close[0].length).trimStart(),
  };
}

/* ------------------------------------------------------------------ *
 * Thinking blocks
 * ------------------------------------------------------------------ */

/**
 * The thinking-block fragments carried by a streamed delta or a complete
 * message. LiteLLM puts them at the top level; some versions and routes nest
 * them under `provider_specific_fields`. Only one location is read, so a
 * server that fills both cannot double every block.
 */
export function thinkingBlocksOf(part) {
  const direct = part?.thinking_blocks;
  if (Array.isArray(direct) && direct.length) return direct;
  const nested = part?.provider_specific_fields?.thinking_blocks;
  return Array.isArray(nested) ? nested : [];
}

/**
 * Accumulates thinking-block fragments into complete blocks.
 *
 * LiteLLM streams a block as a run of fragments carrying pieces of its text
 * and no index, then one fragment carrying the whole signature, which closes
 * it. A fragment arriving after that starts the next block. A complete
 * message's blocks each carry text and signature together, so feeding them
 * through here reproduces them unchanged. A signature with no open block
 * becomes a block of its own: models that omit their thinking from the
 * response still send a signed, empty block that must be replayed.
 */
export function createThinkingBlockAccumulator() {
  const blocks = [];

  const openBlock = () => {
    const last = blocks[blocks.length - 1];
    return last && last.type === THINKING_BLOCK && !last.signature ? last : null;
  };

  return {
    add(fragments) {
      if (!Array.isArray(fragments)) return;
      for (const fragment of fragments) {
        if (!fragment || typeof fragment !== 'object') continue;

        if (fragment.type === REDACTED_BLOCK) {
          if (typeof fragment.data === 'string' && fragment.data) {
            blocks.push({ type: REDACTED_BLOCK, data: fragment.data });
          }
          continue;
        }
        if (fragment.type !== undefined && fragment.type !== THINKING_BLOCK) continue;

        const text = typeof fragment.thinking === 'string' ? fragment.thinking : '';
        const signature = typeof fragment.signature === 'string' ? fragment.signature : '';
        if (!text && !signature) continue;

        let block = openBlock();
        if (!block) {
          block = { type: THINKING_BLOCK, thinking: '', signature: '' };
          blocks.push(block);
        }
        block.thinking += text;
        if (signature) block.signature = signature;
      }
    },

    /** Total text received, so a caller can tell whether anything grew. */
    size() {
      return blocks.reduce(
        (sum, block) =>
          sum +
          (block.thinking || '').length +
          (block.signature || '').length +
          (block.data || '').length,
        0,
      );
    },

    /** Fresh copies of every block so far, finished or not. */
    list() {
      return blocks.map((block) => ({ ...block }));
    },
  };
}

/** The readable text of a set of blocks; redacted blocks have none. */
export function thinkingBlocksText(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((block) => block?.type === THINKING_BLOCK && typeof block.thinking === 'string')
    .map((block) => block.thinking.trim())
    .filter(Boolean)
    .join('\n\n');
}

function hasRedacted(blocks) {
  return Array.isArray(blocks) && blocks.some((block) => block?.type === REDACTED_BLOCK);
}

/**
 * The blocks a provider will accept back, reduced to wire fields: thinking
 * blocks that were signed, and redacted blocks that carry data. A block left
 * unsigned was cut off mid-stream, and sending it would fail the request.
 */
export function replayableBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  const out = [];
  for (const block of blocks) {
    if (block?.type === REDACTED_BLOCK) {
      if (typeof block.data === 'string' && block.data) {
        out.push({ type: REDACTED_BLOCK, data: block.data });
      }
      continue;
    }
    if (block?.type === THINKING_BLOCK && typeof block.signature === 'string' && block.signature) {
      out.push({
        type: THINKING_BLOCK,
        thinking: typeof block.thinking === 'string' ? block.thinking : '',
        signature: block.signature,
      });
    }
  }
  return out;
}

/**
 * The reasoning stored on a round of tool calls, or null when there is
 * nothing worth keeping:
 *
 *   { model, text, blocks }
 *
 * `model` is the model that wrote it; nothing is replayed to any other.
 * `blocks` are the replayable thinking blocks. `text` is the plain reasoning
 * field, kept only when there are no blocks: with blocks it would be a third
 * copy of the same reasoning, and a server that returns blocks takes them in
 * preference anyway.
 */
export function normalizeRoundReasoning(value) {
  if (!value || typeof value !== 'object') return null;
  const model = typeof value.model === 'string' ? value.model : '';
  const blocks = replayableBlocks(value.blocks);
  const text = !blocks.length && typeof value.text === 'string' ? value.text : '';
  if (!model || (!text && !blocks.length)) return null;
  return { model, text, blocks };
}

/* ------------------------------------------------------------------ *
 * Display
 * ------------------------------------------------------------------ */

/**
 * Combine every source of reasoning into one `{ thinking, content }`.
 *
 * The plain field and the blocks usually carry the same text (LiteLLM fills
 * `reasoning_content` from the blocks), so the blocks are read only when the
 * field is empty. A redacted block adds a note, so a box whose reasoning is
 * all encrypted does not look as if the model never thought.
 */
export function resolveReply({ reasoning = '', content = '', blocks = [] }, options) {
  const inline = splitReasoning(content, options);
  const fielded = reasoning.trim() || thinkingBlocksText(blocks);
  const note = hasRedacted(blocks) ? REDACTED_NOTE : '';
  const thinking = [fielded, inline.thinking, note].filter(Boolean).join('\n\n');
  return { thinking, content: inline.content };
}
