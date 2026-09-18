import { state, reportHookError } from '../store/state.js';
import * as filesRepo from '../data/files-repo.js';
import * as chunksRepo from '../data/chunks-repo.js';
import { fetchEmbeddings } from './api/embeddings.js';
import { fileWrapperHook, retrievalHooks } from './user-hooks.js';
import { assembleChunks } from '../core/pipeline.js';
import { pickNumber } from '../core/values.js';
import { textOf } from '../core/tokens.js';
import { GLOBAL_SETTINGS } from '../core/settings-schema.js';

/** Semantic search across a set of indexed files. */

const NO_MATCHES = 'No matching passages were found.';

/** Wrap one file's retrieved passages for the model. */
export async function wrapFileContent(meta, content, fileName) {
  const wrap = fileWrapperHook(meta, state.data.config);
  try {
    return await wrap(content, fileName);
  } catch (error) {
    reportHookError('fileWrapperFunc', error);
    return `\`${fileName}\`:\n\n\`\`\`\n${content}\n\`\`\``;
  }
}

/**
 * Embed `query` once, score every file's chunks against it, and let the best
 * candidates from all files compete for one token budget.
 *
 * Returns the text handed to the model: one wrapped section per file that
 * contributed, best match first. A file that could not be searched properly is
 * named in a trailing note — without it, the model would read "no results" as
 * "the documents do not say".
 */
export async function searchFiles({ files, query, signal }) {
  const config = state.data.config;
  const budget = pickNumber(5000, config.maxRagTokens, GLOBAL_SETTINGS.maxRagTokens.default);
  // Far more than the budget can hold, so dedupe and per-file caps have slack.
  const candidateLimit = Math.max(100, Math.ceil(budget / 25));

  const [queryVector] = await fetchEmbeddings(config, [query], signal);

  const notes = [];
  const scored = [];
  for (const meta of files) {
    signal?.throwIfAborted();
    const threshold = pickNumber(
      0,
      meta.ragThreshold,
      config.ragThreshold,
      GLOBAL_SETTINGS.ragThreshold.default,
    );
    const result = await chunksRepo.scoreChunks(meta.id, queryVector, {
      threshold,
      limit: candidateLimit,
    });

    if (result.vectorCount === 0) {
      notes.push(`"${meta.name}" has not been indexed yet and was not searched.`);
    } else if ((meta.progress ?? 0) < 100) {
      notes.push(
        `"${meta.name}" is only ${meta.progress ?? 0}% indexed, so its results may be incomplete.`,
      );
    }
    scored.push(...result.scored);
  }
  scored.sort((a, b) => b.score - a.score);

  const sources = new Map();
  for (const meta of files) {
    if (!scored.some((candidate) => candidate.fileId === meta.id)) continue;
    const data = await filesRepo.loadFileData(meta.id);
    sources.set(meta.id, {
      fileText: data?.text || '',
      hooks: retrievalHooks(meta),
      maxTokens: pickNumber(Infinity, meta.maxRagTokens),
    });
  }

  const sections = await assembleChunks({
    scored,
    sources,
    maxTokens: budget,
    onError: reportHookError,
  });

  const parts = [];
  for (const section of sections) {
    const meta = files.find((file) => file.id === section.fileId);
    parts.push(await wrapFileContent(meta, textOf(section.content), meta.name));
  }

  const body = parts.length ? parts.join('\n\n') : NO_MATCHES;
  return notes.length ? `${body}\n\n${notes.map((note) => `[Note: ${note}]`).join('\n')}` : body;
}
