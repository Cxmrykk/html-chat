import { ICON_CHEVRON_DOWN } from './icons.js';

/**
 * Collapsible code blocks: marking long ones, their fade overlay, and opening
 * or closing them without the code jumping on screen.
 *
 * A collapsed block is a scroll container of its own, `--preview-lines` tall.
 * Its "origin" is where the top of its code sits on screen: the block's top
 * minus how far it is scrolled. Opening or closing it keeps that origin still,
 * by scrolling the transcript by whatever the block's own scroll changed, so
 * every line stays exactly where it was:
 *
 *   - Expanding: a preview scrolled down by `s` opens in place, and the
 *     transcript moves down by `s`, so the lines it showed do not move.
 *   - Collapsing: the preview is scrolled to the first line at the top of the
 *     transcript's visible area (0 when the block's top is on screen), and
 *     the transcript moves up by the same amount, so the preview closes
 *     around the lines that were in view.
 *
 * The two are exact inverses: expanding and then collapsing without moving
 * the page puts everything back where it was.
 *
 * The fade over a collapsed block cannot live inside it, or it would scroll
 * away with the code, so each collapsible `<pre>` is wrapped in a frame that
 * holds the overlay beside it. The overlay is pinned to the preview's bottom
 * edge, clear of its scrollbars, and fades out once the last line is in view.
 */

const FRAME_CLASS = 'code-collapse-frame';
const OVERLAY_CLASS = 'code-collapse-overlay';

/** A click this soon after scrolling a preview ended the scroll, and does not toggle. */
const SCROLL_GRACE_MS = 150;

/** pre -> when the user last scrolled it by wheel or touch. */
const lastUserScroll = new WeakMap();

function frameOf(pre) {
  const parent = pre.parentElement;
  return parent?.classList.contains(FRAME_CLASS) ? parent : null;
}

function overlayOf(pre) {
  const next = pre.nextElementSibling;
  return next?.classList.contains(OVERLAY_CLASS) ? next : null;
}

/** Put `pre` in a frame with an overlay, once. Resolves with the overlay. */
function wrap(pre) {
  let frame = frameOf(pre);
  if (!frame) {
    frame = document.createElement('div');
    frame.className = FRAME_CLASS;
    pre.replaceWith(frame);
    frame.appendChild(pre);
  }

  let overlay = overlayOf(pre);
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = OVERLAY_CLASS;
    overlay.setAttribute('aria-hidden', 'true');
    frame.appendChild(overlay);
  }
  return overlay;
}

/** A block no longer long enough to collapse: back to a plain `<pre>`. */
function unwrap(pre) {
  const frame = frameOf(pre);
  if (frame) frame.replaceWith(pre);
  pre.classList.remove('collapsible-code', 'collapsed');
  pre.removeAttribute('data-collapsible');
  pre.style.removeProperty('--preview-lines');
}

/**
 * Bring a block's overlay up to date: pinned inside its borders and clear of
 * its scrollbars, and faded out once the preview shows its last line.
 */
export function syncCodeOverlay(pre) {
  const overlay = overlayOf(pre);
  if (!overlay) return;

  const collapsed = pre.classList.contains('collapsed');
  const atEnd = collapsed && pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 1;
  overlay.classList.toggle('at-end', atEnd);
  if (!collapsed) return;

  // Border plus scrollbar on the right and at the bottom.
  const right = pre.offsetWidth - pre.clientWidth - pre.clientLeft;
  const bottom = pre.offsetHeight - pre.clientHeight - pre.clientTop;
  overlay.style.left = `${pre.clientLeft}px`;
  overlay.style.right = `${Math.max(0, right)}px`;
  overlay.style.bottom = `${Math.max(0, bottom)}px`;
}

/**
 * Mark every code block inside `element` longer than `threshold` lines as
 * collapsible. A block seen for the first time starts collapsed when
 * `autoCollapse` is on; one already marked keeps whatever the user made it,
 * until its node is recreated.
 */
