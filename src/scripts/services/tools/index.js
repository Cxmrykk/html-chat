import { state } from '../../store/state.js';
import {
  TOOL_NAMES,
  DEFAULT_JS_TOOL_DESCRIPTION,
  javascriptToolSchema,
  imageToolSchemas,
  isImageToolName,
} from '../../core/tools.js';
import { parseToolArguments, clampToolResult } from '../../core/tool-calls.js';
import { normalizeAttachments } from '../../core/attachments.js';
import { pick, pickNumber } from '../../core/values.js';
import { GLOBAL_SETTINGS } from '../../core/settings-schema.js';
import { capabilitiesFor, imageToolModels } from '../models.js';
import { runJavaScript } from './javascript.js';
import { listImageModels, generateImage, editImage } from './images.js';

/** Which tools requests offer, and the running of the calls that come back. */

/**
 * Every executor takes `(args, { signal, chatId })` and resolves with
 * `{ content, failed, attachments? }`: the text sent back to the model,
 * whether that text reports a failure (the transcript marks those calls), and
 * any images the call made.
 */
const EXECUTORS = {
  [TOOL_NAMES.javascript]: runJavaScript,
  [TOOL_NAMES.listImageModels]: listImageModels,
  [TOOL_NAMES.generateImage]: generateImage,
  [TOOL_NAMES.editImage]: editImage,
};

const failure = (content) => ({ content, failed: true });

/**
 * The tools the user has switched on: JavaScript execution, and the image
 * tools, which also need at least one model they may use.
 */
function enabledTools() {
  const config = state.data.config;
  const tools = [];

  if (config.jsExecution) {
    tools.push(javascriptToolSchema(pick(config.jsToolDescription, DEFAULT_JS_TOOL_DESCRIPTION)));
  }
  if (config.imageGeneration && imageToolModels().length) {
    tools.push(...imageToolSchemas());
  }

  return tools;
}

/**
 * The tools a request to `model` carries: the enabled ones, unless the
 * endpoint reported that the model cannot call tools. Unknown support offers
 * them, as before capabilities existed.
 */
export function toolSchemasFor(model = state.data.config.lastModel) {
  if (capabilitiesFor(model).tools === false) return [];
  return enabledTools();
}

/** Whether a request to `model` offers the image tools, so its images need ids. */
export function offersImageTools(model = state.data.config.lastModel) {
  return toolSchemasFor(model).some((tool) => isImageToolName(tool.function.name));
}

/**
 * Run one call and resolve with `{ content, failed, attachments }`.
 *
 * Only an enabled tool will run: a model can write a call to anything it
 * likes, including `run_javascript` while execution is switched off. Every
 * other failure also comes back as text for the model to read; the one thing
 * that propagates is the user's abort.
 */
export async function runToolCall(call, { signal, chatId } = {}) {
  const offered = enabledTools().some((tool) => tool.function.name === call.name);
  const execute = EXECUTORS[call.name];
  if (!offered || !execute) return failure(`Error: the tool "${call.name}" is not available.`);

  const parsed = parseToolArguments(call.arguments);
  if (!parsed.ok) return failure(`Error: ${parsed.error}`);

  let outcome;
  try {
    outcome = await execute(parsed.value, { signal, chatId });
  } catch (error) {
    if (error.name === 'AbortError' || signal?.aborted) throw error;
    return failure(`Error: ${error.message}`);
  }

  const content = typeof outcome?.content === 'string' ? outcome.content : '';
  const failed = Boolean(outcome?.failed);

  const cap = pickNumber(
    4000,
    state.data.config.toolResultMaxTokens,
    GLOBAL_SETTINGS.toolResultMaxTokens.default,
  );
  return {
    content: clampToolResult(content, cap),
    failed,
    attachments: normalizeAttachments(outcome?.attachments),
  };
}
