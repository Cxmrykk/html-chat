import { parseToolArguments } from './tool-calls.js';
import { truncate } from './format.js';

/**
 * The tools this app can offer a model: their wire schemas, the wording that
 * tells the model how to use them, and how a call reads in the transcript.
 * Executing them is `services/tools/`.
 */

export const TOOL_NAMES = {
  javascript: 'run_javascript',
  text: 'search_text',
  regex: 'search_regex',
  semantic: 'search_semantic',
};

/** The single search tool of older chats, still read when they are shown. */
const LEGACY_SEARCH_TOOL = 'search_files';

/** Each search method's tool. Keys are the methods of `core/rag-profile.js`. */
export const SEARCH_TOOLS = {
  text: TOOL_NAMES.text,
  regex: TOOL_NAMES.regex,
  embeddings: TOOL_NAMES.semantic,
};

const SEARCH_TOOL_NAMES = [...Object.values(SEARCH_TOOLS), LEGACY_SEARCH_TOOL];

export function isSearchTool(name) {
  return SEARCH_TOOL_NAMES.includes(name);
}

export const DEFAULT_JS_TOOL_DESCRIPTION = [
  "Execute JavaScript in the user's web browser, inside the page that is running this chat, and get the result back.",
  'The code is the body of an async function: use `return` to send a value back, and `await` freely. Anything written with `console.log` is captured and returned as well.',
  'You have the real `window`, `document`, `navigator`, `fetch` and so on. This is not Node.js (`require`, `fs` and `process` do not exist) and it is not Python.',
  'Each call runs in a fresh scope, so `let` and `const` do not survive between calls: keep anything you need later on `window`.',
  'Use this tool for any arithmetic, logic or data processing instead of working it out yourself, write real logic rather than hardcoded answers, and if a call throws, fix the code and call again.',
].join(' ');

/** What the model is told about each search method; editable in the advanced settings. */
export const DEFAULT_SEARCH_DESCRIPTIONS = {
  text: [
    'Search the files attached to this chat for sections that contain a phrase.',
    'Matching is literal and case-insensitive: the query must appear in the file exactly as written (apart from case),',
    'so use it for names, identifiers, error codes, numbers and exact wording, and keep queries short.',
  ].join(' '),
  regex: [
    'Search the files attached to this chat for sections matching a JavaScript regular expression.',
    'Use it for variants and structured tokens, for example `v\\d+\\.\\d+` or `(?:GET|POST) /users`.',
    'Give the expression source without slashes in `pattern`; `flags` may contain i, m, s and u.',
  ].join(' '),
  embeddings: [
    'Search the files attached to this chat by meaning.',
    'Matching is by semantic similarity, so phrase the query as a natural-language description of the information you need rather than as keywords.',
  ].join(' '),
};

/** Appended to every search description: the result format is the app's, not the user's. */
const RESULTS_NOTE =
  'Results are sections of the files, each labelled with its place in the document and its line numbers; long sections are shown as an excerpt around the match. ' +
  'Base your answer on the returned passages, and say so when they do not contain the answer.';

const SWITCH_HINTS = {
  text: '`search_text` for exact wording',
  regex: '`search_regex` for patterns and variants',
  embeddings: '`search_semantic` for the same idea in other words',
};

function joinOr(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

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
 * One search method's tool. `files` are the attached files this method may
 * search, `[{ name, notes }]`: listed in the description with their profile's
 * notes, and as an enum, which both tells the model what exists and stops it
 * inventing names. `methods` are all the search methods this chat offers, so
 * the description can point at the others.
 */
export function searchToolSchema(method, { description, files, methods }) {
  const others = methods.filter((entry) => entry !== method && SWITCH_HINTS[entry]).map((entry) => SWITCH_HINTS[entry]);
  const hint = others.length ? ` If this finds nothing useful, try ${joinOr(others)}.` : '';
  const list = files
    .map((file) => {
      const notes = (file.notes || '').replace(/\s+/g, ' ').trim();
      return `- ${file.name}${notes ? `: ${notes}` : ''}`;
    })
    .join('\n');

  const filesParameter = {
    type: 'array',
    items: { type: 'string', enum: files.map((file) => file.name) },
    description: 'Restrict the search to these files. Omit to search every file listed above.',
  };

  const properties =
    method === 'regex'
      ? {
          pattern: {
            type: 'string',
            description: 'A JavaScript regular expression source, without surrounding slashes.',
          },
          flags: {
            type: 'string',
            description: 'Any of i (ignore case), m (^ and $ match at line breaks), s (. matches newlines), u (unicode). Optional.',
          },
          files: filesParameter,
        }
      : {
          query: {
            type: 'string',
            description:
              method === 'text'
                ? 'The phrase to look for, exactly as it appears in the file (case does not matter).'
                : 'What to look for, described in natural language.',
          },
          files: filesParameter,
        };

  return {
    type: 'function',
    function: {
      name: SEARCH_TOOLS[method],
      description: `${description} ${RESULTS_NOTE}${hint}\n\nFiles:\n${list}`,
      parameters: {
        type: 'object',
        properties,
        required: [method === 'regex' ? 'pattern' : 'query'],
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
  if (isSearchTool(name)) return 'Searching files';
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
  [TOOL_NAMES.text]: { active: 'Searching text', past: 'Searched text', none: 'Text search' },
  [TOOL_NAMES.regex]: { active: 'Matching pattern', past: 'Matched pattern', none: 'Regex search' },
  [TOOL_NAMES.semantic]: {
    active: 'Searching by meaning',
    past: 'Searched by meaning',
    none: 'Semantic search',
  },
  [LEGACY_SEARCH_TOOL]: { active: 'Searching files', past: 'Searched files', none: 'File search' },
};

/** What a search looked for: the query, or `/pattern/flags`. */
function searchDetail(call) {
  if (call?.name === TOOL_NAMES.regex) {
    const pattern = stringArgument(call, 'pattern');
    const flags = argumentsOf(call).flags;
    return pattern ? `/${pattern}/${typeof flags === 'string' ? flags : ''}` : '';
  }
  return stringArgument(call, 'query').trim();
}

/**
 * The one-line header of a call: what it does, in the tense of its status
 * (`verb`), what it was given (`detail`: the first line of the code, or the
 * search query or pattern), and which files a search was limited to (`scope`).
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
    detail: searchDetail(call),
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
  if (isSearchTool(call?.name)) return '';
  return fenced(call?.arguments || '{}', 'json');
}

/** One call, request and result, as markdown: what copy and the transcript export use. */
export function toolCallMarkdown(call) {
  const { verb, scope } = toolCallHeadline(call);
  const title = `**${verb}${scope ? ` in ${scope}` : ''}:**`;
  const request = isSearchTool(call?.name) ? fenced(searchDetail(call)) : toolCallRequestMarkdown(call);
  const outcome =
    typeof call?.result === 'string'
      ? `**Result:**\n${call.result || '*(empty)*'}`
      : `*(${callStatusNote(callStatusOf(call))})*`;
  return `${title}\n${request}\n\n${outcome}`;
}
