/**
 * Which part of a message is being edited, and the text it covers.
 *
 * A message renders as a run of top-level markdown blocks, each a span of its
 * source: `{ start, end }` character offsets, end exclusive (see
 * `sourceBlocks` in `ui/markdown.js`). An edit covers a contiguous run of
 * them, held as a range of block indices:
 *
 *   { start, end, anchor }
 *
 * `start` and `end` are both inclusive, `start <= end`. `anchor` is the block
 * the selection was started from (the last plain click); Shift+Click extends
 * the selection from it to the clicked block, whichever side that is on. The
 * text covered is everything from the first selected block's start to the
 * last one's end, blank lines between them included.
 *
 * A message with no blocks at all (empty, or only whitespace) is edited whole,
 * as the range `{ start: 0, end: 0, anchor: 0 }`.
 */

/** The block a range extends from: its anchor if it has a valid one, else its start. */
function anchorOf(range) {
  const { anchor, start, end } = range;
  return Number.isInteger(anchor) && anchor >= start && anchor <= end ? anchor : start;
}

/**
 * The range after a click on block `clicked`, or null when the click leaves
 * nothing selected.
 *
 *   - A plain click on the only selected block deselects it.
 *   - A plain click on any other block (or any block while nothing is
 *     selected) selects that block alone, and makes it the anchor.
 *   - A Shift+Click (`extend`) while something is selected selects every
 *     block from the anchor to the clicked one, both included. The anchor
 *     stays put, so further Shift+Clicks re-span from it.
 *   - A Shift+Click while nothing is selected is a plain click.
 */
export function nextRange(range, clicked, { extend = false } = {}) {
  if (extend && range) {
    const anchor = anchorOf(range);
    return { start: Math.min(anchor, clicked), end: Math.max(anchor, clicked), anchor };
  }
  if (range && range.start === clicked && range.end === clicked) return null;
  return { start: clicked, end: clicked, anchor: clicked };
}

/** Whether two ranges (or two nulls) select the same blocks from the same anchor. */
export function sameRange(a, b) {
  if (!a || !b) return a === b;
  return a.start === b.start && a.end === b.end && anchorOf(a) === anchorOf(b);
}

/** Whether `range` addresses a run of blocks that exists. */
export function isValidRange(range, blockCount) {
  if (!range || !Number.isInteger(range.start) || !Number.isInteger(range.end)) return false;
  if (range.start < 0 || range.end < range.start) return false;
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
