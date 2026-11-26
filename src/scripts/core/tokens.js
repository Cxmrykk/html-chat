/**
 * Token estimation. Deliberately crude: four characters per token, which is
 * close enough for budgeting and needs no tokenizer dependency.
 */

export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text) {
  return Math.ceil((text || '').length / CHARS_PER_TOKEN);
}
