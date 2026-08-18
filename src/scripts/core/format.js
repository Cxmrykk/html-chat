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

/** Compact count, e.g. 1500 -> "1.5k". Returns null below 1000. */
export function formatCompactCount(value) {
  if (value < 1000) return null;
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
}

/** Chunks-per-second, or an ellipsis while the first batch is in flight. */
export function formatSpeed(chunksPerSecond) {
  if (!chunksPerSecond || !Number.isFinite(chunksPerSecond)) return '...';
  return `${chunksPerSecond.toFixed(1)} c/s`;
}

export function truncate(text, limit) {
  const value = text || '';
  return value.length > limit ? `${value.substring(0, limit)}...` : value;
}
