import { $ } from '../dom.js';
import { state, currentChat } from '../../store/state.js';

/**
 * The dotted outline around the part of a message being edited.
 *
 * It is an overlay positioned over the selected blocks, not a border on them:
 * a border would take up space, and picking a selection must not move a single
 * pixel of the transcript. It lives inside the message row, which is already
 * `position: relative`, so it scrolls with it; a ResizeObserver re-measures it
 * whenever the row changes size (a window resize, KaTeX finishing, a font
 * loading).
 *
 * Any render that touches the edited row calls `syncEditSelection` afterwards;
 * it is idempotent and cheap.
 */

const OUTSET_PX = 4;

let observer = null;
let observed = null;

function watch(element) {
  if (observed === element) return;
  observer?.disconnect();
  observed = element;
  if (!element || typeof ResizeObserver === 'undefined') return;
  if (!observer) observer = new ResizeObserver(() => syncEditSelection());
  observer.observe(element);
}

function removeOverlays(container, keep = null) {
  for (const overlay of container.querySelectorAll('.edit-selection')) {
    if (overlay !== keep) overlay.remove();
  }
}

/**
 * The row, its content node and the range to outline, or null when nothing
 * should be outlined: no edit, no range picked yet, another view up, or a
 * message that has changed since the range was picked (its blocks may no
 * longer be the ones the range meant).
 */
function findTarget(container) {
  const { view, editingMessageIndex: index, editingRange: range, editingSource: source } =
    state.session;
  if (view !== 'chat' || index === null || !range) return null;

  const message = currentChat()?.messages[index];
  if (!message || (message.content || '') !== source) return null;

  const element = container.querySelector(`.msg[data-index="${index}"]`);
  const content = element?.querySelector(':scope > .msg-content');
  return element && content ? { element, content, range } : null;
}

/** Viewport top and bottom of the selected blocks, or null if they are not rendered. */
function selectedSpan(content, range) {
  const blocks = [...content.children].filter((child) => child.classList.contains('md-block'));

  // A message with no blocks is edited whole.
  if (!blocks.length) {
    const box = content.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom };
  }

  const first = blocks[range.start];
  const last = blocks[range.end];
  if (!first || !last) return null;
  return {
    top: first.getBoundingClientRect().top,
    bottom: last.getBoundingClientRect().bottom,
  };
}

export function syncEditSelection() {
  const container = $('#chat-container');
  if (!container) return;

  const target = findTarget(container);
  if (!target) {
    removeOverlays(container);
    watch(null);
    return;
  }

  const { element, content, range } = target;
  let overlay = element.querySelector(':scope > .edit-selection');
  removeOverlays(container, overlay);

  const span = selectedSpan(content, range);
  if (!span) {
    overlay?.remove();
    watch(null);
    return;
  }

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'edit-selection';
    overlay.setAttribute('aria-hidden', 'true');
    element.appendChild(overlay);
  }

  // Absolute offsets are measured from the padding edge, inside the row's
  // thick left border.
  const row = element.getBoundingClientRect();
  const box = content.getBoundingClientRect();
  const originX = row.left + element.clientLeft;
  const originY = row.top + element.clientTop;

  overlay.style.left = `${box.left - originX - OUTSET_PX}px`;
  overlay.style.top = `${span.top - originY - OUTSET_PX}px`;
  overlay.style.width = `${box.width + OUTSET_PX * 2}px`;
  overlay.style.height = `${span.bottom - span.top + OUTSET_PX * 2}px`;

  watch(element);
}
