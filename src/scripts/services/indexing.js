import { EVENTS } from '../store/events.js';
import { state, emit, findFile, profileOf, persistFiles } from '../store/state.js';
import * as filesRepo from '../data/files-repo.js';
import * as chunksRepo from '../data/chunks-repo.js';
import * as sectionsRepo from '../data/sections-repo.js';
import { parseDocument } from './parsing.js';
import { startEmbedding, stopEmbeddingAndWait, embeddingLimits, applyProgress } from './embedding.js';
import { buildUnits, reconcileUnits, countUnembeddable } from '../core/embedding-units.js';
import { createLineIndex } from '../core/sections.js';

/**
 * Keeping a file's index in step with its text and its profile: its sections
 * (always) and its embedding units (when the profile searches by embeddings).
 *
 * Work on one file is serialised, so a search that finds the sections stale
 * and a profile save that re-indexes cannot interleave their writes.
 */

const queues = new Map();

function enqueue(fileId, task) {
  const previous = queues.get(fileId) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  queues.set(fileId, next);
  next
    .finally(() => {
      if (queues.get(fileId) === next) queues.delete(fileId);
    })
    .catch(() => {});
  return next;
}

function resetEmbeddingFields(meta) {
  Object.assign(meta, {
    chunkCount: 0,
    embeddedCount: 0,
    progress: 0,
    exactProgress: 0,
    isEmbedding: false,
    embeddingSpeed: null,
    embeddingEta: null,
  });
}

/** A file whose profile does not embed, or that has nothing to embed, is ready. */
function markNothingToEmbed(meta) {
  resetEmbeddingFields(meta);
  meta.progress = 100;
  meta.exactProgress = 100;
}

async function refreshUnits(meta, profile, text, sections) {
  await stopEmbeddingAndWait(meta.id);

  const units = buildUnits(text, sections, {
    fileName: meta.name,
    maxSectionTokens: profile.maxSectionTokens,
  });
  const previous = await chunksRepo.listChunks(meta.id);
  const reconciled = await reconcileUnits(units, previous);
  if (reconciled.changed) await chunksRepo.replaceChunks(meta.id, reconciled.units);

  if (!reconciled.units.length) {
    markNothingToEmbed(meta);
    return;
  }

  const ignoredCount = await countUnembeddable(reconciled.units, embeddingLimits(state.data.config));
  const embeddedCount = reconciled.units.filter((unit) => unit.vector).length;
  const progress = applyProgress(meta, {
    chunkCount: reconciled.units.length,
    embeddedCount,
    ignoredCount,
  });
  if (!progress.complete) startEmbedding(meta.id);
}

async function runClear(fileId) {
  await stopEmbeddingAndWait(fileId);
  await chunksRepo.deleteChunks(fileId);
  await sectionsRepo.deleteSections(fileId);
  const meta = findFile(fileId);
  if (meta) {
    resetEmbeddingFields(meta);
    meta.sectionCount = 0;
    meta.indexError = '';
    await persistFiles();
    emit(EVENTS.FILE_PROGRESS, { id: fileId });
  }
  return null;
}

async function runIndex(fileId) {
  const meta = findFile(fileId);
  if (!meta) return null;
  const profile = profileOf(meta);
  if (!profile) return runClear(fileId);

  const data = await filesRepo.loadFileData(fileId);
  const text = data?.text || '';
  const { sections, error } = await parseDocument(profile, text, meta.name);

  const record = {
    profileId: profile.id,
    profileUpdatedAt: profile.updatedAt,
    textLength: text.length,
    sections,
    error: error || '',
  };
  await sectionsRepo.saveSections(fileId, record);
  meta.sectionCount = sections.length;
  meta.indexError = record.error;

  if (profile.methods.embeddings) {
    await refreshUnits(meta, profile, text, sections);
  } else {
    await stopEmbeddingAndWait(fileId);
    await chunksRepo.deleteChunks(fileId);
    markNothingToEmbed(meta);
  }

  await persistFiles();
  emit(EVENTS.FILE_PROGRESS, { id: fileId });
  return record;
}

/**
 * Parse a file under its profile and bring its embedding units up to date,
 * starting the embedding loop if anything is left to embed. A file without a
 * profile has its index cleared. Resolves with the stored sections record.
 */
export function indexFile(fileId) {
  return enqueue(fileId, () => runIndex(fileId));
}

/** Drop everything indexed for a file: sections, units and progress. */
export function clearIndex(fileId) {
  return enqueue(fileId, () => runClear(fileId));
}

function isCurrent(record, profile, text) {
  return (
    Boolean(record) &&
    Array.isArray(record.sections) &&
    record.profileId === profile.id &&
    record.profileUpdatedAt === profile.updatedAt &&
    record.textLength === text.length
  );
}

/**
 * A configured file ready to search:
 *
 *   { fileId, fileName, profile, text, sections, lines, error }
 *
 * Its sections are re-parsed first if they no longer match the text or the
 * profile. Null for a file without a profile.
 */
export async function loadDocument(meta) {
  const profile = profileOf(meta);
  if (!profile) return null;

  const data = await filesRepo.loadFileData(meta.id);
  const text = data?.text || '';
  let record = await sectionsRepo.loadSections(meta.id);
  if (!isCurrent(record, profile, text)) record = await indexFile(meta.id);
  if (!record) return null;

  return {
    fileId: meta.id,
    fileName: meta.name,
    profile,
    text,
    sections: record.sections,
    lines: createLineIndex(text),
    error: record.error || '',
  };
}

/**
 * Discard every stored vector, and rebuild the units of every file that
 * searches by embeddings — used when the embeddings model changes.
 */
export async function resetAllEmbeddings() {
  for (const meta of [...state.data.files]) {
    await enqueue(meta.id, async () => {
      await stopEmbeddingAndWait(meta.id);
      await chunksRepo.deleteChunks(meta.id);
      resetEmbeddingFields(meta);
    });

    const profile = profileOf(meta);
    if (profile?.methods.embeddings) await indexFile(meta.id);
    else if (profile) markNothingToEmbed(meta);
  }
  await persistFiles();
  emit(EVENTS.FILES);
}
