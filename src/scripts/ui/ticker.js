import { $ } from './dom.js';
import { formatElapsed } from '../core/format.js';

/**
 * Live elapsed-time counters. Any element in the transcript carrying
 * `data-started-at` (a timestamp in milliseconds) shows how long ago that was;
 * this keeps its text current while a turn runs.
 *
 * Deliberately outside the store: a tick changes nothing but a few text nodes,
 * so it must not emit, re-render or persist anything. Renders write the first
 * frame themselves, so a counter is correct the moment it appears.
 */

const INTERVAL_MS = 100;
let interval = null;

function tick() {
  const container = $('#chat-container');
  if (!container) return;

  const now = Date.now();
  for (const element of container.querySelectorAll('[data-started-at]')) {
    const startedAt = Number(element.dataset.startedAt);
    if (!Number.isFinite(startedAt)) continue;
    const text = formatElapsed((now - startedAt) / 1000);
    if (element.textContent !== text) element.textContent = text;
  }
}

/** Run the ticker while a turn may be counting, and only then. */
export function syncTicker(active) {
  if (active && interval === null) {
    tick();
    interval = setInterval(tick, INTERVAL_MS);
  } else if (!active && interval !== null) {
    clearInterval(interval);
    interval = null;
  }
}
