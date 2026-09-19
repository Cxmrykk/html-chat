import { parseToolArguments } from './tool-calls.js';
import { truncate } from './format.js';

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

/* ------------------------------------------------------------------ *
 * Call status
 * ------------------------------------------------------------------ */

/**
 * Where a call is in its life:
 *
 *   pending     — still streaming in from the model
 *   running     — being executed
 *   done        — returned a result
 *   error       — returned a result that reports a failure
 *   stopped     — the user stopped the turn before it returned
 *   skipped     — the turn ended without running it (round limit, failed request)
 *   interrupted — found unfinished in storage (a reload, a fork mid-turn)
 */
export const CALL_STATUSES = [
  'pending',
  'running',
  'done',
  'error',
  'stopped',
  'skipped',
  'interrupted',
];

const ACTIVE_STATUSES = ['pending', 'running'];
const RETURNED_STATUSES = ['done', 'error'];

/** A known status for any call, whatever a stored or imported record says. */
export function callStatusOf(call) {
  if (CALL_STATUSES.includes(call?.status)) return call.status;
  return typeof call?.result === 'string' ? 'done' : 'interrupted';
}

const STATUS_NOTES = {
  pending: 'Waiting for the call to finish arriving...',
  running: 'Running...',
  stopped: 'Stopped before it returned.',
  skipped: 'Not run.',
  interrupted: 'Interrupted before it returned.',
};

/** What stands in for the result of a call that has none. */
export function callStatusNote(status) {
  return STATUS_NOTES[status] || 'No result.';
}

/* ------------------------------------------------------------------ *
 * Reading a call
 * ------------------------------------------------------------------ */

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

function argumentsOf(call) {
  const parsed = parseToolArguments(call?.arguments);
  return parsed.ok ? parsed.value : {};
}

/** A string argument, read from complete JSON or from JSON still streaming in. */
function stringArgument(call, field) {
  const value = argumentsOf(call)[field];
  if (typeof value === 'string') return value;
  return partialStringField(call?.arguments, field);
}

function filesOf(call) {
  const files = argumentsOf(call).files;
  return Array.isArray(files) ? files.filter((name) => typeof name === 'string' && name) : [];
}

function firstLine(text) {
  return (
    (text || '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) || ''
  );
}

const MAX_HEADLINE_CODE = 80;

/** 'active' while a call is under way, 'past' once it returned, 'none' if it never did. */
function tenseOf(call) {
  const status = callStatusOf(call);
  if (ACTIVE_STATUSES.includes(status)) return 'active';
  return RETURNED_STATUSES.includes(status) ? 'past' : 'none';
}

const VERBS = {
  [TOOL_NAMES.javascript]: { active: 'Running JavaScript', past: 'Ran JavaScript', none: 'JavaScript' },
  [TOOL_NAMES.search]: { active: 'Searching files', past: 'Searched files', none: 'File search' },
};

/**
 * The one-line header of a call: what it does, in the tense of its status
 * (`verb`), what it was given (`detail`: the first line of the code, or the
 * whole search query), and which files a search was limited to (`scope`).
 */
export function toolCallHeadline(call) {
  const tense = tenseOf(call);
  const known = VERBS[call?.name];

  if (!known) {
    const name = call?.name || 'tool';
    const verb = tense === 'active' ? `Calling ${name}` : tense === 'past' ? `Called ${name}` : name;
    return { verb, detail: '', scope: '' };
  }

  if (call.name === TOOL_NAMES.javascript) {
    return {
      verb: known[tense],
      detail: truncate(firstLine(stringArgument(call, 'code')), MAX_HEADLINE_CODE),
      scope: '',
    };
  }

  return {
    verb: known[tense],
    detail: stringArgument(call, 'query').trim(),
    scope: filesOf(call).join(', '),
  };
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

/**
 * What an opened call shows above its result, as markdown. A search has
 * nothing to add — its query is the header — so opening it shows the
 * passages alone; code is shown whole.
 */
export function toolCallRequestMarkdown(call) {
  if (call?.name === TOOL_NAMES.javascript) {
    return fenced(stringArgument(call, 'code').trim(), 'javascript');
  }
  if (call?.name === TOOL_NAMES.search) return '';
  return fenced(call?.arguments || '{}', 'json');
}

/** One call, request and result, as markdown: what copy and the transcript export use. */
export function toolCallMarkdown(call) {
  const { verb, scope } = toolCallHeadline(call);
  const title = `**${verb}${scope ? ` in ${scope}` : ''}:**`;
  const request =
    call?.name === TOOL_NAMES.search
      ? fenced(stringArgument(call, 'query').trim())
      : toolCallRequestMarkdown(call);
  const outcome =
    typeof call?.result === 'string'
      ? `**Result:**\n${call.result || '*(empty)*'}`
      : `*(${callStatusNote(callStatusOf(call))})*`;
  return `${title}\n${request}\n\n${outcome}`;
}
