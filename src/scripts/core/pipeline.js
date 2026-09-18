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
 * Post-retrieval assembly across any number of files:
 * retrieve -> dedupe -> budget -> reorder -> merge.
 *
 * `scored` is one best-first list of `{ fileId, index, text, raw }` drawn from
 * every file searched, so the files compete for a single `maxTokens` budget on
 * relevance alone. `sources` maps each `fileId` to `{ fileText, hooks,
 * maxTokens }`: a candidate is processed by its own file's hooks, deduplicated
 * against its own file's selections, and counted against that file's cap.
 *
 * Returns `[{ fileId, content }]`, best-matching file first, each file's
 * chunks restored to document order and merged.
 *
 * Hooks are user-supplied and therefore all failures are contained: a failing
 * retrieval falls back to the raw chunk, a failing dedupe treats the chunk as
 * unique, a failing merge falls back to joining with an ellipsis.
 */
export async function assembleChunks({ scored, sources, maxTokens, onError }) {
  const groups = new Map();
  let usedTokens = 0;
  let admitted = 0;

  for (let i = 0; i < scored.length; i++) {
    const candidate = scored[i];
    const source = sources.get(candidate.fileId);
    if (!source) continue;

    const rawChunk = candidate.raw !== undefined ? candidate.raw : candidate.text;

    let data;
    try {
      data = await source.hooks.retrieve(rawChunk, source.fileText);
    } catch (error) {
      onError?.('retrievalFunc', error);
      data = rawChunk;
    }
    if (data === null || data === undefined) continue;

    const group = groups.get(candidate.fileId) || { selected: [], tokens: 0 };

    let duplicate = false;
    try {
      for (const entry of group.selected) {
        if (await source.hooks.isDuplicate(data, entry.data)) {
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
    if (admitted > 0 && usedTokens + tokens > maxTokens) break;
    // A file at its own cap steps aside; the others may still have room.
    if (group.selected.length > 0 && group.tokens + tokens > source.maxTokens) continue;

    usedTokens += tokens;
    admitted++;
    group.tokens += tokens;
    group.selected.push({ index: candidate.index, data });
    // Map order is first-admission order: the best-matching file leads.
    groups.set(candidate.fileId, group);

    if (i % 50 === 0) await yieldToEventLoop();
  }

  const sections = [];
  for (const [fileId, group] of groups) {
    // Restore document order before merging.
    group.selected.sort((a, b) => a.index - b.index);
    const finalChunks = group.selected.map((entry) => entry.data);

    let content;
    try {
      content = await sources.get(fileId).hooks.merge(finalChunks);
    } catch (error) {
      onError?.('mergeChunksFunc', error);
      content = finalChunks.map(textOf).join('...');
    }
    sections.push({ fileId, content });
  }
  return sections;
}
