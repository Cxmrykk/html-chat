/**
 * Searching chat text: building a matcher from what the user typed, finding
 * its matches in a text, and summarising a chat's hits.
 *
 *   - text:     the query as typed, anywhere in the text;
 *   - wildcard: `*` is any run of characters and `?` any one character,
 *               both within a line; everything else is literal;
 *   - regex:    a JavaScript pattern, either bare or as `/pattern/flags`.
 *
 * Matching ignores case unless `caseSensitive` (a `/pattern/flags` regex
 * decides with its own flags). Empty matches never count.
 */

export const SEARCH_MODES = [
  { value: 'text', label: 'Contains', hint: 'Search every chat for this text...' },
  {
    value: 'wildcard',
    label: 'Wildcard',
    hint: 'Search every chat. * matches any run of characters and ? any one character, within a line...',
  },
  {
    value: 'regex',
    label: 'Regex',
    hint: 'Search every chat with a JavaScript regular expression, bare or as /pattern/flags...',
  },
];

/** At most this many matches are counted per chat. */
export const MATCH_LIMIT = 1000;

const SNIPPET_RADIUS = 60;
const SNIPPET_MATCH_MAX = 200;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wildcardSource(pattern) {
  return [...pattern]
    .map((char) => (char === '*' ? '[^\\n]*' : char === '?' ? '[^\\n]' : escapeRegExp(char)))
    .join('');
}

function withGlobal(flags) {
  return flags.includes('g') ? flags : `${flags}g`;
}

/**
 * `{ ok: true, empty: true }` for a blank query, `{ ok: false, error }` for a
 * pattern that does not compile, else `{ ok: true, empty: false, regex }`.
 */
export function createMatcher({ query = '', mode = 'text', caseSensitive = false } = {}) {
  const text = String(query ?? '');
  if (!text.trim()) return { ok: true, empty: true };

  const caseFlag = caseSensitive ? '' : 'i';
  try {
    if (mode === 'regex') {
      const literal = /^\/([\s\S]+)\/([a-z]*)$/.exec(text.trim());
      const regex = literal
        ? new RegExp(literal[1], withGlobal(literal[2]))
        : new RegExp(text, withGlobal(caseFlag));
      return { ok: true, empty: false, regex };
    }
    const source = mode === 'wildcard' ? wildcardSource(text) : escapeRegExp(text);
    return { ok: true, empty: false, regex: new RegExp(source, withGlobal(caseFlag)) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/** Up to `limit` non-empty matches of `matcher` in `text`: `[{ index, length }]`. */
export function findMatches(text, matcher, limit = MATCH_LIMIT) {
  const out = [];
  if (!matcher?.regex || !text || limit <= 0) return out;
  const regex = new RegExp(matcher.regex.source, matcher.regex.flags);
  let match;
  while (out.length < limit && (match = regex.exec(text))) {
    if (!match[0].length) {
      regex.lastIndex++;
      continue;
    }
    out.push({ index: match.index, length: match[0].length });
  }
  return out;
}

const flat = (value) => value.replace(/\s+/g, ' ');

/** The text around a match, on one line: `{ before, match, after }`. */
export function snippetAround(text, { index, length }, radius = SNIPPET_RADIUS) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  let match = flat(text.slice(index, index + length));
  if (match.length > SNIPPET_MATCH_MAX) match = `${match.slice(0, SNIPPET_MATCH_MAX)}…`;
  return {
    before: (start > 0 ? '…' : '') + flat(text.slice(start, index)).trimStart(),
    match,
    after: flat(text.slice(index + length, end)).trimEnd() + (end < text.length ? '…' : ''),
  };
}

/**
 * A chat's hits, or null when nothing matches:
 * `{ count, capped, messageIndex, role, snippet }`, where the last three
 * describe the first match. `textOf(message)` is the text searched.
 */
export function searchChat(chat, matcher, textOf, limit = MATCH_LIMIT) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  let count = 0;
  let first = null;

  for (let i = 0; i < messages.length && count < limit; i++) {
    const text = textOf(messages[i]);
    if (!text) continue;
    const matches = findMatches(text, matcher, limit - count);
    if (!matches.length) continue;
    if (!first) {
      first = { messageIndex: i, role: messages[i].role, snippet: snippetAround(text, matches[0]) };
    }
    count += matches.length;
  }

  return count ? { count, capped: count >= limit, ...first } : null;
}
