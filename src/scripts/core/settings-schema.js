import { isBlank, pickBoolean } from './values.js';
import { DEFAULT_JS_TOOL_DESCRIPTION, DEFAULT_SEARCH_TOOL_DESCRIPTION } from './tools.js';
import { REASONING_FIELDS, isReasoningField } from './reasoning.js';

/**
 * The single description of every configurable setting.
 *
 * Each entry carries everything the rest of the app needs to know about it:
 * how to store it (`type`), what to call it (`label`), what to show in the
 * list (`display`), and what has to happen when it changes
 * (`requiresReembed` / `resetsEmbeddings`). Nothing else should maintain
 * parallel lists of keys.
 */

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
const showValueOrDefault = (value) => (isBlank(value) ? 'Default' : String(value));
const showCustomOrDefault = (value, entry) =>
  isBlank(value) || value === entry.default ? 'Default' : 'Custom';
const showInheritedOrCustom = (value) => (isBlank(value) ? 'Default' : 'Custom');
const showOnOff = (value, entry) =>
  pickBoolean(pickBoolean(false, entry.default), value) ? 'On' : 'Off';

/** An unknown field name is ignored when sending, so the list says so. */
const showEchoField = (value) => {
  if (isBlank(value)) return 'Off';
  const name = String(value).trim();
  return isReasoningField(name) ? name : `${name} (ignored)`;
};

export const GLOBAL_SETTINGS = {
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
  maxToolRounds: {
    label: 'Max Tool Rounds',
    category: 'Tools',
    type: 'number',
    default: '10',
    tooltip:
      'How many times in one turn the model may call tools and be sent the results. After that it is asked to answer without tools.',
    display: showValueOrDefault,
  },
  toolResultMaxTokens: {
    label: 'Max Tool Result Tokens',
    category: 'Tools',
    type: 'number',
    default: '4000',
    tooltip: 'Estimated-token cap on a JavaScript result. Longer results are truncated. 0 disables the cap.',
    display: showValueOrDefault,
  },
  reasoningEchoField: {
    label: 'Echo Reasoning Field',
    category: 'Tools',
    type: 'text',
    default: '',
    tooltip:
      `During a tool loop, send the model's plain-text reasoning back under this field (${REASONING_FIELDS.join(' or ')}), for models that expect it. ` +
      'Empty sends none. Signed thinking blocks (Claude via LiteLLM) are always sent back regardless.',
    display: showEchoField,
  },
  jsToolDescription: {
    label: 'JavaScript Tool Description',
    category: 'Tools',
    type: 'code',
    default: DEFAULT_JS_TOOL_DESCRIPTION,
    tooltip: 'What the model is told about the JavaScript execution tool.',
    display: showCustomOrDefault,
  },
  searchToolDescription: {
    label: 'File Search Tool Description',
    category: 'Tools',
    type: 'code',
    default: DEFAULT_SEARCH_TOOL_DESCRIPTION,
    tooltip: 'What the model is told about the file search tool. The attached file names are appended.',
    display: showCustomOrDefault,
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
    tooltip: 'Model used to index files and search them. Empty disables file search.',
    resetsEmbeddings: true,
    display: (value) => (isBlank(value) ? 'Disabled' : String(value)),
  },
  extraModels: {
    label: 'Extra Models',
    category: 'API & Connections',
    type: 'text',
    default: '',
    tooltip: 'Comma-separated models to always offer, for servers that do not implement /models.',
    display: (value) => (isBlank(value) ? 'None' : String(value)),
  },
  fileWrapperFunc: {
    label: 'File Wrapper Function (JS)',
    category: 'RAG & Document Processing',
    type: 'code',
    default: DEFAULT_FILE_WRAPPER,
    tooltip:
      "JS Function [Vars: fileContent, fileName]: Wrap one file's retrieved passages before they are returned to the model.",
    display: showCustomOrDefault,
  },
  maxRagTokens: {
    label: 'Max RAG Tokens',
    category: 'RAG & Document Processing',
    type: 'number',
    default: '5000',
    tooltip: 'Maximum estimated tokens returned by one file search, across all files searched.',
    display: showValueOrDefault,
  },
  ragThreshold: {
    label: 'RAG Match Threshold',
    category: 'RAG & Document Processing',
    type: 'number',
    default: '0.0',
    tooltip: 'Min similarity threshold (0.0 to 1.0). 0.0 allows anything.',
    display: showValueOrDefault,
  },
  chunkMaxTokens: {
    label: 'Max Tokens Per Chunk',
    category: 'RAG & Document Processing',
    type: 'number',
    default: '1024',
    tooltip: 'Maximum tokens allowed per single chunk.',
    display: showValueOrDefault,
  },
  chunkBatchSize: {
    label: 'Chunk Batch Size',
    category: 'RAG & Document Processing',
    type: 'number',
    default: '100',
    tooltip: 'Max chunks sent to Embeddings API at once.',
    display: showValueOrDefault,
  },
  chunkBatchMaxTokens: {
    label: 'Chunk Batch Max Tokens',
    category: 'RAG & Document Processing',
    type: 'number',
    default: '8192',
    tooltip: 'Max estimated tokens sent to Embeddings API per batch.',
    display: showValueOrDefault,
  },
  collapseThinking: {
    label: 'Collapse Thinking',
    category: 'UI & Display',
    type: 'boolean',
    default: 'true',
    tooltip:
      'Whether a new thinking box (reasoning, and the tool calls made while thinking) starts collapsed: true or false. Any box can still be opened or closed by clicking it.',
    display: showOnOff,
  },
  autoCollapseCode: {
    label: 'Auto-Collapse Code',
    category: 'UI & Display',
    type: 'boolean',
    default: 'true',
    tooltip: 'Automatically collapse long code blocks. They can be toggled by clicking.',
    display: showOnOff,
  },
  codeCollapseThreshold: {
    label: 'Code Collapse Threshold',
    category: 'UI & Display',
    type: 'number',
    default: '20',
    tooltip: 'Minimum number of lines before a code block becomes collapsible.',
    display: showValueOrDefault,
  },
  codeCollapsePreviewLines: {
    label: 'Code Preview Lines',
    category: 'UI & Display',
    type: 'number',
    default: '5',
    tooltip: 'Number of lines to display when a code block is collapsed.',
    display: showValueOrDefault,
  },
  showCodeCollapseHint: {
    label: 'Show Code Collapse Hint',
    category: 'UI & Display',
    type: 'boolean',
    default: 'true',
    tooltip: 'Show a centered "Click to expand" fading overlay on collapsed code blocks.',
    display: showOnOff,
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
    tooltip: 'Cap on the estimated tokens this file may contribute to a single search. Empty for no cap.',
    display: (value) => (isBlank(value) ? 'No cap' : String(value)),
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
