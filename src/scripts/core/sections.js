import { tokensForLength } from './tokens.js';

/**
 * A document as a run of sections, and the offset arithmetic around them.
 *
 * A section is `{ index, start, end, path, preamble? }`: a span of the file
 * text (end exclusive) and its place in the document hierarchy, outermost
 * first. Sections are built from parser boundaries, cover the whole text in
 * order, and never overlap. Text before the first boundary is an untitled
 * preamble section; a parser that finds nothing leaves the whole file as one
 * section.
 */

/** How far a cut may move to land on a line break. */
const SNAP_CHARS = 200;
const LABEL_CHARS = 60;

function normalizePath(path) {
  if (typeof path === 'string') return path.trim() ? [path.replace(/\s+/g, ' ').trim()] : [];
  if (!Array.isArray(path)) return [];
  return path.map((part) => String(part ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Valid, sorted, de-duplicated boundaries. A bare number is a start with no path. */
export function normalizeBoundaries(raw, length) {
  const byStart = new Map();
  for (const entry of Array.isArray(raw) ? raw : []) {
    const start = typeof entry === 'number' ? entry : entry?.start;
    if (!Number.isInteger(start) || start < 0 || start >= length) continue;
    if (byStart.has(start)) continue;
    byStart.set(start, normalizePath(entry?.path));
  }
  return [...byStart].sort((a, b) => a[0] - b[0]).map(([start, path]) => ({ start, path }));
}

export function buildSections(text, rawBoundaries) {
  const length = (text || '').length;
  if (!length) return [];

  const boundaries = normalizeBoundaries(rawBoundaries, length);
  const hasPreamble = boundaries.length > 0 && boundaries[0].start > 0;
  if (!boundaries.length || hasPreamble) boundaries.unshift({ start: 0, path: [] });

  return boundaries.map((boundary, index) => {
    const section = {
      index,
      start: boundary.start,
      end: index + 1 < boundaries.length ? boundaries[index + 1].start : length,
      path: boundary.path,
    };
    if (index === 0 && hasPreamble) section.preamble = true;
    return section;
  });
}

/** The section containing `offset`, by binary search. */
export function sectionAt(sections, offset) {
  let low = 0;
  let high = sections.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (sections[mid].start <= offset) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found === -1 ? null : sections[found];
}

/** The offset at which every line starts, for line numbers. */
export function createLineIndex(text) {
  const source = text || '';
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/** The 1-based line number of `offset`. */
export function lineAt(lines, offset) {
  let low = 0;
  let high = lines.length - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid] <= offset) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found + 1;
}

export function breadcrumb(path) {
  return (path || []).join(' › ');
}

/** A short name for a section: its last path entry, or its first line. */
export function sectionLabel(section, text) {
  if (section.path.length) return section.path[section.path.length - 1];
  const body = (text || '').slice(section.start, Math.min(section.end, section.start + 400));
  const line = body.split('\n').map((entry) => entry.trim()).find(Boolean) || '';
  return line.length > LABEL_CHARS ? `${line.slice(0, LABEL_CHARS - 3)}...` : line;
}

export function sectionTokens(section) {
  return tokensForLength(section.end - section.start);
}

/**
 * Move `offset` forward to the start of the next line, if one begins soon and
 * no later than `ceiling`.
 */
export function forwardToLine(text, offset, ceiling) {
  if (offset <= 0 || offset >= ceiling || text[offset - 1] === '\n') return offset;
  const newline = text.indexOf('\n', offset);
  const next = newline === -1 ? text.length : newline + 1;
  if (next > ceiling || next - offset > SNAP_CHARS) return offset;
  return next;
}

/**
 * Move `offset` back to the start of its line, if that is close and no
 * earlier than `floor`.
 */
export function backToLine(text, offset, floor) {
  if (offset <= floor || text[offset - 1] === '\n') return offset;
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  if (lineStart < floor || offset - lineStart > SNAP_CHARS) return offset;
  return lineStart;
}

/** Split `[start, end)` into pieces of at most about `maxChars`, cut at line breaks where possible. */
export function splitWindows(text, start, end, maxChars) {
  const windows = [];
  let cursor = start;
  while (end - cursor > maxChars) {
    let cut = cursor + maxChars;
    const newline = text.lastIndexOf('\n', cut - 1);
    if (newline + 1 > cursor + maxChars / 2) cut = newline + 1;
    windows.push({ start: cursor, end: cut });
    cursor = cut;
  }
  windows.push({ start: cursor, end });
  return windows;
}

/**
 * The part of a section worth showing for a match at `offset`: the whole
 * section when it fits in `maxChars`, otherwise a window centred on the match,
 * widened to whole lines.
 */
export function windowAround(text, section, offset, maxChars) {
  if (section.end - section.start <= maxChars) return { start: section.start, end: section.end };
  const half = Math.floor(maxChars / 2);
  let start = Math.max(section.start, Math.min(offset - half, section.end - maxChars));
  let end = Math.min(section.end, start + maxChars);
  start = backToLine(text, start, section.start);
  end = forwardToLine(text, end, section.end);
  return { start, end };
}

/**
 * Figures and warnings about how a parser split a document, for the outline
 * preview and for the assistant's self-check. `severe` warnings mean the
 * split is not useful as it stands.
 */
export function outlineStats(text, sections, { maxSectionTokens }) {
  const source = text || '';
  const count = sections.length;
  const sizes = sections.map(sectionTokens);
  const oversized = sizes.filter((size) => size > maxSectionTokens).length;
  const largestTokens = sizes.reduce((max, size) => Math.max(max, size), 0);
  const maxDepth = sections.reduce((max, section) => Math.max(max, section.path.length), 0);
  const preamble = sections.find((section) => section.preamble);
  const preambleShare = preamble && source.length ? (preamble.end - preamble.start) / source.length : 0;
  const sorted = [...sizes].sort((a, b) => a - b);
  const medianTokens = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

  const warnings = [];
  if (!count) {
    warnings.push({ severe: false, message: 'The file is empty.' });
  }
  if (count === 1 && source.length > 5000) {
    warnings.push({
      severe: true,
      message: 'The whole file is a single section: the parser found no boundaries in it.',
    });
  }
  if (count > 1 && preambleShare > 0.5) {
    warnings.push({
      severe: true,
      message: `${Math.round(preambleShare * 100)}% of the file comes before the first section, as an untitled preamble.`,
    });
  }
  if (oversized) {
    const share = oversized / count;
    warnings.push({
      severe: share > 0.2,
      message:
        `${oversized} of ${count} sections are longer than ${maxSectionTokens} tokens (the largest is about ${largestTokens}). ` +
        `Results from them are excerpts${share > 0.2 ? ', so most of the document is not split into useful units' : ''}.`,
    });
  }
  if (count > 20 && medianTokens < 8) {
    warnings.push({
      severe: false,
      message: `Most sections are very short (median about ${medianTokens} tokens), so each result carries little context.`,
    });
  }

  return {
    count,
    maxDepth,
    oversized,
    largestTokens,
    medianTokens,
    preambleShare,
    totalTokens: tokensForLength(source.length),
    warnings,
  };
}
