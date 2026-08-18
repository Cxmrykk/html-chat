/** Browser-side JS execution for God Mode `<run>` blocks. */

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export const RUN_BLOCK_PATTERN = /<run>([\s\S]*?)<\/run>/g;

export function extractRunBlocks(text) {
  return [...(text || '').matchAll(RUN_BLOCK_PATTERN)].map((match) => match[1].trim());
}

function stringify(value) {
  try {
    return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/** Run one block and format the transcript entry that goes back to the model. */
export async function executeRunBlock(code) {
  const logs = [];
  const proxyConsole = {
    log: (...args) => logs.push(args.map(stringify).join(' ')),
    error: (...args) => logs.push(`ERROR: ${args.map(stringify).join(' ')}`),
  };

  let result;
  let errorText = '';
  try {
    const execute = new AsyncFunction('console', code);
    result = await execute(proxyConsole);
  } catch (error) {
    errorText = error.toString();
  }

  let output = '**Execution Result:**\n```text\n';
  if (logs.length) output += `${logs.join('\n')}\n`;
  if (result !== undefined) output += `Return: ${stringify(result)}\n`;
  if (errorText) output += `Error: ${errorText}\n`;
  if (!logs.length && result === undefined && !errorText) {
    output += 'Code executed successfully with no output.\n';
  }
  return `${output}\`\`\``;
}
