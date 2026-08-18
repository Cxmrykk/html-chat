import { pick } from '../core/values.js';
import { GLOBAL_SETTINGS, FILE_SETTINGS } from '../core/settings-schema.js';
import { reportHookError } from '../store/state.js';
import { textOf } from '../core/tokens.js';

/**
 * Compilation and execution of user-supplied JavaScript hooks with caching.
 */

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const cache = new Map();

function compile(code, argNames) {
  const cacheKey = `${argNames.join(',')}\u0000${code}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const fn = new AsyncFunction(...argNames, code);
  cache.set(cacheKey, fn);
  return fn;
}

/**
 * Compile `code`, or return `fallback` and report if it will not parse.
 * `key` names the setting so error reporting can identify it.
 */
export function compileHook(key, code, argNames, fallback) {
  try {
    return compile(code, argNames);
  } catch (error) {
    reportHookError(key, error);
    return fallback;
  }
}

/** Compile and throw — for interactive actions that want to surface the error. */
export function compileHookStrict(code, argNames) {
  return compile(code, argNames);
}

/* ------------------------------------------------------------------ *
 * Resolved hooks (file override -> global config -> schema default)
 * ------------------------------------------------------------------ */

const defaultWrapper = async (fileContent, fileName) =>
  `\`${fileName}\`:\n\n\`\`\`\n${fileContent}\n\`\`\``;

export function fileWrapperHook(meta, config) {
  const code = pick(
    meta?.fileWrapperFunc,
    config?.fileWrapperFunc,
    GLOBAL_SETTINGS.fileWrapperFunc.default,
  );
  return compileHook('fileWrapperFunc', code, ['fileContent', 'fileName'], defaultWrapper);
}

export function chunkerHook(meta) {
  const code = pick(meta?.customChunker, FILE_SETTINGS.customChunker.default);
  return compileHook('customChunker', code, ['fileContents', 'config'], async () => []);
}

/** The three post-retrieval hooks, resolved together. */
export function retrievalHooks(meta) {
  const retrieveCode = pick(meta?.retrievalFunc, FILE_SETTINGS.retrievalFunc.default);
  const dedupCode = pick(meta?.dedupFunc, FILE_SETTINGS.dedupFunc.default);
  const mergeCode = pick(meta?.mergeChunksFunc, FILE_SETTINGS.mergeChunksFunc.default);

  return {
    retrieve: compileHook(
      'retrievalFunc',
      retrieveCode,
      ['chunk', 'fileContents'],
      async (chunk) => chunk,
    ),
    isDuplicate: compileHook(
      'dedupFunc',
      dedupCode,
      ['currentData', 'existingData'],
      async (a, b) => a === b,
    ),
    merge: compileHook(
      'mergeChunksFunc',
      mergeCode,
      ['finalChunks'],
      async (chunks) => chunks.map(textOf).join('...'),
    ),
  };
}
