import { estimateTokensOf } from './tokens.js';

/**
 * Embedding progress computation.
 *
 * A unit counts as "processed" if it has a vector OR is unembeddable, so a
 * file containing oversized units can still reach 100%.
 */
export function computeProgress({ chunkCount, embeddedCount, ignoredCount = 0 }) {
  const processed = embeddedCount + ignoredCount;
  const exact = chunkCount > 0 ? (processed / chunkCount) * 100 : 0;
  return {
    processed,
    exactProgress: exact,
    progress: Math.round(exact),
    complete: chunkCount > 0 && processed >= chunkCount,
  };
}

/** True when a unit can never be embedded: it alone exceeds one request's token limit. */
export function isUnembeddable(unit, { batchMaxTokens }) {
  return estimateTokensOf(unit.text) > batchMaxTokens;
}

/** Estimated seconds remaining, or null when there is nothing to base it on. */
export function computeEta({ chunkCount, processed, chunksPerSecond }) {
  if (!chunksPerSecond || chunksPerSecond <= 0) return null;
  const remaining = Math.max(0, chunkCount - processed);
  return remaining / chunksPerSecond;
}
