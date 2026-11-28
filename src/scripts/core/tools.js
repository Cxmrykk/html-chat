import { parseToolArguments } from './tool-calls.js';
import { truncate } from './format.js';
import { attachmentsOf, attachmentNote } from './attachments.js';

/**
 * The tools this app can offer a model: their wire schemas, the wording that
 * tells the model how to use them, and how a call reads in the transcript.
 * Executing them is `services/tools/`.
 *
 * Older chats can hold calls to tools that no longer exist (the file search
 * tools); they are shown generically, by name and raw arguments.
 */

export const TOOL_NAMES = {
  javascript: 'run_javascript',
  listImageModels: 'list_image_models',
  generateImage: 'generate_image',
  editImage: 'edit_image',
};

const IMAGE_TOOL_NAMES = [TOOL_NAMES.listImageModels, TOOL_NAMES.generateImage, TOOL_NAMES.editImage];

export function isImageToolName(name) {
  return IMAGE_TOOL_NAMES.includes(name);
}

export const DEFAULT_JS_TOOL_DESCRIPTION = [
  "Execute JavaScript in the user's web browser, inside the page that is running this chat, and get the result back.",
  'The code is the body of an async function: use `return` to send a value back, and `await` freely. Anything written with `console.log` is captured and returned as well.',
  'You have the real `window`, `document`, `navigator`, `fetch` and so on. This is not Node.js (`require`, `fs` and `process` do not exist) and it is not Python.',
  'Each call runs in a fresh scope, so `let` and `const` do not survive between calls: keep anything you need later on `window`.',
  'Use this tool for any arithmetic, logic or data processing instead of working it out yourself, write real logic rather than hardcoded answers, and if a call throws, fix the code and call again.',
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

/* ------------------------------------------------------------------ *
 * Image tools
 * ------------------------------------------------------------------ */

/** Per-call options the model may set on an image request, on top of Image Parameters. */
const IMAGE_OPTION_PROPERTIES = {
  size: {
    type: 'string',
    description:
      'Optional size, e.g. "1024x1024". Leave it out unless the user asks for one: models differ in what they accept.',
  },
  quality: {
    type: 'string',
    description: 'Optional quality, e.g. "low", "medium" or "high", for models that take one.',
  },
  background: {
    type: 'string',
    description: 'Optional background, e.g. "transparent" or "opaque", for models that take one.',
  },
};

export const TOOL_IMAGE_OPTIONS = Object.keys(IMAGE_OPTION_PROPERTIES);

const IMAGE_MODEL_PROPERTY = {
  type: 'string',
  description: `An image model returned by ${TOOL_NAMES.listImageModels}.`,
};

const IMAGE_PROMPT_PROPERTY = {
  type: 'string',
  description:
    'What the image should show. Make it complete and self-contained: the image model sees nothing of this conversation.',
};

/** The three image tools, offered together. */
export function imageToolSchemas() {
  return [
    {
      type: 'function',
      function: {
        name: TOOL_NAMES.listImageModels,
        description: `List the image models you may use with ${TOOL_NAMES.generateImage} and ${TOOL_NAMES.editImage}. Call it before picking a model.`,
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: TOOL_NAMES.generateImage,
        description:
          `Generate images from a text prompt with an image model from ${TOOL_NAMES.listImageModels}. ` +
          'The user sees the images. You get back an id for each (like img_1a2b3c4d5e6f), which ' +
          `${TOOL_NAMES.editImage} takes. If the result is not what was asked for, adjust the prompt or try another model.`,
        parameters: {
          type: 'object',
          properties: {
            model: IMAGE_MODEL_PROPERTY,
            prompt: IMAGE_PROMPT_PROPERTY,
            ...IMAGE_OPTION_PROPERTIES,
          },
          required: ['model', 'prompt'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: TOOL_NAMES.editImage,
        description:
          `Edit existing images, or make a new image from them, with an image model from ${TOOL_NAMES.listImageModels}. ` +
          'Images in this conversation are labelled with their ids ([img_...]), and the image tools return the ids of what they make. ' +
          'Not every image model can edit: if one fails, try another.',
        parameters: {
          type: 'object',
          properties: {
            model: IMAGE_MODEL_PROPERTY,
            prompt: {
              type: 'string',
              description: 'The change to make, or what to make from the images. Self-contained, as for generating.',
            },
            images: {
              type: 'array',
              items: { type: 'string' },
              description: 'The ids of the images to start from, e.g. ["img_1a2b3c4d5e6f"].',
            },
            ...IMAGE_OPTION_PROPERTIES,
          },
          required: ['model', 'prompt', 'images'],
        },
      },
    },
  ];
}

/** Characters the tool definitions add to every request, for the context estimate. */
export function toolSchemaChars(tools) {
  return tools.length ? JSON.stringify(tools).length : 0;
}

const ACTIVITY_LABELS = {
  [TOOL_NAMES.javascript]: 'Running JavaScript',
  [TOOL_NAMES.listImageModels]: 'Listing image models',
  [TOOL_NAMES.generateImage]: 'Generating image',
  [TOOL_NAMES.editImage]: 'Editing image',
};

/** Send-button wording while a tool runs. */
export function toolActivityLabel(name) {
  return ACTIVITY_LABELS[name] || 'Running tool';
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

const JAVASCRIPT_VERBS = { active: 'Running JavaScript', past: 'Ran JavaScript', none: 'JavaScript' };

const IMAGE_VERBS = {
  [TOOL_NAMES.listImageModels]: {
    active: 'Listing image models',
    past: 'Listed image models',
    none: 'List image models',
  },
  [TOOL_NAMES.generateImage]: { active: 'Generating image', past: 'Generated image', none: 'Image generation' },
  [TOOL_NAMES.editImage]: { active: 'Editing image', past: 'Edited image', none: 'Image edit' },
};

/**
 * The one-line header of a call: what it does, in the tense of its status
 * (`verb`), and what it was given (`detail`: the first line of the code, or
 * of the image prompt). `scope` is always empty now that no tool is limited
 * to a set of files.
 */
export function toolCallHeadline(call) {
  const tense = tenseOf(call);

  if (call?.name === TOOL_NAMES.javascript) {
    return {
      verb: JAVASCRIPT_VERBS[tense],
      detail: truncate(firstLine(stringArgument(call, 'code')), MAX_HEADLINE_CODE),
      scope: '',
    };
  }

  if (IMAGE_VERBS[call?.name]) {
    const model = stringArgument(call, 'model').trim();
    const verb = IMAGE_VERBS[call.name][tense];
    return {
      verb: model ? `${verb} with ${model}` : verb,
      detail: truncate(firstLine(stringArgument(call, 'prompt')), MAX_HEADLINE_CODE),
      scope: '',
    };
  }

  const name = call?.name || 'tool';
  const verb = tense === 'active' ? `Calling ${name}` : tense === 'past' ? `Called ${name}` : name;
  return { verb, detail: '', scope: '' };
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
 * What an opened call shows above its result, as markdown: the code, or the
 * arguments (pretty-printed once they are complete JSON). Empty when there is
 * nothing to show: no code yet, or no arguments at all (`{}`), as for
 * `list_image_models`. Arguments still streaming in show as they stand.
 */
export function toolCallRequestMarkdown(call) {
  if (call?.name === TOOL_NAMES.javascript) {
    const code = stringArgument(call, 'code').trim();
    return code ? fenced(code, 'javascript') : '';
  }
  const raw = typeof call?.arguments === 'string' ? call.arguments.trim() : '';
  const parsed = parseToolArguments(raw);
  if (parsed.ok) {
    return Object.keys(parsed.value).length ? fenced(JSON.stringify(parsed.value, null, 2), 'json') : '';
  }
  return fenced(raw, 'json');
}

/** One call, request, result and images, as markdown: what copy and the transcript export use. */
export function toolCallMarkdown(call) {
  const { verb } = toolCallHeadline(call);
  const title = `**${verb}:**`;
  const request = toolCallRequestMarkdown(call);
  const outcome =
    typeof call?.result === 'string'
      ? `**Result:**\n${call.result || '*(empty)*'}`
      : `*(${callStatusNote(callStatusOf(call))})*`;
  const images = attachmentsOf(call).map(attachmentNote);
  return [request ? `${title}\n${request}` : title, outcome, ...images].join('\n\n');
}
