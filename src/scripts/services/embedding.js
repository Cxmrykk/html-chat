import { EVENTS } from '../store/events.js';
import { state, emit, findFile, profileOf, persistFiles, embeddingsEnabled } from '../store/state.js';
import * as chunksRepo from '../data/chunks-repo.js';
import { fetchEmbeddings } from './api/embeddings.js';
import { computeProgress, computeEta } from '../core/progress.js';
import { pickInteger } from '../core/values.js';
import { GLOBAL_SETTINGS } from '../core/settings-schema.js';

/**
 * The background loop that embeds a file's units, one batch at a time. What
 * the units are is `services/indexing.js`; this only fills in their vectors.
 */

export function embeddingLimits(config) {
  return {
    batchMaxTokens: pickInteger(
      8192,
      config.chunkBatchMaxTokens,
      GLOBAL_SETTINGS.chunkBatchMaxTokens.default,
    ),
    batchSize: Math.max(
      1,
      pickInteger(100, config.chunkBatchSize, GLOBAL_SETTINGS.chunkBatchSize.default),
    ),
  };
}

/** Write progress counters onto a file's metadata. Returns the computed progress. */
export function applyProgress(meta, { chunkCount, embeddedCount, ignoredCount = 0 }) {
  const result = computeProgress({ chunkCount, embeddedCount, ignoredCount });
  meta.chunkCount = chunkCount;
  meta.embeddedCount = embeddedCount;
  meta.exactProgress = result.exactProgress;
  meta.progress = result.progress;
  return result;
}

async function runEmbeddingLoop(fileId, signal) {
  const config = state.data.config;
  const meta = findFile(fileId);
  if (!meta) return;

  const { batchMaxTokens, batchSize } = embeddingLimits(config);
  const startedAt = Date.now();
  let baselineEmbedded = null;

  try {
    while (!signal.aborted) {
      const current = findFile(fileId);
      if (!current) break;

      const stats = await chunksRepo.nextEmbeddingBatch(fileId, {
        maxBatch: batchSize,
        maxTokens: batchMaxTokens,
      });

      // Nothing left that can be embedded.
      if (stats.batch.length === 0) {
        applyProgress(current, stats);
        current.exactProgress = 100;
        current.progress = 100;
        current.embeddingSpeed = null;
        current.embeddingEta = null;
        await persistFiles();
        emit(EVENTS.FILE_PROGRESS, { id: fileId });
        break;
      }

      const vectors = await fetchEmbeddings(
        config,
        stats.batch.map((chunk) => chunk.text),
        signal,
      );
      if (signal.aborted) break;

      stats.batch.forEach((chunk, i) => {
        chunk.vector = new Float32Array(vectors[i] || []);
      });
      await chunksRepo.putChunks(fileId, stats.batch);

      const embeddedCount = stats.embeddedCount + stats.batch.length;
      const { processed } = applyProgress(current, {
        chunkCount: stats.chunkCount,
        embeddedCount,
        ignoredCount: stats.ignoredCount,
      });

      if (baselineEmbedded === null) baselineEmbedded = embeddedCount - stats.batch.length;
      const elapsed = (Date.now() - startedAt) / 1000;
      const done = embeddedCount - baselineEmbedded;
      if (elapsed > 0 && done > 0) {
        current.embeddingSpeed = done / elapsed;
        current.embeddingEta = computeEta({
          chunkCount: current.chunkCount,
          processed,
          chunksPerSecond: current.embeddingSpeed,
        });
      }

      await persistFiles();
      emit(EVENTS.FILE_PROGRESS, { id: fileId });

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('Embedding failed:', error);
      emit(EVENTS.HOOK_ERROR, {
        key: 'embedding',
        error: new Error(`Embedding failed for ${meta.name}: ${error.message}`),
      });
    }
  } finally {
    const final = findFile(fileId);
    if (final) {
      final.embeddingSpeed = null;
      final.embeddingEta = null;
    }
    await persistFiles();
    emit(EVENTS.FILE_PROGRESS, { id: fileId });
  }
}

/**
 * Start embedding a file. Idempotent: returns the in-flight promise if the
 * loop is already running. A no-op without an embeddings model, or when the
 * file's profile does not search by embeddings.
 */
export function startEmbedding(fileId) {
  const meta = findFile(fileId);
  if (!meta || !embeddingsEnabled() || !profileOf(meta)?.methods.embeddings) {
    return Promise.resolve();
  }

  const existing = state.runtime.embedding.get(fileId);
  if (existing) return existing.promise;

  const controller = new AbortController();
  const entry = { controller, promise: null };
  state.runtime.embedding.set(fileId, entry);
  meta.isEmbedding = true;

  entry.promise = runEmbeddingLoop(fileId, controller.signal).finally(() => {
    if (state.runtime.embedding.get(fileId) === entry) state.runtime.embedding.delete(fileId);
    const current = findFile(fileId);
    if (current) current.isEmbedding = false;
    persistFiles();
    emit(EVENTS.FILE_PROGRESS, { id: fileId });
  });

  emit(EVENTS.FILE_PROGRESS, { id: fileId });
  return entry.promise;
}

export function stopEmbedding(fileId) {
  const entry = state.runtime.embedding.get(fileId);
  if (entry) entry.controller.abort();
  const meta = findFile(fileId);
  if (meta) meta.isEmbedding = false;
}

/**
 * Stop embedding a file and wait until the loop has fully exited, so its units
 * can be replaced without a late batch writing stale vectors into them.
 */
export async function stopEmbeddingAndWait(fileId) {
  const entry = state.runtime.embedding.get(fileId);
  stopEmbedding(fileId);
  if (entry) await entry.promise.catch(() => {});
}
