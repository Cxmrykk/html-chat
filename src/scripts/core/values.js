/** Setting inheritance, coercion, and fallback resolution. */

export function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

/** First non-blank value, or undefined. */
export function pick(...values) {
  for (const value of values) {
    if (!isBlank(value)) return value;
  }
  return undefined;
}

/**
 * First value that parses as a finite number, else `fallback`.
 * Accepts numbers and numeric strings.
 */
export function pickNumber(fallback, ...values) {
  for (const value of values) {
    if (isBlank(value)) continue;
    const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function pickInteger(fallback, ...values) {
  const parsed = pickNumber(NaN, ...values);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

/**
 * Normalise a raw editor string for storage according to a schema entry type.
 * Numeric fields store "" (meaning "inherit") when blank or unparseable.
 */
export function coerceForStorage(rawValue, type) {
  if (type === 'number') {
    if (isBlank(rawValue)) return '';
    const parsed = Number.parseFloat(rawValue);
    return Number.isNaN(parsed) ? '' : parsed;
  }
  return rawValue;
}
