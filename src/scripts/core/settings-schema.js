import { isBlank } from './values.js';

/**
 * The single description of every configurable setting.
 *
 * Each entry carries everything the rest of the app needs to know about it:
 * how to store it (`type`), what to call it (`label`), what to show in the
 * list (`display`), and what has to happen when it changes
 * (`requiresReembed` / `resetsEmbeddings`). Nothing else should maintain
 * parallel lists of keys.
 */

export const DEFAULT_GOD_MODE_PROMPT = [
  '[SYSTEM OVERRIDE: CODE EXECUTION ENABLED]',
  "You are executing directly inside the user's web browser (JS console). You are NOT in a sandboxed cloud environment. You are NOT in Node.js or Python. You have full, unrestricted access to the user's 'window', 'document', 'navigator', 'localStorage', etc.",
  '',
  'However, to execute code, you MUST use this exact syntax (the return value is sent back to you):',
  '<run>',
  '// browser-side JS goes here',
  'return data.toString();',
  '</run>',
  '',
  'CRITICAL RULES FOR TOOL USE:',
  '1. DO NOT CALCULATE MANUALLY. If the user asks a math, logic, or data question, you MUST use a <run> block to compute it.',
  '2. NO FAKE CODE, MOCKS, OR HARDCODING. Your JavaScript MUST contain actual logic, algorithms, math, or simulations. DO NOT write "simplified" checks.',
  "3. VANILLA JS LIMITATIONS. You are in a browser. You do not have Python's `itertools`, `numpy`, or `scipy`. If you need combinations or matrix operations, implement them yourself.",
  '4. STATE PERSISTENCE. Each <run> block executes in a fresh async scope. Variables declared with `let` or `const` will NOT persist. Use `window`.',
  '5. ITERATIVE PROBLEM SOLVING. Break down complex problems into multiple <run> blocks.',
  "6. DEFER YOUR ANSWER. If you output a <run> block, DO NOT attempt to answer the user's prompt in the same message.",
  '7. WAIT FOR THE RESULT. The system will execute your code and return the result. If your code throws an error, fix it and try again.',
  '8. DELIVER THE FINAL ANSWER ONLY AFTER EXECUTION.',
  '9. NEVER use Node.js modules (require, os, fs). They do not exist here.',
  '10. NEVER use markdown backticks (```) around the <run> tags.',
  '',
  'EXAMPLE WORKFLOW:',
  'User: What is the square root of 9999?',
  'Assistant: I need to compute this.',
  '<run>',
  'return Math.sqrt(9999);',
  '</run>',
  'User: **Execution Result:**...',
  'Assistant: The square root is...',
].join('\n');

const DEFAULT_FILE_WRAPPER = [
  'const extMatch = (fileName || "").match(/\\.([^.]+)$/);',
  'const ext = extMatch ? extMatch[1] : "txt";',
  'const fence = (fileContent || "").includes("```") ? "````" : "```";',
  'return "`" + fileName + "`:\\n\\n" + fence + ext + "\\n" + fileContent + "\\n" + fence;',
].join('\n');

const DEFAULT_CHUNKER = [
  "// Variables: 'fileContents' (full file string)",
  'const chunkSize = 1000;',
  'const chunkOverlap = 200;',
  'const chunks = [];',
  'let start = 0;',
  'while (start < fileContents.length) {',
  '  let end = start + chunkSize;',
  '  if (end > fileContents.length) end = fileContents.length;',
  '  chunks.push(fileContents.substring(start, end));',
  '  if (end >= fileContents.length) break;',
  '  start = end - chunkOverlap;',
  '}',
  'return chunks;',
].join('\n');

/** Display helpers shared by several entries. */
const showApiDefault = (value) => (isBlank(value) ? 'API Default' : String(value));
const showCustomOrDefault = (value, entry) =>
  isBlank(value) || value === entry.default ? 'Default' : 'Custom';
const showInheritedOrCustom = (value) => (isBlank(value) ? 'Default' : 'Custom');

