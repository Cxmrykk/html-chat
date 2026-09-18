import { state, chatFiles, embeddingsEnabled } from '../../store/state.js';
import {
  TOOL_NAMES,
  DEFAULT_JS_TOOL_DESCRIPTION,
  DEFAULT_SEARCH_TOOL_DESCRIPTION,
  javascriptToolSchema,
  searchToolSchema,
} from '../../core/tools.js';
import { parseToolArguments, clampToolResult } from '../../core/tool-calls.js';
import { pick, pickNumber } from '../../core/values.js';
import { GLOBAL_SETTINGS } from '../../core/settings-schema.js';
import { runJavaScript } from './javascript.js';
import { runFileSearch } from './file-search.js';

/** Which tools a chat's requests offer, and the running of the calls that come back. */

const EXECUTORS = {
  [TOOL_NAMES.javascript]: runJavaScript,
  [TOOL_NAMES.search]: runFileSearch,
};

/**
 * JavaScript execution is one global switch. File search needs no switch of its
 * own: it is offered exactly when the chat has files attached (and there is an
 * embeddings model to search them with).
 */
export function toolSchemasFor(chat) {
  const config = state.data.config;
  const tools = [];

  if (config.jsExecution) {
    tools.push(javascriptToolSchema(pick(config.jsToolDescription, DEFAULT_JS_TOOL_DESCRIPTION)));
  }

  const files = chatFiles(chat);
  if (files.length && embeddingsEnabled()) {
    tools.push(
      searchToolSchema(
        pick(config.searchToolDescription, DEFAULT_SEARCH_TOOL_DESCRIPTION),
        files.map((file) => file.name),
      ),
    );
  }

  return tools;
}

/**
 * Run one call and return the text of its result.
 *
 * Only a tool that is offered right now will run: a model can write a call to
 * anything it likes, including `run_javascript` while execution is switched
 * off. Every other failure also comes back as text for the model to read; the
 * one thing that propagates is the user's abort.
 */
export async function runToolCall(call, { chat, signal }) {
  const offered = toolSchemasFor(chat).some((tool) => tool.function.name === call.name);
  const execute = EXECUTORS[call.name];
  if (!offered || !execute) return `Error: the tool "${call.name}" is not available.`;

  const parsed = parseToolArguments(call.arguments);
  if (!parsed.ok) return `Error: ${parsed.error}`;

  let result;
  try {
    result = await execute(parsed.value, { chat, signal });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return `Error: ${error.message}`;
  }

  // File search budgets itself (Max RAG Tokens); everything else is capped here.
  if (call.name === TOOL_NAMES.search) return result;
  const cap = pickNumber(
    4000,
    state.data.config.toolResultMaxTokens,
    GLOBAL_SETTINGS.toolResultMaxTokens.default,
  );
  return clampToolResult(result, cap);
}
