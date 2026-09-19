import { fenceFor } from '../../core/tools.js';

/** The JavaScript execution tool: runs model-written code in this page. */

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function stringify(value) {
  try {
    return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/**
 * Run `args.code` as the body of an async function and report what happened:
 * captured console output, the return value, and any error. Never throws — a
 * failure is a result the model can read and act on; `failed` marks it for
 * the transcript.
 */
export async function runJavaScript(args) {
  if (typeof args.code !== 'string' || !args.code.trim()) {
    return { content: 'Error: `code` must be a non-empty string.', failed: true };
  }

  const logs = [];
  const proxyConsole = {
    log: (...values) => logs.push(values.map(stringify).join(' ')),
    error: (...values) => logs.push(`ERROR: ${values.map(stringify).join(' ')}`),
  };

  let result;
  let errorText = '';
  try {
    const execute = new AsyncFunction('console', args.code);
    result = await execute(proxyConsole);
  } catch (error) {
    errorText = String(error);
  }

  const lines = [...logs];
  if (result !== undefined) lines.push(`Return: ${stringify(result)}`);
  if (errorText) lines.push(`Error: ${errorText}`);
  if (!lines.length) lines.push('Code executed successfully with no output.');

  const body = lines.join('\n');
  const fence = fenceFor(body);
  return { content: `${fence}text\n${body}\n${fence}`, failed: Boolean(errorText) };
}