export const GLOBAL_SETTINGS = {
  godModePrompt: {
    label: 'God Mode Prompt',
    category: 'LLM Behavior',
    type: 'code',
    default: DEFAULT_GOD_MODE_PROMPT,
    tooltip: 'System prompt used when God Mode is enabled.',
    display: showCustomOrDefault,
  },
  temperature: {
    label: 'Temperature',
    category: 'LLM Behavior',
    type: 'number',
    default: '',
    tooltip: 'Controls randomness (0.0 to 2.0).',
    payloadKey: 'temperature',
    display: showApiDefault,
  },
  top_p: {
    label: 'Top P',
    category: 'LLM Behavior',
    type: 'number',
    default: '',
    tooltip: 'Nucleus sampling (0.0 to 1.0).',
    payloadKey: 'top_p',
    display: showApiDefault,
  },
  max_tokens: {
    label: 'Max Tokens',
    category: 'LLM Behavior',
    type: 'number',
    default: '',
    tooltip: 'Maximum number of tokens to generate.',
    payloadKey: 'max_tokens',
    integer: true,
    display: showApiDefault,
  },
  frequency_penalty: {
    label: 'Frequency Penalty',
    category: 'LLM Behavior',
    type: 'number',
    default: '',
    tooltip: 'Penalizes new tokens based on existing frequency (-2.0 to 2.0).',
    payloadKey: 'frequency_penalty',
    display: showApiDefault,
  },
  presence_penalty: {
    label: 'Presence Penalty',
    category: 'LLM Behavior',
    type: 'number',
    default: '',
    tooltip: 'Penalizes new tokens based on presence (-2.0 to 2.0).',
    payloadKey: 'presence_penalty',
    display: showApiDefault,
  },
  streamResponse: {
    label: 'Stream Response',
    category: 'LLM Behavior',
    type: 'text',
    default: 'true',
    tooltip: 'Stream responses chunk-by-chunk (true/false).',
    display: showApiDefault,
  },
  embeddingsUrl: {
    label: 'Embeddings Base URL',
    category: 'API & Connections',
    type: 'text',
    default: '',
    tooltip: 'Custom base URL for embeddings.',
    display: showApiDefault,
  },
  embeddingsKey: {
    label: 'Embeddings API Key',
    category: 'API & Connections',
    type: 'text',
    default: '',
    tooltip: 'API Key for the custom embeddings URL.',
    display: (value) => (isBlank(value) ? 'API Default' : 'Custom'),
  },
  embeddingsModel: {
    label: 'Embeddings Model',
    category: 'API & Connections',
    type: 'text',
    default: '',
    tooltip: 'Model used for processing local RAG commands. Empty to disable.',
    resetsEmbeddings: true,
    display: (value) => (isBlank(value) ? 'Disabled' : String(value)),
  },
  fileWrapperFunc: {
    label: 'File Wrapper Function (JS)',
    category: 'RAG & Document Processing',
    type: 'code',
    default: DEFAULT_FILE_WRAPPER,
    tooltip:
      'JS Function [Vars: fileContent, fileName]: Wrap the final file content/chunks before inserting into the prompt.',
    display: showCustomOrDefault,
  },
  maxRagTokens: {
    label: 'Max RAG Tokens',
    category: 'RAG & Document Processing',
    type: 'number',
    default: '5000',
    tooltip: 'Maximum estimated tokens to retrieve per file message.',
    display: showApiDefault,
  },
  ragThreshold: {
    label: 'RAG Match Threshold',
    category: 'RAG & Document Processing',
    type: 'number',
    default: '0.0',
    tooltip: 'Min similarity threshold (0.0 to 1.0). 0.0 allows anything.',
    display: showApiDefault,
  },
  chunkMaxTokens: {
    label: 'Max Tokens Per Chunk',
    category: 'RAG & Document Processing',
    type: 'number',
    default: '1024',
    tooltip: 'Maximum tokens allowed per single chunk.',
    display: showApiDefault,
  },
  chunkBatchSize: {
    label: 'Chunk Batch Size',
    category: 'RAG & Document Processing',
    type: 'number',
    default: '100',
    tooltip: 'Max chunks sent to Embeddings API at once.',
    display: showApiDefault,
  },
  chunkBatchMaxTokens: {
    label: 'Chunk Batch Max Tokens',
    category: 'RAG & Document Processing',
    type: 'number',
    default: '8192',
    tooltip: 'Max estimated tokens sent to Embeddings API per batch.',
    display: showApiDefault,
  },
  maxVisibleChats: {
    label: 'Max Visible Chats',
    category: 'UI & Display',
    type: 'number',
    default: '',
    tooltip: 'Maximum number of chats displayed at once in the sidebar.',
    display: (value) => (isBlank(value) ? 'Unlimited' : String(value)),
  },
  maxVisibleFiles: {
    label: 'Max Visible Files',
    category: 'UI & Display',
    type: 'number',
    default: '',
    tooltip: 'Maximum number of files displayed at once in the sidebar.',
    display: (value) => (isBlank(value) ? 'Unlimited' : String(value)),
  },
};

