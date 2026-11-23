/**
 * Single-line labels that scroll, one character at a time, when they do not
 * fit their box.
 *
 * A label that fits is shown as it is and costs nothing. One that does not is
 * cut to the available width and ended with an ellipsis; every `STEP_MS` the
 * start moves one character on, until the rest of the text fits, then it
 * pauses for `END_PAUSE_MS` and starts again from the beginning.
 *
 * Text is measured on a canvas with the element's own font rather than read
 * back from layout, and the ellipsis is written into the text itself, because
 * a native `<select>` does not reliably honour `text-overflow`. Whatever is
 * measured against must therefore never be sized by the text written into it,
 * or a shorter label would shrink its own box and collapse: a select is given
 * an explicit width from its full option labels, and a text element must be
 * stretched by its container (see `.marquee-label` in `styles/layout.css`).
 *
 * A ResizeObserver re-measures whenever an element changes size, which also
 * covers it being hidden (nothing is animated at zero width) and shown again.
 * With `prefers-reduced-motion`, labels are truncated but never move.
 */

const STEP_MS = 250;
const END_PAUSE_MS = 1500;
const ELLIPSIS = '…';
/** Canvas and layout measurements can disagree by a fraction of a pixel. */
const SAFETY_PX = 1;
/** Room a native select keeps for its dropdown arrow, beyond its padding. */
const SELECT_ARROW_PX = 28;

/** element -> { element, full, chars, offset, atEnd, paused, timer, write, available } */
const entries = new Map();
const wiredSelects = new WeakSet();
let context = null;
let observer = null;

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function px(value) {
  return Number.parseFloat(value) || 0;
}

function fontOf(element) {
  const style = getComputedStyle(element);
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

function measure(text, font) {
  if (!context) context = document.createElement('canvas').getContext('2d');
  context.font = font;
  return context.measureText(text).width;
}

/**
 * The text from character `offset` on, cut to `width` with an ellipsis if it
 * does not fit. `end` is true when the rest of the text fits whole.
 */
function fitFrom(chars, offset, width, font) {
  const rest = chars.slice(offset).join('');
  if (measure(rest, font) <= width) return { text: rest, end: true };

  // The most characters that still fit alongside the ellipsis.
  let low = 0;
  let high = chars.length - offset;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    const candidate = chars.slice(offset, offset + mid).join('').trimEnd() + ELLIPSIS;
    if (measure(candidate, font) <= width) low = mid;
    else high = mid - 1;
  }
  return { text: chars.slice(offset, offset + low).join('').trimEnd() + ELLIPSIS, end: false };
}

function stop(entry) {
  clearTimeout(entry.timer);
  entry.timer = null;
}

function forget(entry) {
  stop(entry);
  entries.delete(entry.element);
  observer?.unobserve(entry.element);
}

function schedule(entry, delay) {
  stop(entry);
  entry.timer = setTimeout(() => advance(entry), delay);
}

function advance(entry) {
  entry.timer = null;
  if (!entry.element.isConnected) {
    forget(entry);
    return;
  }
  if (entry.paused) return;
  entry.offset = entry.atEnd ? 0 : entry.offset + 1;
  render(entry);
}

function render(entry) {
  stop(entry);
  const width = entry.available() - SAFETY_PX;
  const font = fontOf(entry.element);

  // Hidden, paused, or simply fits: the whole text, standing still.
  if (entry.paused || width <= 0 || measure(entry.full, font) <= width) {
    entry.offset = 0;
    entry.atEnd = false;
    entry.write(entry.full);
    return;
  }

  const still = reducedMotion();
  if (still) entry.offset = 0;

  const { text, end } = fitFrom(entry.chars, entry.offset, width, font);
  entry.write(text);
  entry.atEnd = end;
  if (!still) schedule(entry, end ? END_PAUSE_MS : STEP_MS);
}

function observe(element) {
  if (typeof ResizeObserver === 'undefined') return;
  if (!observer) {
    observer = new ResizeObserver((records) => {
      for (const record of records) {
        const entry = entries.get(record.target);
        if (entry) render(entry);
      }
    });
  }
  observer.observe(element);
}

