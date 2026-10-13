import { pickBoolean, pickInteger, pickNumber } from './values.js';
import {
  PARSER_PRESETS,
  CUSTOM_PARSER,
  DEFAULT_PARSER_CODE,
  isPreset,
  presetForExtension,
  presetOptions,
} from './parsers.js';

/**
 * Search profiles: a named, reusable description of how one kind of document
 * is searched.
 *
 *   { id, name, extensions, methods: { text, regex, embeddings },
 *     parser: { preset, options, code }, maxSectionTokens,
 *     context: { breadcrumb, neighbors, headerLines }, threshold, notes,
 *     updatedAt }
 *
 * A file points at one profile by `profileId`; a file without one cannot be
 * searched. `notes` is written for the chat model: it is added to the search
 * tool description next to every file that uses the profile.
 *
 * Everything that reads a profile reads it through `normalizeProfile`, so a
 * stored, imported, hand-edited or LLM-written value is always complete.
 */

export const SEARCH_METHODS = ['text', 'regex', 'embeddings'];

export const METHOD_LABELS = { text: 'Text', regex: 'Regex', embeddings: 'Embeddings' };

export const METHOD_DESCRIPTIONS = {
  text: 'Literal, case-insensitive phrase search. Best for names, identifiers, error codes and exact wording.',
  regex: 'JavaScript regular expressions. Best for variants and structured tokens such as versions, dates or IDs.',
  embeddings:
    'Semantic similarity. Finds passages that discuss an idea in other words. Needs an embeddings model, and the file is indexed in the background.',
};

const DEFAULT_MAX_SECTION_TOKENS = 1024;
const MIN_SECTION_TOKENS = 50;
const MAX_NEIGHBORS = 5;
const MAX_HEADER_LINES = 50;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function extensionOf(fileName) {
  const match = /\.([^./\\]+)$/.exec(fileName || '');
  return match ? match[1].toLowerCase() : '';
}

/** "md, .markdown *.mdx" or an array -> ['md', 'markdown', 'mdx']. */
export function normalizeExtensions(value) {
  const items = Array.isArray(value) ? value : String(value ?? '').split(/[\s,;]+/);
  const out = new Set();
  for (const item of items) {
    const extension = String(item ?? '')
      .trim()
      .replace(/^\*?\.*/, '')
      .toLowerCase();
    if (extension) out.add(extension);
  }
  return [...out];
}

/** A fresh profile for a file, with the preset its extension suggests. */
export function defaultProfile({ fileName = '' } = {}) {
  const extension = extensionOf(fileName);
  const preset = presetForExtension(extension);
  return {
    id: '',
    name: extension ? `${extension.toUpperCase()} files` : 'New profile',
    extensions: extension ? [extension] : [],
    methods: { text: true, regex: false, embeddings: false },
    parser: { preset, options: presetOptions(preset), code: DEFAULT_PARSER_CODE },
    maxSectionTokens: DEFAULT_MAX_SECTION_TOKENS,
    context: {
      breadcrumb: true,
      neighbors: 0,
      headerLines: extension === 'csv' || extension === 'tsv' ? 1 : 0,
    },
    threshold: 0,
    notes: '',
    updatedAt: 0,
  };
}

function coerceOption(value, spec) {
  if (spec.type === 'number') return pickNumber(spec.default, value);
  if (spec.type === 'boolean') return pickBoolean(spec.default, value);
  return value === undefined || value === null ? spec.default : String(value);
}

function normalizeParser(value, fallbackPreset) {
  const source = value && typeof value === 'object' ? value : {};
  const preset =
    source.preset === CUSTOM_PARSER || isPreset(source.preset) ? source.preset : fallbackPreset;

  // A custom parser with no code is an error to report, not a template to run.
  let code;
  if (typeof source.code === 'string') code = source.code;
  else code = preset === CUSTOM_PARSER ? '' : DEFAULT_PARSER_CODE;

  const options = {};
  if (preset !== CUSTOM_PARSER) {
    const given = source.options && typeof source.options === 'object' ? source.options : {};
    for (const [key, spec] of Object.entries(PARSER_PRESETS[preset].options)) {
      options[key] = coerceOption(given[key], spec);
    }
  }
  return { preset, options, code };
}

