/**
 * Literal and regular-expression matching over a document's text, and
 * grouping the matches by section. Pure: no storage, no budget, no output.
 */

export const REGEX_FLAGS = 'imsu';
export const MAX_MATCHES = 5000;

export function escapeRegExp(text) {
  return String(text ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A case-insensitive literal search, as a regex so offsets stay exact. */
export function textPattern(query) {
  return new RegExp(escapeRegExp(query), 'giu');
}

const SLASHED = /^\/([\s\S]+)\/([a-z]*)$/;

/**
 * Compile a model-written pattern. `/source/flags` is accepted when no
 * separate flags are given, and flags outside `imsu` are ignored.
 */
export function compilePattern(pattern, flags) {
  let source = typeof pattern === 'string' ? pattern : '';
  let given = typeof flags === 'string' ? flags : '';
  const slashed = SLASHED.exec(source);
  if (slashed && !given) {
    source = slashed[1];
    given = slashed[2];
  }
  if (!source) return { ok: false, error: 'The pattern is empty.' };

  const allowed = [...new Set(given.split(''))].filter((flag) => REGEX_FLAGS.includes(flag)).join('');
  try {
    return { ok: true, regex: new RegExp(source, `${allowed}g`) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function advance(text, index, unicode) {
  if (!unicode || index >= text.length) return index + 1;
  return index + (text.codePointAt(index) > 0xffff ? 2 : 1);
}

/**
 * Every non-empty match, in order, up to `limit`. Empty matches (`^`, `x*`)
 * are stepped over and not counted.
 */
export function findMatches(text, regex, limit = MAX_MATCHES) {
  const source = text || '';
  const pattern = regex.global ? regex : new RegExp(regex.source, `${regex.flags}g`);
  pattern.lastIndex = 0;

  const matches = [];
  let truncated = false;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (match[0].length === 0) {
      pattern.lastIndex = advance(source, pattern.lastIndex, pattern.unicode);
      continue;
    }
    if (matches.length >= limit) {
      truncated = true;
      break;
    }
    matches.push({ start: match.index, end: match.index + match[0].length });
  }
  return { matches, truncated };
}

/**
 * Matches per section, in document order: section index ->
 * `{ count, first }`, where `first` is the offset of its first match.
 */
export function hitsBySection(sections, matches) {
  const hits = new Map();
  let cursor = 0;
  for (const match of matches) {
    while (cursor < sections.length - 1 && sections[cursor].end <= match.start) cursor++;
    const section = sections[cursor];
    if (!section) break;
    const entry = hits.get(section.index);
    if (entry) entry.count++;
    else hits.set(section.index, { count: 1, first: match.start });
  }
  return hits;
}
