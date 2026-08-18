import { EVENTS } from '../store/events.js';
import {
  state,
  emit,
  findFile,
  persistFiles,
  embeddingsEnabled,
  reportHookError,
} from '../store/state.js';
import * as chunksRepo from '../data/chunks-repo.js';
import * as filesRepo from '../data/files-repo.js';
import { fetchEmbeddings } from './api/embeddings.js';
import { chunkerHook } from './user-hooks.js';
import { buildChunks, reconcileChunks, countUnembeddable } from '../core/pipeline.js';
import { computeProgress, computeEta } from '../core/progress.js';
import { pickInteger } from '../core/values.js';
import { GLOBAL_SETTINGS } from '../core/settings-schema.js';

/** Chunking and background embedding loop orchestration. */

function limitsFor(meta, config) {
  return {
    chunkLimit: pickInteger(
      1024,
      meta?.chunkMaxTokens,
      config.chunkMaxTokens,
      GLOBAL_SETTINGS.chunkMaxTokens.default,
    ),
    batchMaxTokens: pickInteger(
      8192,
      config.chunkBatchMaxTokens,
      GLOBAL_SETTINGS.chunkBatchMaxTokens.default,
    ),
    batchSize: pickInteger(100, config.chunkBatchSize, GLOBAL_SETTINGS.chunkBatchSize.default),
  };
}

function applyProgress(meta, { chunkCount, embeddedCount, ignoredCount }) {
  const { exactProgress, progress, processed } = computeProgress({
    chunkCount,
    embeddedCount,
    ignoredCount,
  });
  meta.chunkCount = chunkCount;
  meta.embeddedCount = embeddedCount;
  meta.exactProgress = exactProgress;
  meta.progress = progress;
  return processed;
}

/**
 * Rebuild a file's chunk set, preserving vectors for chunks whose text is
 * unchanged. Writes nothing when the chunk set is identical.
 */
export async function refreshFileChunks(fileId) {
  const meta = findFile(fileId);
  if (!meta) return;

  const data = await filesRepo.loadFileData(fileId);
  if (!data) return;

  const rawChunks = await buildChunks({
    fileText: data.text || '',
    customChunks: meta.customChunks,
    chunkerFn: chunkerHook(meta),
    config: state.data.config,
    onError: reportHookError,
  });

  const previous = await chunksRepo.listChunks(fileId);
  const { chunks, changed } = await reconcileChunks(rawChunks, previous);
  if (!changed) return;

  await chunksRepo.replaceChunks(fileId, chunks);

  const limits = limitsFor(meta, state.data.config);
  const ignoredCount = await countUnembeddable(chunks, limits);
  const embeddedCount = chunks.filter((chunk) => chunk.vector).length;

  applyProgress(meta, { chunkCount: chunks.length, embeddedCount, ignoredCount });
  if (meta.progress >= 100) stopEmbedding(fileId);

  await persistFiles();
  emit(EVENTS.FILE_PROGRESS, { id: fileId });
}

/** One pass of the embedding loop for a single file. */
async function runEmbeddingLoop(fileId, signal) {
  const config = state.data.config;
  const meta = findFile(fileId);
  if (!meta) return;

  const { chunkLimit, batchMaxTokens, batchSize } = limitsFor(meta, config);

  const startedAt = Date.now();
  let baselineEmbedded = null;

  try {
    while (!signal.aborted) {
      const current = findFile(fileId);
      if (!current) break;

      let stats = await chunksRepo.nextEmbeddingBatch(fileId, {
        maxBatch: batchSize,
        maxTokens: batchMaxTokens,
        chunkLimit,
      });

      // No chunk records at all: build them, then look again.
      if (stats.chunkCount === 0) {
        await refreshFileChunks(fileId);
        if (signal.aborted) break;
        stats = await chunksRepo.nextEmbeddingBatch(fileId, {
          maxBatch: batchSize,
          maxTokens: batchMaxTokens,
          chunkLimit,
        });
      }

      // Nothing left that can be embedded.
      if (stats.batch.length === 0) {
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

      stats.batch.forEach((chunk, i) => {
        chunk.vector = new Float32Array(vectors[i]);
      });
      await chunksRepo.putChunks(fileId, stats.batch);

      const embeddedCount = stats.embeddedCount + stats.batch.length;
      const processed = applyProgress(current, {
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
 * loop is already running.
 */
export function startEmbedding(fileId) {
  if (!embeddingsEnabled()) return Promise.resolve();

  const existing = state.runtime.embedding.get(fileId);
  if (existing) return existing.promise;

  const controller = new AbortController();
  const entry = { controller, promise: null };
  state.runtime.embedding.set(fileId, entry);

  const meta = findFile(fileId);
  if (meta) meta.isEmbedding = true;

  entry.promise = runEmbeddingLoop(fileId, controller.signal).finally(() => {
    state.runtime.embedding.delete(fileId);
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

export async function toggleEmbedding(fileId) {
  if (state.runtime.embedding.has(fileId)) {
    stopEmbedding(fileId);
    return;
  }
  await startEmbedding(fileId);
}

/** Wipe every vector — used when the embeddings model changes. */
export async function resetAllEmbeddings() {
  for (const meta of state.data.files) {
    stopEmbedding(meta.id);
    meta.progress = 0;
    meta.exactProgress = 0;
    meta.embeddedCount = 0;
    meta.chunkCount = 0;
    meta.isEmbedding = false;
    meta.embeddingSpeed = null;
    meta.embeddingEta = null;
    await chunksRepo.deleteChunks(meta.id);
  }
  await persistFiles();
  emit(EVENTS.FILES);
}

/** Regenerate `customChunks` from the chunker. Throws so callers can report. */
export async function generateCustomChunks(fileId) {
  const meta = findFile(fileId);
  const data = await filesRepo.loadFileData(fileId);
  if (!meta || !data) return;

  const chunker = chunkerHook(meta);
  const result = await chunker(data.text || '', state.data.config);
  const chunks = Array.isArray(result)
    ? result.filter((chunk) => chunk !== null && chunk !== undefined)
    : [];

  meta.customChunks = JSON.stringify(chunks, null, 2);
  await persistFiles();
  await refreshFileChunks(fileId);
}
