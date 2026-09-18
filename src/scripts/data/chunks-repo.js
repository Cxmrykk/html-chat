import * as idb from './idb.js';
import { KEYS } from './keys.js';
import { cosineSimilarity } from '../core/vector.js';
import { estimateTokensOf } from '../core/tokens.js';

/** Chunk records: one IndexedDB entry per chunk, keyed by zero-padded index. */

export async function listChunks(fileId) {
  const chunks = await idb.getByPrefix(KEYS.chunkPrefix(fileId));
  return chunks.sort((a, b) => a.index - b.index);
}

export function replaceChunks(fileId, chunks) {
  return idb
    .removeByPrefix(KEYS.chunkPrefix(fileId))
    .then(() => idb.setMany(chunks.map((chunk) => [KEYS.chunk(fileId, chunk.index), chunk])));
}

export function putChunks(fileId, chunks) {
  return idb.setMany(chunks.map((chunk) => [KEYS.chunk(fileId, chunk.index), chunk]));
}

export function deleteChunks(fileId) {
  return idb.removeByPrefix(KEYS.chunkPrefix(fileId));
}

/**
 * Collect the next batch of chunks to embed while counting the whole set in a
 * single cursor pass, so the caller gets batch + totals without a second scan.
 */
export async function nextEmbeddingBatch(fileId, { maxBatch, maxTokens, chunkLimit }) {
  const batch = [];
  let batchTokens = 0;
  let ignoredCount = 0;
  let embeddedCount = 0;
  let chunkCount = 0;

  await idb.scanByPrefix(KEYS.chunkPrefix(fileId), (chunk) => {
    chunkCount++;
    if (chunk.vector) {
      embeddedCount++;
      return true;
    }
    const tokens = estimateTokensOf(chunk.text);
    if (tokens > chunkLimit || tokens > maxTokens) {
      ignoredCount++;
      return true;
    }
    if (batch.length < maxBatch && batchTokens + tokens <= maxTokens) {
      batch.push(chunk);
      batchTokens += tokens;
    }
    return true;
  });

  return { batch, ignoredCount, embeddedCount, chunkCount };
}

/**
 * Score a file's embedded chunks against a query vector and keep the best
 * `limit` of those at or above `threshold`.
 *
 * Vectors are compared during the cursor walk and then dropped, and the
 * survivors are trimmed back to `limit` whenever they reach twice that, so
 * neither the embeddings nor the text of a large file is ever resident all at
 * once — only the lightweight `{ fileId, index, score, text, raw }` records of
 * the current leaders.
 *
 * `vectorCount` is how many chunks were searchable at all; zero means the file
 * has not been indexed.
 */
export async function scoreChunks(fileId, queryVector, { threshold = 0, limit = Infinity } = {}) {
  let scored = [];
  let vectorCount = 0;

  const trim = () => {
    scored.sort((a, b) => b.score - a.score);
    if (scored.length > limit) scored.length = limit;
  };

  await idb.scanByPrefix(KEYS.chunkPrefix(fileId), (chunk) => {
    if (!chunk.vector) return true;
    vectorCount++;

    const score = cosineSimilarity(queryVector, chunk.vector);
    if (score < threshold) return true;

    scored.push({
      fileId,
      index: chunk.index,
      score,
      text: chunk.text,
      raw: chunk.raw !== undefined ? chunk.raw : chunk.text,
    });
    if (scored.length >= limit * 2) trim();
    return true;
  });

  trim();
  return { scored, vectorCount };
}