/** A complete, well-typed profile from anything. Idempotent. */
export function normalizeProfile(value) {
  const source = value && typeof value === 'object' ? value : {};
  const extensions = normalizeExtensions(source.extensions);
  const methods = {};
  for (const method of SEARCH_METHODS) methods[method] = pickBoolean(false, source.methods?.[method]);
  const context = source.context && typeof source.context === 'object' ? source.context : {};

  return {
    id: typeof source.id === 'string' ? source.id : '',
    name: typeof source.name === 'string' ? source.name.trim() : '',
    extensions,
    methods,
    parser: normalizeParser(source.parser, presetForExtension(extensions[0] || '')),
    maxSectionTokens: Math.max(
      MIN_SECTION_TOKENS,
      pickInteger(DEFAULT_MAX_SECTION_TOKENS, source.maxSectionTokens),
    ),
    context: {
      breadcrumb: pickBoolean(true, context.breadcrumb),
      neighbors: clamp(pickInteger(0, context.neighbors), 0, MAX_NEIGHBORS),
      headerLines: clamp(pickInteger(0, context.headerLines), 0, MAX_HEADER_LINES),
    },
    threshold: clamp(pickNumber(0, source.threshold), 0, 1),
    notes: typeof source.notes === 'string' ? source.notes.trim() : '',
    updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt : 0,
  };
}

/**
 * What stops a normalized profile from running (or, with `forSave`, from
 * being saved), as sentences the user or the assistant can act on.
 */
export function validateProfile(profile, { forSave = false } = {}) {
  const errors = [];
  if (!SEARCH_METHODS.some((method) => profile.methods[method])) {
    errors.push('Select at least one search method.');
  }
  if (profile.parser.preset === CUSTOM_PARSER && !profile.parser.code.trim()) {
    errors.push('The custom parser has no code.');
  }
  if (forSave) {
    if (!profile.name) errors.push('Give the profile a name.');
    if (!profile.extensions.length) errors.push('List at least one file extension for the profile.');
  }
  return errors;
}

export function enabledMethods(profile) {
  return SEARCH_METHODS.filter((method) => Boolean(profile?.methods?.[method]));
}

export function parserLabel(profile) {
  const preset = profile?.parser?.preset;
  if (preset === CUSTOM_PARSER) return 'Custom code';
  return PARSER_PRESETS[preset]?.label || 'Unknown parser';
}

/** The profile as the assistant sees and writes it: no id, no timestamps. */
export function profileForPrompt(value) {
  const profile = normalizeProfile(value);
  const parser =
    profile.parser.preset === CUSTOM_PARSER
      ? { preset: CUSTOM_PARSER, code: profile.parser.code }
      : { preset: profile.parser.preset, options: profile.parser.options };
  return {
    name: profile.name,
    extensions: profile.extensions,
    methods: profile.methods,
    parser,
    maxSectionTokens: profile.maxSectionTokens,
    context: profile.context,
    threshold: profile.threshold,
    notes: profile.notes,
  };
}

const DIFF_FIELDS = [
  ['name', 'name'],
  ['extensions', 'extensions'],
  ['methods', 'search methods'],
  ['parser', 'parser'],
  ['maxSectionTokens', 'section size'],
  ['context', 'result context'],
  ['threshold', 'similarity threshold'],
  ['notes', 'notes for the chat model'],
];

/** Human labels of the fields that differ between two normalized profiles. */
export function diffProfiles(before, after) {
  return DIFF_FIELDS.filter(
    ([key]) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]),
  ).map(([, label]) => label);
}
