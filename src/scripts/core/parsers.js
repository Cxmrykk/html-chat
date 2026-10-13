/**
 * Built-in parsers: pure functions that find where a document's sections
 * begin.
 *
 * Every parser, built-in or custom, returns boundaries, `[{ start, path }]`:
 * `start` is the character offset where a section begins and `path` is its
 * place in the document hierarchy, outermost first. A section runs until the
 * next boundary; `core/sections.js` turns boundaries into sections, so a
 * parser can never produce overlaps or gaps.
 *
 * A profile names one of these presets, or `CUSTOM_PARSER` to run its own
 * code under the same contract (see `services/parsing.js`).
 */

export const CUSTOM_PARSER = 'custom';
export const DEFAULT_PRESET = 'fixed-size';

function clampInteger(value, min, max, fallback) {
  const parsed = typeof value === 'number' ? Math.trunc(value) : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function withoutCR(line) {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/* ------------------------------------------------------------------ *
 * Markdown headings
 * ------------------------------------------------------------------ */

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX_HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;

function parseMarkdownHeadings(text, options) {
  const deepest = clampInteger(options.maxLevel, 1, 6, 6);
  const boundaries = [];
  const stack = [];
  let fence = null;
  let offset = 0;

  for (const raw of text.split('\n')) {
    const start = offset;
    offset += raw.length + 1;
    const line = withoutCR(raw);

    const marker = FENCE.exec(line);
    if (marker) {
      const run = marker[1];
      if (!fence) fence = run;
      else if (run[0] === fence[0] && run.length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;

    const heading = ATX_HEADING.exec(line);
    if (!heading) continue;
    const level = heading[1].length;
    const title = heading[2].trim();
    if (level > deepest || !title) continue;

    stack.length = Math.min(stack.length, level - 1);
    stack[level - 1] = title;
    boundaries.push({ start, path: stack.filter(Boolean) });
  }

  return boundaries;
}

/* ------------------------------------------------------------------ *
 * XML / HTML elements
 * ------------------------------------------------------------------ */

const XML_TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);

const LABEL_ATTRIBUTE = /\b(?:id|name|title|key|label)\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const MAX_LABEL_VALUE = 60;

function labelOf(name, attributes) {
  const match = LABEL_ATTRIBUTE.exec(attributes || '');
  const value = match ? (match[1] ?? match[2] ?? '').trim() : '';
  if (!value) return name;
  const short = value.length > MAX_LABEL_VALUE ? `${value.slice(0, MAX_LABEL_VALUE - 3)}...` : value;
  return `${name} "${short}"`;
}

function parseXmlElements(text, options) {
  const wanted = String(options.tags ?? '')
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  const maxDepth = clampInteger(options.maxDepth, 1, 50, 2);
  const boundaries = [];
  const stack = [];

  for (const match of text.matchAll(XML_TOKEN)) {
    const name = match[2];
    if (!name) continue;
    const lower = name.toLowerCase();

    if (match[1]) {
      let at = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].lower === lower) {
          at = i;
          break;
        }
      }
      if (at !== -1) stack.length = at;
      continue;
    }

    const depth = stack.length + 1;
    const matched = wanted.length ? wanted.includes(lower) : depth <= maxDepth;
    stack.push({ lower, label: labelOf(name, match[3]), matched });

    if (matched) {
      boundaries.push({
        start: match.index,
        path: stack.filter((entry) => entry.matched).map((entry) => entry.label),
      });
    }
    if (match[4] || VOID_ELEMENTS.has(lower)) stack.pop();
  }

  return boundaries;
}

/* ------------------------------------------------------------------ *
 * Paragraphs, lines, fixed size
 * ------------------------------------------------------------------ */

function parseParagraphs(text, options) {
  const minChars = clampInteger(options.minChars, 0, 10_000_000, 300);
  const boundaries = [{ start: 0, path: [] }];
  let last = 0;
  let offset = 0;
  let previousBlank = false;

  for (const raw of text.split('\n')) {
    const start = offset;
    offset += raw.length + 1;
    const blank = raw.trim() === '';
    if (!blank && previousBlank && start - last >= minChars) {
      boundaries.push({ start, path: [] });
      last = start;
    }
    previousBlank = blank;
  }

  return boundaries;
}

function parseLines(text, options) {
  const size = clampInteger(options.linesPerSection, 1, 10_000_000, 1);
  const boundaries = [];
  let offset = 0;
  let count = 0;

  for (const raw of text.split('\n')) {
    if (count % size === 0 && offset < text.length) boundaries.push({ start: offset, path: [] });
    offset += raw.length + 1;
    count++;
  }

  return boundaries;
}

