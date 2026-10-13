import { state, searchableFiles, profileOf } from '../../store/state.js';
import {
  TOOL_NAMES,
  SEARCH_TOOLS,
  DEFAULT_JS_TOOL_DESCRIPTION,
  DEFAULT_SEARCH_DESCRIPTIONS,
  javascriptToolSchema,
  searchToolSchema,
  isSearchTool,
} from '../../core/tools.js';
import { SEARCH_METHODS } from '../../core/rag-profile.js';
import { parseToolArguments, clampToolResult } from '../../core/tool-calls.js';
import { pick, pickNumber } from '../../core/values.js';
import { GLOBAL_SETTINGS } from '../../core/settings-schema.js';
import { runJavaScript } from './javascript.js';
import { runTextSearch, runRegexSearch, runSemanticSearch } from './file-search.js';

/** Which tools a chat's requests offer, and the running of the calls that come back. */

/**
 * Every executor takes `(args, { chat, signal })` and resolves with
 * `{ content, failed }`: the text sent back to the model, and whether that
 * text reports a failure (the transcript marks those calls).
 */
const EXECUTORS = {
  [TOOL_NAMES.javascript]: runJavaScript,
  [SEARCH_TOOLS.text]: runTextSearch,
  [SEARCH_TOOLS.regex]: runRegexSearch,
  [SEARCH_TOOLS.embeddings]: runSemanticSearch,
};

/** The advanced setting holding each search tool's description. */
const DESCRIPTION_SETTINGS = {
  text: 'textSearchToolDescription',
  regex: 'regexSearchToolDescription',
  embeddings: 'semanticSearchToolDescription',
};

const failure = (content) => ({ content, failed: true });

/**
 * JavaScript execution is one global switch. Each search method is offered
 * exactly when at least one attached file's profile enables it (and, for
 * embeddings, there is a model to search with), listing only those files.
 */
export function toolSchemasFor(chat) {
  const config = state.data.config;
  const tools = [];

  if (config.jsExecution) {
    tools.push(javascriptToolSchema(pick(config.jsToolDescription, DEFAULT_JS_TOOL_DESCRIPTION)));
  }

  const offered = SEARCH_METHODS.map((method) => ({ method, files: searchableFiles(chat, method) })).filter(
    (entry) => entry.files.length,
  );
  const methods = offered.map((entry) => entry.method);

  for (const { method, files } of offered) {
    tools.push(
      searchToolSchema(method, {
        description: pick(config[DESCRIPTION_SETTINGS[method]], DEFAULT_SEARCH_DESCRIPTIONS[method]),
        files: files.map((file) => ({ name: file.name, notes: profileOf(file)?.notes || '' })),
        methods,
      }),
    );
  }

  return tools;
}

/**
 * Run one call and resolve with `{ content, failed }`.
 *
 * Only a tool that is offered right now will run: a model can write a call to
 * anything it likes, including `run_javascript` while execution is switched
 * off. Every other failure also comes back as text for the model to read; the
 * one thing that propagates is the user's abort.
 */
export async function runToolCall(call, { chat, signal }) {
  const offered = toolSchemasFor(chat).some((tool) => tool.function.name === call.name);
  const execute = EXECUTORS[call.name];
  if (!offered || !execute) return failure(`Error: the tool "${call.name}" is not available.`);

  const parsed = parseToolArguments(call.arguments);
  if (!parsed.ok) return failure(`Error: ${parsed.error}`);

  let outcome;
  try {
    outcome = await execute(parsed.value, { chat, signal });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return failure(`Error: ${error.message}`);
  }

  const content = typeof outcome?.content === 'string' ? outcome.content : '';
  const failed = Boolean(outcome?.failed);

  // File search budgets itself (Max RAG Tokens); everything else is capped here.
  if (isSearchTool(call.name)) return { content, failed };
  const cap = pickNumber(
    4000,
    state.data.config.toolResultMaxTokens,
    GLOBAL_SETTINGS.toolResultMaxTokens.default,
  );
  return { content: clampToolResult(content, cap), failed };
}