export const FILE_SETTINGS = {
  fileText: {
    label: 'File Content Text',
    category: 'Overrides',
    type: 'text',
    default: '',
    tooltip: 'The full textual content of the file. Edit and save to update.',
    virtual: true,
    display: () => 'Custom',
  },
  fileWrapperFunc: {
    label: 'File Wrapper Function (JS)',
    category: 'Overrides',
    type: 'code',
    default: '',
    tooltip:
      'Override global File Wrapper Function for this file. [Vars: fileContent, fileName]',
    display: showInheritedOrCustom,
  },
  maxRagTokens: {
    label: 'Max RAG Tokens',
    category: 'Overrides',
    type: 'number',
    default: '',
    tooltip: 'Override global max RAG tokens for this file.',
    display: showInheritedOrCustom,
  },
  ragThreshold: {
    label: 'RAG Match Threshold',
    category: 'Overrides',
    type: 'number',
    default: '',
    tooltip: 'Override global match threshold for this file. (0.0 to 1.0)',
    display: showInheritedOrCustom,
  },
  chunkMaxTokens: {
    label: 'Max Tokens Per Chunk',
    category: 'Overrides',
    type: 'number',
    default: '',
    tooltip: 'Override global max tokens per chunk for this file.',
    display: showInheritedOrCustom,
  },
  customChunks: {
    label: 'Custom Chunks (JSON)',
    category: 'Chunk Generation',
    type: 'code',
    default: '',
    tooltip: 'A JSON array to bypass all chunking logic.',
    requiresReembed: true,
    display: showInheritedOrCustom,
  },
  customChunker: {
    label: 'Custom Chunking Function (JS)',
    category: 'Chunk Generation',
    type: 'code',
    default: DEFAULT_CHUNKER,
    tooltip:
      'JS Function [Vars: fileContents]: Create an array of chunks (strings or objects). Default splits by 1000 chars with a 200 char overlap.',
    requiresReembed: true,
    display: showCustomOrDefault,
  },
  retrievalFunc: {
    label: '1. Retrieval Function (JS)',
    category: 'Post-Retrieval Processing',
    type: 'code',
    default: 'return chunk;',
    tooltip: 'JS Function [Vars: chunk, fileContents]: Step 1. Process or expand context.',
    display: showCustomOrDefault,
  },
  dedupFunc: {
    label: '2. Deduplication Function (JS)',
    category: 'Post-Retrieval Processing',
    type: 'code',
    default: 'return currentData === existingData;',
    tooltip: 'JS Function [Vars: currentData, existingData]: Step 2. Dup check.',
    display: showCustomOrDefault,
  },
  mergeChunksFunc: {
    label: '3. Merge Chunks Function (JS)',
    category: 'Post-Retrieval Processing',
    type: 'code',
    default: `return finalChunks.map(c => typeof c === 'string' ? c : JSON.stringify(c)).join("...");`,
    tooltip: 'JS Function [Vars: finalChunks]: Step 3. Combine.',
    display: showCustomOrDefault,
  },
};

/** Group schema keys by category, preserving declaration order. */
export function groupByCategory(schema) {
  const groups = new Map();
  for (const [key, entry] of Object.entries(schema)) {
    const category = entry.category || 'Other';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(key);
  }
  return groups;
}

/** The right-hand summary shown next to a setting in the list. */
export function describeSetting(schema, key, value) {
  const entry = schema[key];
  if (!entry) return '';
  const display = entry.display || showApiDefault;
  return display(value, entry);
}

/** Keys whose change should wipe every stored vector. */
export function resetsEmbeddings(schema, key) {
  return Boolean(schema[key]?.resetsEmbeddings);
}

/** Keys whose change invalidates the current chunk set. */
export function requiresReembed(schema, key) {
  return Boolean(schema[key]?.requiresReembed);
}