export function setupCollapsibleCode(element, { autoCollapse, threshold, previewLines, showHint }) {
  for (const pre of element.querySelectorAll('pre')) {
    const lines = (pre.textContent || '').replace(/\s+$/, '').split('\n').length;
    if (lines <= threshold) {
      unwrap(pre);
      continue;
    }

    pre.classList.add('collapsible-code');
    pre.style.setProperty('--preview-lines', previewLines);
    if (!pre.hasAttribute('data-collapsible')) {
      pre.setAttribute('data-collapsible', 'true');
      if (autoCollapse) pre.classList.add('collapsed');
    }

    const overlay = wrap(pre);
    if (showHint && !overlay.firstChild) overlay.innerHTML = ICON_CHEVRON_DOWN;
    else if (!showHint && overlay.firstChild) overlay.innerHTML = '';

    syncCodeOverlay(pre);
  }
}

/** The transcript a block scrolls with, or null outside it. */
function scrollerOf(pre) {
  return pre.closest('#chat-container');
}

/** Open or close a block, keeping every line of its code where it is on screen. */
export function toggleCodeBlock(pre) {
  const scroller = scrollerOf(pre);
  const originBefore = pre.getBoundingClientRect().top - pre.scrollTop;

  if (pre.classList.contains('collapsed')) {
    pre.classList.remove('collapsed');
    pre.scrollTop = 0;
  } else {
    // Expanded, the block does not scroll, so its origin is its top.
    const visibleTop = scroller
      ? scroller.getBoundingClientRect().top + scroller.clientTop
      : 0;
    pre.classList.add('collapsed');
    // The browser clamps this to the last full window of the preview.
    pre.scrollTop = Math.max(0, visibleTop - originBefore);
  }

  if (scroller) {
    const originAfter = pre.getBoundingClientRect().top - pre.scrollTop;
    scroller.scrollTop += originAfter - originBefore;
  }

  syncCodeOverlay(pre);
}

/** Record a wheel or touch scroll aimed at a collapsed preview. */
export function noteCodeScrollGesture(target) {
  const pre = target instanceof Element ? target.closest('pre.collapsible-code.collapsed') : null;
  if (pre) lastUserScroll.set(pre, performance.now());
}

/** Whether the user scrolled this preview a moment ago. */
export function scrolledJustNow(pre) {
  const at = lastUserScroll.get(pre);
  return at !== undefined && performance.now() - at < SCROLL_GRACE_MS;
}

/** Whether a pointer event landed on the block's own scrollbar (or right/bottom border). */
export function isOnScrollbar(pre, event) {
  const rect = pre.getBoundingClientRect();
  const x = event.clientX - rect.left - pre.clientLeft;
  const y = event.clientY - rect.top - pre.clientTop;
  return x >= pre.clientWidth || y >= pre.clientHeight;
}

/* ------------------------------------------------------------------ *
 * Keeping state across a rebuilt row
 * ------------------------------------------------------------------ */

/**
 * The state of every collapsible code block inside `element`, keyed by its
 * code text: whether it is collapsed, and where it is scrolled. Taken before
 * a row is rebuilt (entering or leaving an edit, say), so the rebuilt row
 * looks exactly as the old one did instead of falling back to the defaults.
 */
export function codeCollapseState(element) {
  if (!element) return [];
  return [...element.querySelectorAll('pre[data-collapsible]')].map((pre) => {
    const collapsed = pre.classList.contains('collapsed');
    return {
      text: pre.textContent || '',
      collapsed,
      scrollTop: collapsed ? pre.scrollTop : 0,
      scrollLeft: pre.scrollLeft,
    };
  });
}

/**
 * Re-apply a state taken by `codeCollapseState` to freshly enhanced blocks.
 * Blocks are matched by their code text, in order, so a block whose code
 * changed (an edit was saved) simply keeps the defaults, and the others keep
 * their state even if blocks before them were added or removed.
 */
export function restoreCodeCollapseState(element, saved) {
  if (!element || !Array.isArray(saved) || !saved.length) return;

  const byText = new Map();
  for (const entry of saved) {
    if (!byText.has(entry.text)) byText.set(entry.text, []);
    byText.get(entry.text).push(entry);
  }

  for (const pre of element.querySelectorAll('pre[data-collapsible]')) {
    const queue = byText.get(pre.textContent || '');
    if (!queue || !queue.length) continue;
    const entry = queue.shift();
    pre.classList.toggle('collapsed', entry.collapsed);
    pre.scrollTop = entry.collapsed ? entry.scrollTop : 0;
    pre.scrollLeft = entry.scrollLeft || 0;
    syncCodeOverlay(pre);
  }
}
