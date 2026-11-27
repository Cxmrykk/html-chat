import { ICON_CHEVRON_DOWN } from './icons.js';

/**
 * Collapsible code blocks: marking long ones, their fade overlay, and opening
 * or closing them without the code jumping on screen.
 *
 * A collapsed block is a scroll container of its own, `--preview-lines` tall.
 * Its "origin" is where the top of its code sits on screen: the block's top
 * minus how far it is scrolled.
 *
 * Expanding keeps the origin still, by scrolling the transcript by however
 * far the preview was scrolled, so the lines it showed do not move. That
 * scroll is kept on the block (`data-opened-at`): it is "where it was opened".
 *
 * Collapsing decides two things separately: which lines the preview shows
 * (its own scroll), and where on screen it lands (the transcript's scroll).
 *
 *   1. A click inside the window the preview had when it was opened puts it
 *      back exactly there. Expanding and collapsing without moving the page
 *      is a pixel-perfect round trip.
 *   2. A click anywhere else centres the preview on the click, kept inside
 *      the visible area where it fits, showing the lines that were under it:
 *      the clicked line stays under the cursor.
 *
 * Either way, the lines the preview shows are kept. When the transcript
 * cannot scroll far enough to put the preview where it is meant to go (a
 * block near the start or end of the chat), only its position gives way: it
 * sits as close to that place as the page allows, at the very top or bottom
 * of the conversation, still showing the same lines.
 *
 * The browser's own scroll anchoring is held off for the frames around a
 * toggle, so it cannot add a correction of its own on top of this one.
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

/** Toggles whose frames are still settling; anchoring returns when none are. */
let anchoringHolds = 0;

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
  delete pre.dataset.openedAt;
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

/* ------------------------------------------------------------------ *
 * Toggling
 * ------------------------------------------------------------------ */

/** The transcript a block scrolls with, or null outside it. */
function scrollerOf(pre) {
  return pre.closest('#chat-container');
}

/** Where the top of the block's code is on screen. */
function originOf(pre) {
  return pre.getBoundingClientRect().top - pre.scrollTop;
}

/** The part of the screen the transcript shows, as viewport coordinates. */
function visibleArea(scroller) {
  if (!scroller) return { top: 0, bottom: window.innerHeight };
  const top = scroller.getBoundingClientRect().top + scroller.clientTop;
  return { top, bottom: top + scroller.clientHeight };
}

/**
 * Keep the browser's scroll anchoring off until the frames after a toggle
 * have been laid out: it would otherwise apply a correction of its own after
 * this one, and the code would drift by a few pixels.
 */
function holdScrollAnchoring(scroller) {
  if (!scroller) return;
  anchoringHolds++;
  scroller.style.overflowAnchor = 'none';
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      anchoringHolds = Math.max(0, anchoringHolds - 1);
      if (!anchoringHolds) scroller.style.overflowAnchor = '';
    }),
  );
}

function expand(pre, scroller) {
  const before = originOf(pre);
  pre.dataset.openedAt = String(pre.scrollTop);
  pre.classList.remove('collapsed');
  pre.scrollTop = 0;
  if (scroller) scroller.scrollTop += originOf(pre) - before;
}

/** Where a preview `height` tall would sit centred on a click, kept on screen where it fits. */
function windowTopAround(clientY, height, view) {
  const top = clientY - height / 2;
  if (height > view.bottom - view.top) return top;
  return Math.min(Math.max(top, view.top), view.bottom - height);
}

/**
 * Which lines the preview shows (`scroll`) and where on screen its top should
 * land (`top`). With the code's origin kept still, a preview scrolled by `s`
 * lands at `before + s`, so each choice of lines comes with its own place.
 */
function intendedPlacement({ before, clientY, height, view, original, hasOpened, clamp }) {
  if (!Number.isFinite(clientY)) {
    return { scroll: original, top: before + original };
  }

  const originalTop = before + original;
  if (hasOpened && clientY >= originalTop && clientY < originalTop + height) {
    return { scroll: original, top: originalTop };
  }

  const scroll = clamp(windowTopAround(clientY, height, view) - before);
  return { scroll, top: before + scroll };
}

function collapse(pre, scroller, clientY) {
  // Expanded, the block does not scroll, so its origin is its top.
  const before = originOf(pre);
  const view = visibleArea(scroller);
  const opened = Number.parseFloat(pre.dataset.openedAt);
  const hasOpened = Number.isFinite(opened);

  pre.classList.add('collapsed');
  const height = pre.offsetHeight;
  const max = Math.max(0, pre.scrollHeight - pre.clientHeight);
  const clamp = (scroll) => Math.min(max, Math.max(0, scroll));

  // Where it was opened; for a block never opened from a preview, the lines
  // at the top of the visible area.
  const original = clamp(hasOpened ? opened : view.top - before);
  const intended = intendedPlacement({
    before,
    clientY,
    height,
    view,
    original,
    hasOpened,
    clamp,
  });

  // The lines are kept whatever happens to the position.
  pre.scrollTop = intended.scroll;
  if (!scroller) return;

  // Where the block is now that it has shrunk, with the transcript not yet
  // moved (the browser may already have pulled it back from the bottom), and
  // the transcript scroll that puts the preview's top where it is meant to be.
  // Past either end of the conversation, the preview stops at that end.
  const limit = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const needed = scroller.scrollTop + (pre.getBoundingClientRect().top - intended.top);
  scroller.scrollTop = Math.min(limit, Math.max(0, needed));
}

/**
 * Open or close a block, keeping its code still on screen. `clientY` is where
 * the click landed, which decides where a collapsing block's preview goes.
 */
export function toggleCodeBlock(pre, { clientY = null } = {}) {
  const scroller = scrollerOf(pre);
  holdScrollAnchoring(scroller);

  if (pre.classList.contains('collapsed')) expand(pre, scroller);
  else collapse(pre, scroller, clientY);

  syncCodeOverlay(pre);
}

/* ------------------------------------------------------------------ *
 * Telling a click from a scroll
 * ------------------------------------------------------------------ */

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
 * code text: whether it is collapsed, where it is scrolled, and where it was
 * opened. Taken before a row is rebuilt (entering or leaving an edit, say),
 * so the rebuilt row looks and behaves exactly as the old one did.
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
      openedAt: pre.dataset.openedAt ?? null,
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
    if (entry.openedAt !== null && entry.openedAt !== undefined) {
      pre.dataset.openedAt = entry.openedAt;
    } else {
      delete pre.dataset.openedAt;
    }
    pre.scrollTop = entry.collapsed ? entry.scrollTop : 0;
    pre.scrollLeft = entry.scrollLeft || 0;
    syncCodeOverlay(pre);
  }
}
