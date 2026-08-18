/**
 * Token estimation. Deliberately crude: four characters per token, which is
 * close enough for budgeting and needs no tokenizer dependency.
 */

const CHARS_PER_TOKEN = 4;

/** Stringify a chunk value the same way everywhere. */
export function textOf(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value) || '';
  } catch {
    return String(value);
  }
}

export function estimateTokens(text) {
  return Math.ceil((text || '').length / CHARS_PER_TOKEN);
}

export function estimateTokensOf(value) {
  return estimateTokens(textOf(value));
}
