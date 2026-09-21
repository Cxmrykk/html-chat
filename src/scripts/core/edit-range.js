/**
 * Which part of a message is being edited, and the text it covers.
 *
 * A message renders as a run of top-level markdown blocks, each a span of its
 * source: `{ start, end }` character offsets, end exclusive (see
 * `sourceBlocks` in `ui/markdown.js`). An edit covers a contiguous run of
 * them, held as a range of block indices, `{ start, end }`, both inclusive.
 *
 * A message with no blocks at all (empty, or only whitespace) is edited whole,
 * as the range `{ start: 0, end: 0 }`.
 */

/**
 * The range after a click on block `clicked`, or null when the click leaves
 * nothing selected.
 *
 *   - Nothing picked yet: the clicked block alone.
 *   - Outside the range: the range grows to reach it.
 *   - Inside a range of one or two blocks: the click toggles the clicked
 *     block. One block clicked off leaves nothing; either of two clicked off
 *     leaves the other.
 *   - Inside a longer range: only what lies strictly below the clicked block
 *     is kept, or with `fromBottom`, strictly above it. The clicked block
 *     itself is always dropped, so clicking the last block (or with
 *     `fromBottom`, the first) leaves nothing.
 */
export function nextRange(range, clicked, { fromBottom = false } = {}) {
  if (!range) return { start: clicked, end: clicked };
  if (clicked < range.start) return { start: clicked, end: range.end };
  if (clicked > range.end) return { start: range.start, end: clicked };

  const size = range.end - range.start + 1;
  if (size === 1) return null;
  if (size === 2) {
    const other = clicked === range.start ? range.end : range.start;
    return { start: other, end: other };
  }

  const kept = fromBottom
    ? { start: range.start, end: clicked - 1 }
    : { start: clicked + 1, end: range.end };
  return kept.start <= kept.end ? kept : null;
}

/** Whether `range` addresses blocks that exist. */
export function isValidRange(range, blockCount) {
  if (!range || !Number.isInteger(range.start) || !Number.isInteger(range.end)) return false;
  if (range.start < 0 || range.start > range.end) return false;
  if (blockCount === 0) return range.start === 0 && range.end === 0;
  return range.end < blockCount;
}

/**
 * The content cut around the range:
 *
 *   { before, body, trail, after }
 *
 * `body` is what the composer shows: the selected source without its trailing
 * whitespace. That whitespace (`trail`) is what separates the selection from
 * the block after it, so it is put back whatever the edit does to the end of
 * the text. Null when the range does not fit the blocks.
 */
export function editSlice(content, blocks, range) {
  const source = typeof content === 'string' ? content : '';
  const list = Array.isArray(blocks) ? blocks : [];
  if (!isValidRange(range, list.length)) return null;

  const start = list.length ? list[range.start].start : 0;
  const end = list.length ? list[range.end].end : source.length;
  const selected = source.slice(start, end);
  const body = selected.replace(/\s+$/, '');

  return {
    before: source.slice(0, start),
    body,
    trail: selected.slice(body.length),
    after: source.slice(end),
  };
}

/** The whole content with the selection replaced by `edited`. */
export function applyEdit(slice, edited) {
  const body = String(edited ?? '').replace(/\s+$/, '');
  return `${slice.before}${body}${slice.trail}${slice.after}`;
}
