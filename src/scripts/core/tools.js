import { parseToolArguments } from './tool-calls.js';

/**
 * The tools this app can offer a model: their wire schemas, the wording that
 * tells the model how to use them, and how a call reads in the transcript.
 * Executing them is `services/tools/`.
 */

export const TOOL_NAMES = {
  javascript: 'run_javascript',
  search: 'search_files',
};

export const DEFAULT_JS_TOOL_DESCRIPTION = [
  "Execute JavaScript in the user's web browser, inside the page that is running this chat, and get the result back.",
  'The code is the body of an async function: use `return` to send a value back, and `await` freely. Anything written with `console.log` is captured and returned as well.',
  'You have the real `window`, `document`, `navigator`, `fetch` and so on. This is not Node.js (`require`, `fs` and `process` do not exist) and it is not Python.',
  'Each call runs in a fresh scope, so `let` and `const` do not survive between calls: keep anything you need later on `window`.',
  'Use this tool for any arithmetic, logic or data processing instead of working it out yourself, write real logic rather than hardcoded answers, and if a call throws, fix the code and call again.',
].join(' ');

export const DEFAULT_SEARCH_TOOL_DESCRIPTION = [
  'Search the files the user has attached to this chat and get back the most relevant passages.',
  'Matching is by semantic similarity, so phrase the query as a natural-language description of the information you need rather than as keywords.',
  'Results are excerpts, not whole files: search again with a different query if the first passages do not answer the question.',
  'Base your answer on the returned passages, and say so when they do not contain the answer.',
].join(' ');

export function javascriptToolSchema(description) {
  return {
    type: 'function',
    function: {
      name: TOOL_NAMES.javascript,
      description,
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'The body of an async JavaScript function. Use `return` to produce a result.',
          },
        },
        required: ['code'],
      },
    },
  };
}

/**
 * `fileNames` are the files attached to the chat. Listing them as an enum both
 * tells the model what exists and stops it inventing names.
 */
export function searchToolSchema(description, fileNames) {
  return {
    type: 'function',
    function: {
      name: TOOL_NAMES.search,
      description: `${description}\n\nAttached files:\n${fileNames.map((name) => `- ${name}`).join('\n')}`,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What to look for, described in natural language.',
          },
          files: {
            type: 'array',
            items: { type: 'string', enum: fileNames },
            description: 'Restrict the search to these files. Omit to search every attached file.',
          },
        },
        required: ['query'],
      },
    },
  };
}

/** Characters the tool definitions add to every request, for the context estimate. */
export function toolSchemaChars(tools) {
  return tools.length ? JSON.stringify(tools).length : 0;
}

/** Send-button wording while a tool runs. */
export function toolActivityLabel(name) {
  if (name === TOOL_NAMES.javascript) return 'Running JavaScript';
  if (name === TOOL_NAMES.search) return 'Searching files';
  return 'Running tool';
}

/** Header wording for a tool result row. */
export function toolResultLabel(name) {
  if (name === TOOL_NAMES.javascript) return 'JavaScript result';
  if (name === TOOL_NAMES.search) return 'Search results';
  return name ? `Result: ${name}` : 'Tool result';
}

const JSON_ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '/': '/', '\\': '\\', '"': '"' };

/**
 * Read one string field out of JSON that may still be arriving. Lets the code
 * of a `run_javascript` call appear as it streams instead of all at once when
 * the closing brace lands. `field` must be a plain identifier.
 */
export function partialStringField(raw, field) {
  const start = new RegExp(`"${field}"\\s*:\\s*"`).exec(raw || '');
  if (!start) return '';

  let out = '';
  for (let i = start.index + start[0].length; i < raw.length; i++) {
    const char = raw[i];
    if (char === '"') break;
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = raw[++i];
    if (next === undefined) break;
    if (next === 'u') {
      const hex = raw.slice(i + 1, i + 5);
      if (hex.length < 4) break;
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 4;
      continue;
    }
    out += JSON_ESCAPES[next] ?? next;
  }
  return out;
}

/** A fence longer than any run of backticks inside `text`. */
export function fenceFor(text) {
  const longest = Math.max(0, ...((text || '').match(/`+/g) || []).map((run) => run.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

function fenced(text, language = '') {
  const fence = fenceFor(text);
  return `${fence}${language}\n${text}\n${fence}`;
}

/** How one tool call reads in the transcript, as markdown. */
export function toolCallMarkdown(call) {
  const parsed = parseToolArguments(call.arguments);
  const args = parsed.ok ? parsed.value : {};

  if (call.name === TOOL_NAMES.javascript) {
    const code = typeof args.code === 'string' ? args.code : partialStringField(call.arguments, 'code');
    return `**Running JavaScript:**\n${fenced(code.trim(), 'javascript')}`;
  }

  if (call.name === TOOL_NAMES.search) {
    const query = typeof args.query === 'string' ? args.query : partialStringField(call.arguments, 'query');
    const files = Array.isArray(args.files) && args.files.length ? ` in ${args.files.join(', ')}` : '';
    return `**Searching files${files}:**\n${fenced(query.trim())}`;
  }

  return `**Calling \`${call.name}\`:**\n${fenced(call.arguments || '{}', 'json')}`;
}
