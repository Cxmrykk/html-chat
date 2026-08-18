import { state, findFile, reportHookError } from '../store/state.js';
import * as filesRepo from '../data/files-repo.js';
import * as chunksRepo from '../data/chunks-repo.js';
import { fetchEmbeddings } from './api/embeddings.js';
import { fileWrapperHook, retrievalHooks } from './user-hooks.js';
import { assembleChunks } from '../core/pipeline.js';
import { pickNumber } from '../core/values.js';

/** Retrieval-augmented lookup for a file message. */

const NOT_FOUND = '*File not found.*';
const UNINDEXED = '*File unindexed or no valid chunks.*';

/** Wrap final content for insertion into the prompt. */
export async function wrapFileContent(meta, content, fileName) {
  const wrap = fileWrapperHook(meta, state.data.config);
  try {
    return await wrap(content, fileName);
  } catch (error) {
    reportHookError('fileWrapperFunc', error);
    return `\`${fileName}\`:\n\n\`\`\`\n${content}\n\`\`\``;
  }
}

/** A file inserted whole, wrapped and ready to send. */
export async function fullFileContent(fileId) {
  const meta = findFile(fileId);
  if (!meta) return NOT_FOUND;
  const data = await filesRepo.loadFileData(fileId);
  if (!data) return NOT_FOUND;
  return wrapFileContent(meta, data.text, meta.name);
}

/**
 * Score, select and merge the chunks that best answer `prompt`.
 * Returns the merged text; the caller wraps it.
 */
export async function retrieveChunks({ fileId, prompt, maxTokens, threshold, signal }) {
  const meta = findFile(fileId);
  if (!meta) return NOT_FOUND;

  const data = await filesRepo.loadFileData(fileId);
  if (!data) return NOT_FOUND;

  const config = state.data.config;
  const resolvedMax = pickNumber(maxTokens ?? 5000, meta.maxRagTokens);
  const resolvedThreshold = pickNumber(threshold ?? 0, meta.ragThreshold);

  let queryVector = null;
  if (prompt) {
    const [vector] = await fetchEmbeddings(config, [prompt], signal);
    queryVector = vector;
  }

  const { scored, vectorCount } = await chunksRepo.scoreChunks(
    fileId,
    queryVector,
    resolvedThreshold,
  );
  if (vectorCount === 0) return UNINDEXED;

  return assembleChunks({
    scored,
    fileText: data.text,
    maxTokens: resolvedMax,
    hooks: retrievalHooks(meta),
    onError: reportHookError,
  });
}
