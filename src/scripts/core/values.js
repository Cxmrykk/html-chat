/** Setting inheritance, coercion, and fallback resolution. */

const TRUE_WORDS = ['true', 'yes', 'on', '1'];
const FALSE_WORDS = ['false', 'no', 'off', '0'];

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
 * A boolean from a boolean, 0 or 1, or a word such as "true" or "off".
 * Undefined for anything else, so a typo is never read as a choice.
 */
export function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value !== 'string') return undefined;
  const word = value.trim().toLowerCase();
  if (TRUE_WORDS.includes(word)) return true;
  if (FALSE_WORDS.includes(word)) return false;
  return undefined;
}

/** First value that reads as a boolean, else `fallback`. */
export function pickBoolean(fallback, ...values) {
  for (const value of values) {
    if (isBlank(value)) continue;
    const parsed = parseBoolean(value);
    if (parsed !== undefined) return parsed;
  }
  return fallback;
}

/**
 * Normalise a raw editor string for storage according to a schema entry type.
 * Numeric and boolean fields store "" (meaning "inherit") when blank or
 * unparseable.
 */
export function coerceForStorage(rawValue, type) {
  if (type === 'number') {
    if (isBlank(rawValue)) return '';
    const parsed = Number.parseFloat(rawValue);
    return Number.isNaN(parsed) ? '' : parsed;
  }
  if (type === 'boolean') {
    if (isBlank(rawValue)) return '';
    const parsed = parseBoolean(rawValue);
    return parsed === undefined ? '' : parsed;
  }
  return rawValue;
}