function parseFixedSize(text, options) {
  const size = clampInteger(options.size, 200, 100_000_000, 2000);
  const boundaries = [{ start: 0, path: [] }];
  let start = 0;

  while (text.length - start > size) {
    let next = start + size;
    const newline = text.lastIndexOf('\n', next - 1);
    if (newline + 1 > start + size / 2) {
      next = newline + 1;
    } else {
      const space = text.lastIndexOf(' ', next - 1);
      if (space + 1 > start + size / 2) next = space + 1;
    }
    boundaries.push({ start: next, path: [] });
    start = next;
  }

  return boundaries;
}

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

/**
 * Each preset: a label and description for the wizard and the assistant
 * prompt, the extensions it is the natural default for, its options (typed,
 * with defaults and hints), and the parse function.
 */
export const PARSER_PRESETS = {
  'markdown-headings': {
    label: 'Markdown headings',
    description:
      'One section per ATX heading (#, ##, ...); the path is the chain of headings above it. Headings inside fenced code blocks are ignored.',
    extensions: ['md', 'markdown', 'mdx', 'rmd'],
    options: {
      maxLevel: {
        label: 'Deepest heading level',
        type: 'number',
        default: 6,
        hint: 'Headings deeper than this (1-6) stay inside their parent section.',
      },
    },
    parse: parseMarkdownHeadings,
  },
  'xml-elements': {
    label: 'XML / HTML elements',
    description:
      'One section per element; the path is the chain of enclosing section elements, labelled with an id, name, title, key or label attribute when there is one.',
    extensions: ['xml', 'html', 'htm', 'xhtml', 'svg', 'rss', 'atom', 'xsd', 'plist'],
    options: {
      tags: {
        label: 'Section elements',
        type: 'text',
        default: '',
        hint: 'Comma-separated element names that start a section (e.g. "chapter, section"). Empty: every element down to the maximum depth.',
      },
      maxDepth: {
        label: 'Maximum depth',
        type: 'number',
        default: 2,
        hint: 'Used when no element names are given: elements nested deeper than this stay inside their parent.',
      },
    },
    parse: parseXmlElements,
  },
  paragraphs: {
    label: 'Paragraphs',
    description:
      'A section starts at a paragraph following a blank line. Short paragraphs are grouped until a section reaches the minimum size. No hierarchy.',
    extensions: ['txt', 'text', 'rst', 'adoc', 'org', 'tex'],
    options: {
      minChars: {
        label: 'Minimum characters per section',
        type: 'number',
        default: 300,
        hint: 'Paragraphs are grouped until a section is at least this long. 0 makes every paragraph its own section.',
      },
    },
    parse: parseParagraphs,
  },
  lines: {
    label: 'Lines',
    description:
      'Fixed runs of lines, e.g. one record per section for CSV, TSV, logs and JSON Lines. No hierarchy.',
    extensions: ['csv', 'tsv', 'log', 'jsonl', 'ndjson'],
    options: {
      linesPerSection: {
        label: 'Lines per section',
        type: 'number',
        default: 1,
        hint: 'How many consecutive lines form one section.',
      },
    },
    parse: parseLines,
  },
  'fixed-size': {
    label: 'Fixed size',
    description:
      'Sections of roughly equal length, cut at a line break (or a space) where possible. No hierarchy. The fallback for anything without usable structure.',
    extensions: [],
    options: {
      size: {
        label: 'Characters per section',
        type: 'number',
        default: 2000,
        hint: 'Target length of each section (at least 200).',
      },
    },
    parse: parseFixedSize,
  },
};

export function isPreset(name) {
  return typeof name === 'string' && Object.hasOwn(PARSER_PRESETS, name);
}

/** The preset a new profile for this extension starts with. */
export function presetForExtension(extension) {
  for (const [name, preset] of Object.entries(PARSER_PRESETS)) {
    if (preset.extensions.includes(extension)) return name;
  }
  return DEFAULT_PRESET;
}

/** A preset's options at their defaults. */
export function presetOptions(name) {
  const preset = PARSER_PRESETS[name];
  if (!preset) return {};
  return Object.fromEntries(Object.entries(preset.options).map(([key, spec]) => [key, spec.default]));
}

/** Run a preset. Synchronous and total: any string in, boundaries out. */
export function runPreset(name, text, options = {}) {
  const key = isPreset(name) ? name : DEFAULT_PRESET;
  return PARSER_PRESETS[key].parse(text || '', { ...presetOptions(key), ...options });
}

/** What the custom code editor starts with. */
export const DEFAULT_PARSER_CODE = [
  '// Variables: text (the whole file) and fileName.',
  '// Return one boundary per section, as { start, path }:',
  '//   start: the character offset where the section begins;',
  '//   path:  its place in the document hierarchy, outermost first.',
  '// A section runs until the next boundary. Text before the first',
  '// boundary becomes an untitled preamble section.',
  '//',
  '// Example: one section per line of the form "== Title ==".',
  'const boundaries = [];',
  'for (const match of text.matchAll(/^==\\s*(.+?)\\s*==\\s*$/gm)) {',
  '  boundaries.push({ start: match.index, path: [match[1]] });',
  '}',
  'return boundaries;',
].join('\n');
