/**
 * Separating a model's reasoning from its answer.
 *
 * OpenAI-compatible servers expose reasoning in one of two ways: a dedicated
 * field beside `content`, or `<think>...</think>` written inline at the very
 * start of `content`. Both are reduced to `{ thinking, content }` here.
 */

/** Field names in use: DeepSeek / vLLM / llama.cpp / LM Studio, then OpenRouter / Ollama. */
const REASONING_FIELDS = ['reasoning_content', 'reasoning'];

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

/** Combine field-based and inline reasoning into one `{ thinking, content }`. */
export function resolveReply({ reasoning = '', content = '' }, options) {
  const inline = splitReasoning(content, options);
  const thinking = [reasoning.trim(), inline.thinking].filter(Boolean).join('\n\n');
  return { thinking, content: inline.content };
}
