/** Presentation-layer formatting helpers. Pure string/number transforms. */

export function escapeHTML(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Formats a duration in seconds into a human-readable string (hours, minutes, seconds). */
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return '...';
  }
  const total = Math.max(0, seconds);
  if (total >= 3600) {
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    return `${hours}h ${minutes}m ${Math.round(total % 60)}s`;
  }
  if (total >= 60) {
    return `${Math.floor(total / 60)}m ${Math.round(total % 60)}s`;
  }
  return `${Math.round(total)}s`;
}

/**
 * A running or finished wait, e.g. "2.4s" or "1m 5s". Tenths of a second
 * under ten seconds, so a short wait reads as more than "0s"; whole seconds
 * above that. Always rounded down, so a live counter never runs ahead of the
 * clock and then appears to jump back when the final value lands.
 */
export function formatElapsed(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return '...';
  }
  const total = Math.max(0, seconds);
  if (total < 10) return `${(Math.floor(total * 10) / 10).toFixed(1)}s`;
  return formatDuration(Math.floor(total));
}

const COUNT_UNITS = ['', 'k', 'M', 'B', 'T'];

/**
 * A count in as few characters as it reads well in: the number itself below
 * 1000, then thousands, millions and so on, with one decimal below 100 of a
 * unit (dropped when it is 0) and none from 100 up. A value that rounds up
 * to the next unit is written in it: 999,600 is "1M", not "1000k".
 *
 *   999 -> "999", 1000 -> "1k", 1050 -> "1.1k", 12345 -> "12.3k",
 *   123456 -> "123k", 1234567 -> "1.2M", 250000000 -> "250M"
 */
export function formatShortCount(value) {
  const count = Math.max(0, Number(value) || 0);
  if (count < 1000) return String(Math.round(count));

  let unit = 0;
  let scaled = count;
  while (scaled >= 1000 && unit < COUNT_UNITS.length - 1) {
    scaled /= 1000;
    unit++;
  }

  for (;;) {
    const tenths = Math.round(scaled * 10) / 10;
    if (tenths < 100) return `${tenths.toFixed(1).replace(/\.0$/, '')}${COUNT_UNITS[unit]}`;
    const whole = Math.round(scaled);
    if (whole >= 1000 && unit < COUNT_UNITS.length - 1) {
      scaled = whole / 1000;
      unit++;
      continue;
    }
    return `${whole}${COUNT_UNITS[unit]}`;
  }
}

/** Compact count, e.g. 1500 -> "1.5k" (see `formatShortCount`). Returns null below 1000. */
export function formatCompactCount(value) {
  if (value < 1000) return null;
  return formatShortCount(value);
}

export function truncate(text, limit) {
  const value = text || '';
  return value.length > limit ? `${value.substring(0, limit)}...` : value;
}
