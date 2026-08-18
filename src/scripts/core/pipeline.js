import { estimateTokensOf, textOf } from './tokens.js';
import { isUnembeddable } from './progress.js';

/**
 * The chunking and retrieval pipelines as pure functions over injected hooks.
 * No DOM, no store, no persistence — these are the pieces worth testing.
 */

/** Let the event loop breathe during long synchronous scans. */
const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Produce the raw chunk list for a file.
 *
 * `customChunks` (a JSON array) bypasses the chunker entirely. If neither
 * produces anything usable, the whole file becomes one chunk.
 */
export async function buildChunks({ fileText, customChunks, chunkerFn, config, onError }) {
  let chunks = [];

  if (customChunks && customChunks.trim() !== '') {
    try {
      const parsed = JSON.parse(customChunks);
      if (Array.isArray(parsed)) chunks = parsed;
    } catch (error) {
      onError?.('customChunks', error);
    }
  } else if (chunkerFn) {
    try {
      const result = await chunkerFn(fileText, config);
      if (Array.isArray(result)) chunks = result;
    } catch (error) {
      onError?.('customChunker', error);
    }
  }

  chunks = chunks.filter((chunk) => chunk !== null && chunk !== undefined);
  if (chunks.length === 0) chunks = [fileText];
  return chunks;
}

/**
 * Turn raw chunk values into stored chunk records, reusing vectors from
 * previous records whose text is unchanged.
 *
 * Returns `{ chunks, changed }`; when unchanged the caller can skip all writes.
 */
export async function reconcileChunks(rawChunks, previousChunks) {
  const reusable = new Map();
  for (const previous of previousChunks) {
    if (previous.vector && !reusable.has(previous.text)) {
      reusable.set(previous.text, previous);
    }
  }

  const chunks = [];
  let changed = false;

  for (let i = 0; i < rawChunks.length; i++) {
    const raw = rawChunks[i];
    const text = textOf(raw);
    const existing = reusable.get(text);
    if (!existing) changed = true;

    chunks.push({
      index: i,
      text,
      raw,
      vector: existing ? existing.vector : null,
    });

    if (i % 500 === 0) await yieldToEventLoop();
  }

  if (previousChunks.length !== chunks.length) {
    changed = true;
  } else if (previousChunks.some((previous, i) => previous.text !== chunks[i].text)) {
    changed = true;
  }

  return { chunks, changed };
}

/** How many chunks can never be embedded under the current size limits. */
export async function countUnembeddable(chunks, limits) {
  let count = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (!chunks[i].vector && isUnembeddable(chunks[i], limits)) count++;
    if (i % 1000 === 0) await yieldToEventLoop();
  }
  return count;
}

/**
 * Post-retrieval assembly: retrieve -> dedupe -> budget -> reorder -> merge.
 *
 * `scored` must already be sorted best-first. Hooks are user-supplied and
 * therefore all failures are contained: a failing retrieval falls back to the
 * raw chunk, a failing dedupe treats the chunk as unique, a failing merge
 * falls back to joining with an ellipsis.
 */
export async function assembleChunks({ scored, fileText, maxTokens, hooks, onError }) {
  const selected = [];
  let usedTokens = 0;

  for (let i = 0; i < scored.length; i++) {
    const candidate = scored[i];
    const rawChunk = candidate.raw !== undefined ? candidate.raw : candidate.text;

    let data;
    try {
      data = await hooks.retrieve(rawChunk, fileText);
    } catch (error) {
      onError?.('retrievalFunc', error);
      data = rawChunk;
    }
    if (data === null || data === undefined) continue;

    let duplicate = false;
    try {
      for (const entry of selected) {
        if (await hooks.isDuplicate(data, entry.data)) {
          duplicate = true;
          break;
        }
      }
    } catch (error) {
      onError?.('dedupFunc', error);
    }
    if (duplicate) continue;

    const tokens = estimateTokensOf(data);
    // Always admit at least one chunk, even if it alone blows the budget.
    if (selected.length > 0 && usedTokens + tokens > maxTokens) break;
    usedTokens += tokens;
    selected.push({ index: candidate.index, data });

    if (i % 50 === 0) await yieldToEventLoop();
  }

  // Restore document order before merging.
  selected.sort((a, b) => a.index - b.index);
  const finalChunks = selected.map((entry) => entry.data);

  try {
    return await hooks.merge(finalChunks);
  } catch (error) {
    onError?.('mergeChunksFunc', error);
    return finalChunks.map(textOf).join('...');
  }
}
