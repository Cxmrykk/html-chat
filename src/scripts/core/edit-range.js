/**
 * Which part of a message is being edited, and the text it covers.
 *
 * A message renders as a run of top-level markdown blocks, each a span of its
 * source: `{ start, end }` character offsets, end exclusive (see
 * `sourceBlocks` in `ui/markdown.js`). An edit covers exactly one of them,
 * held as a range of block indices, `{ start, end }`, both inclusive and
 * always equal. The range shape is kept so the slicing below, the stale-edit
 * check and the selection outline need no special case for a single block.
 *
 * A message with no blocks at all (empty, or only whitespace) is edited whole,
 * as the range `{ start: 0, end: 0 }`.
 */

/**
 * The range after a click on block `clicked`, or null when the click leaves
 * nothing selected.
 *
 *   - Clicking the selected block deselects it.
 *   - Clicking any other block (or any block while nothing is selected)
 *     selects that block alone.
 */
export function nextRange(range, clicked) {
  if (range && range.start === clicked && range.end === clicked) return null;
  return { start: clicked, end: clicked };
}

/** Whether `range` addresses a single block that exists. */
export function isValidRange(range, blockCount) {
  if (!range || !Number.isInteger(range.start) || !Number.isInteger(range.end)) return false;
  if (range.start < 0 || range.start !== range.end) return false;
  if (blockCount === 0) return range.start === 0;
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