/**
 * Start (or update) tracking an element. The same text keeps its scroll
 * position, so re-rendering an unchanged label does not restart it.
 */
function track(element, full, write, available) {
  let entry = entries.get(element);
  if (!entry) {
    entry = {
      element,
      full: null,
      chars: [],
      offset: 0,
      atEnd: false,
      paused: false,
      timer: null,
    };
    entries.set(element, entry);
    observe(element);
  }

  entry.write = write;
  entry.available = available;
  if (entry.full !== full) {
    entry.full = full;
    entry.chars = Array.from(full);
    entry.offset = 0;
    entry.atEnd = false;
  }

  render(entry);
  return entry;
}

/* ------------------------------------------------------------------ *
 * Text elements
 * ------------------------------------------------------------------ */

/**
 * Show `text` in `element` on one line, scrolling it if it does not fit. The
 * element's width must come from its container, not from its text.
 */
export function setMarqueeText(element, text) {
  if (!element) return;
  const full = String(text ?? '');
  track(
    element,
    full,
    (value) => {
      if (element.textContent !== value) element.textContent = value;
    },
    () => {
      const style = getComputedStyle(element);
      return element.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
    },
  );
}

/* ------------------------------------------------------------------ *
 * Native selects
 * ------------------------------------------------------------------ */

/**
 * Width from the full labels, never from the text currently written into the
 * selected option. CSS may still cap or shrink it.
 */
function sizeSelect(select, options) {
  const style = getComputedStyle(select);
  const font = fontOf(select);
  const widest = options.reduce((max, option) => Math.max(max, measure(option.dataset.label, font)), 0);
  const chrome =
    px(style.paddingLeft) +
    px(style.paddingRight) +
    px(style.borderLeftWidth) +
    px(style.borderRightWidth) +
    SELECT_ARROW_PX +
    SAFETY_PX * 2;
  const width = `${Math.ceil(widest + chrome)}px`;
  if (select.style.width !== width) select.style.width = width;
}

function setPaused(element, paused) {
  const entry = entries.get(element);
  if (!entry || entry.paused === paused) return;
  entry.paused = paused;
  entry.offset = 0;
  render(entry);
}

/**
 * While the dropdown may be open, the selected option shows its full name, so
 * the list never offers a truncated entry. Scrolling resumes once a choice is
 * made or focus leaves.
 */
function wireSelect(select) {
  if (wiredSelects.has(select)) return;
  wiredSelects.add(select);

  select.addEventListener('focus', () => setPaused(select, true));
  // A second click on a select that already has focus opens it again.
  select.addEventListener('pointerdown', () => {
    if (document.activeElement === select) setPaused(select, true);
  });
  select.addEventListener('blur', () => setPaused(select, false));
  select.addEventListener('change', () => {
    const entry = entries.get(select);
    if (entry) entry.paused = false;
    // A different option is selected now: restore the old one, scroll the new.
    syncSelectMarquee(select);
  });
}

/**
 * Bring a select's marquee up to date. Call it after its options or its value
 * change. Each option's full label is kept in `data-label`; only the selected
 * one is ever shortened.
 */
export function syncSelectMarquee(select) {
  if (!select) return;
  wireSelect(select);

  const options = [...select.options];
  for (const option of options) {
    if (option.dataset.label === undefined) option.dataset.label = option.textContent;
  }

  const selected = select.options[select.selectedIndex] || null;
  for (const option of options) {
    if (option !== selected && option.textContent !== option.dataset.label) {
      option.textContent = option.dataset.label;
    }
  }

  sizeSelect(select, options);

  track(
    select,
    selected?.dataset.label ?? '',
    (value) => {
      const current = select.options[select.selectedIndex];
      if (current && current.textContent !== value) current.textContent = value;
    },
    () => {
      const style = getComputedStyle(select);
      return select.clientWidth - px(style.paddingLeft) - px(style.paddingRight) - SELECT_ARROW_PX;
    },
  );
}
