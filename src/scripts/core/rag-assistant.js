import { PARSER_PRESETS } from './parsers.js';
import { profileForPrompt } from './rag-profile.js';
import { sectionLabel, sectionTokens } from './sections.js';
import { fenceFor } from './tools.js';

/**
 * Everything the configuration assistant says to the model, and reading its
 * reply: the hard-coded instructions, the sample and statistics of the file,
 * the current draft attached to each request, and the profile JSON pulled
 * back out of the answer. Pure; the conversation itself is
 * `services/rag-assistant.js`.
 */

const SAMPLE_LIMIT = 16000;
const HEAD_CHARS = 8000;
const MIDDLE_CHARS = 4000;
const TAIL_CHARS = 4000;
const OUTLINE_ROWS = 25;

export const GENERATE_INSTRUCTION =
  'Configure search for this document. Choose the parser (a preset if one fits, custom code otherwise) and its options, ' +
  'the section size, the result context, the notes for the chat model, and a name and extensions for this kind of document.';

export const GENERATE_DISPLAY = 'Generate a configuration for this file.';

/* ------------------------------------------------------------------ *
 * The file
 * ------------------------------------------------------------------ */

function cutAtLine(text, start, length) {
  let end = Math.min(text.length, start + length);
  const newline = text.lastIndexOf('\n', end - 1);
  if (newline > start + length / 2) end = newline + 1;
  return { text: text.slice(start, end), end };
}

function lineStartNear(text, offset) {
  const at = Math.max(0, offset);
  const newline = text.indexOf('\n', at);
  return newline === -1 || newline - at > 500 ? at : newline + 1;
}

function omitted(from, to) {
  return to > from ? `\n[… ${(to - from).toLocaleString('en-US')} characters omitted …]\n` : '';
}

/** The whole file when it is small; otherwise its start, middle and end. */
export function buildSample(text) {
  const source = text || '';
  if (source.length <= SAMPLE_LIMIT) return source;

  const head = cutAtLine(source, 0, HEAD_CHARS);
  const middleStart = Math.max(
    head.end,
    lineStartNear(source, Math.floor(source.length / 2 - MIDDLE_CHARS / 2)),
  );
  const middle = cutAtLine(source, middleStart, MIDDLE_CHARS);
  const tailStart = Math.max(middle.end, lineStartNear(source, source.length - TAIL_CHARS));

  return [
    head.text,
    omitted(head.end, middleStart),
    middle.text,
    omitted(middle.end, tailStart),
    source.slice(tailStart),
  ].join('');
}

/**
 * Cheap facts about the whole file, so the model sees its structure even
 * where the sample misses it.
 */
export function documentStats(text) {
  const source = text || '';
  const lines = source.split('\n');
  let blank = 0;
  let longest = 0;
  let totalLength = 0;
  let fences = 0;
  const headings = [0, 0, 0, 0, 0, 0];

  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    longest = Math.max(longest, line.length);
    totalLength += line.length;
    if (!line.trim()) {
      blank++;
      continue;
    }
    if (/^ {0,3}(```|~~~)/.test(line)) fences++;
    const heading = /^ {0,3}(#{1,6})[ \t]/.exec(line);
    if (heading) headings[heading[1].length - 1]++;
  }

  const tags = new Map();
  for (const match of source.matchAll(/<([A-Za-z_][\w:.-]*)[\s>/]/g)) {
    tags.set(match[1], (tags.get(match[1]) || 0) + 1);
    if (tags.size > 2000) break;
  }
  const topTags = [...tags].sort((a, b) => b[1] - a[1]).slice(0, 12);

  const probe = lines.filter((line) => line.trim()).slice(0, 200);
  const delimiters = {};
  for (const [name, char] of [
    ['comma', ','],
    ['tab', '\t'],
    ['semicolon', ';'],
    ['pipe', '|'],
  ]) {
    const counts = probe.map((line) => line.split(char).length - 1);
    const average = counts.length ? counts.reduce((sum, count) => sum + count, 0) / counts.length : 0;
    const consistent = counts.length > 1 && counts[0] > 0 && counts.every((count) => count === counts[0]);
    delimiters[name] = { average: Math.round(average * 10) / 10, consistent };
  }

  return {
    characters: source.length,
    lines: lines.length,
    blankLines: blank,
    averageLineLength: lines.length ? Math.round(totalLength / lines.length) : 0,
    longestLine: longest,
    fencedCodeBlocks: Math.floor(fences / 2),
    markdownHeadings: headings,
    topTags,
    delimiters,
  };
}

export function formatStats(stats) {
  const number = (value) => value.toLocaleString('en-US');
  const tags = stats.topTags.length
    ? stats.topTags.map(([name, count]) => `${name} ×${number(count)}`).join(', ')
    : 'none';
  const delimiters = Object.entries(stats.delimiters)
    .map(([name, { average, consistent }]) => `${name} ${average}${consistent ? ' (same on every line)' : ''}`)
    .join(', ');

  return [
    `- Size: ${number(stats.characters)} characters, ${number(stats.lines)} lines (${number(stats.blankLines)} blank); average line ${stats.averageLineLength} characters, longest ${number(stats.longestLine)}.`,
    `- Markdown headings by level (# to ######): ${stats.markdownHeadings.join(', ')}.`,
    `- Fenced code blocks: ${stats.fencedCodeBlocks}.`,
    `- Most frequent XML/HTML tags: ${tags}.`,
    `- Delimiters per non-blank line (first 200 lines): ${delimiters}.`,
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * Instructions
 * ------------------------------------------------------------------ */

const EXAMPLE_PROFILE = {
  name: 'Markdown documentation',
  extensions: ['md', 'markdown'],
  methods: { text: true, regex: false, embeddings: true },
  parser: { preset: 'markdown-headings', options: { maxLevel: 3 } },
  maxSectionTokens: 800,
  context: { breadcrumb: true, neighbors: 0, headerLines: 0 },
  threshold: 0,
  notes:
    'Product documentation organised by headings. Use search_text for feature and setting names, and search_semantic for how-to questions.',
};

function presetDocs() {
  return Object.entries(PARSER_PRESETS)
    .map(([name, preset]) => {
      const options = Object.entries(preset.options)
        .map(
          ([key, spec]) =>
            `    - ${key} (${spec.type}, default ${JSON.stringify(spec.default)}): ${spec.hint}`,
        )
        .join('\n');
      return `- "${name}": ${preset.description}\n  Options:\n${options}`;
    })
    .join('\n');
}

const INSTRUCTIONS = [
  'You configure how a chat application searches one kind of document. You are shown statistics about a file and a sample of it, and you reply with a search profile.',
  '',
  '# How search works',
  '',
  'A parser splits the document into sections. Each section has a path: its place in the document hierarchy, outermost first, such as ["Installation", "Linux"]. Search results are whole sections, labelled with their path and line numbers, so a section should be a self-contained unit a reader would want to see whole: one function\'s documentation, one subsection of a chapter, one record, one log entry. Aim for sections of roughly 50 to 800 tokens (a token is about four characters).',
  '',
  'The user has already chosen which search methods the chat model gets. Do not change "methods":',
  '- text: literal, case-insensitive phrase search (tool search_text).',
  '- regex: JavaScript regular expressions (tool search_regex).',
  '- embeddings: semantic similarity (tool search_semantic); every section is embedded, in pieces of maxSectionTokens when longer.',
  '',
  'Sections longer than maxSectionTokens are shown to the chat model as an excerpt around the match.',
  '',
  '# The profile',
  '',
  '```json',
  JSON.stringify(EXAMPLE_PROFILE, null, 2),
  '```',
  '',
  '- name: a short name for this kind of document (not for this particular file).',
  '- extensions: file extensions this profile suits, lower case, without dots.',
  '- parser: a preset with its options, or {"preset": "custom", "code": "..."}.',
  '- maxSectionTokens: integer, at least 50.',
  '- context.breadcrumb: label each result with its path. Keep it true unless the paths carry no information.',
  '- context.neighbors: 0 to 5 sections before and after each match to include as well. Use 1 when sections are small and depend on their surroundings.',
  '- context.headerLines: 0 to 50 lines from the top of the file always shown above its results, e.g. 1 for a CSV header row.',
  '- threshold: 0 to 1, the minimum similarity for embeddings matches. Leave it at 0 unless there is a reason.',
  "- notes: one to three sentences added to the search tool description for the chat model: what these documents are and how to search them well (what identifiers look like, which method suits which kind of question). Write about the kind of document, not this file's contents, because the profile is reused for other files.",
  '',
  '# Parser presets',
  '',
  presetDocs(),
  '',
  '# Custom parsers',
  '',
  'Use "custom" only when no preset fits. "code" is the body of an async JavaScript function that receives `text` (the whole file) and `fileName`, and returns an array of boundaries: { start, path }, where start is the character offset at which a section begins and path is an array of strings. A section runs until the next boundary; text before the first boundary becomes an untitled preamble. The code must handle any file of this kind, not only the sample; must be fast on files of several megabytes (one pass, such as a single matchAll or line loop, never nested scans); must not throw; and must not use the network or the DOM.',
  '',
  '# Replying',
  '',
  'Reply with a short explanation of your choices in plain prose (a few sentences), then the complete profile as a single ```json fenced block. Always return the complete profile, never a partial one, and make sure it is valid JSON (newlines and quotes inside "code" must be escaped).',
  'When the user asks for a change, change what they asked for and keep everything else as in the current configuration, which is attached to their latest message.',
  'If the application reports problems with your profile, fix them and reply again in the same format.',
].join('\n');

/** The system message: the instructions, then the file itself. */
export function systemPrompt({ fileName, text }) {
  const source = text || '';
  const sample = buildSample(source);
  const fence = fenceFor(sample);
  return [
    INSTRUCTIONS,
    '',
    '# The document',
    '',
    `File name: ${fileName}`,
    '',
    'Statistics for the whole file:',
    formatStats(documentStats(source)),
    '',
    source.length > SAMPLE_LIMIT
      ? 'Sample: the start, middle and end of the file, with the omitted stretches marked.'
      : 'The whole file:',
    `${fence}\n${sample}\n${fence}`,
  ].join('\n');
}

/** The user's latest request with the current draft attached. */
export function withDraft(instruction, draft) {
  const json = JSON.stringify(profileForPrompt(draft), null, 2);
  const fence = fenceFor(json);
  return (
    `${instruction}\n\n` +
    'Current configuration (authoritative: the user may have edited it by hand since your last reply):\n' +
    `${fence}json\n${json}\n${fence}`
  );
}

/* ------------------------------------------------------------------ *
 * Reading the reply
 * ------------------------------------------------------------------ */

function parseObject(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The profile object in a reply, and the prose around it. Prefers the last
 * `json` fenced block, then any fenced block, then the outermost braces.
 */
export function extractProfileJSON(reply) {
  const text = reply || '';
  const blocks = [
    ...text.matchAll(/(`{3,}|~{3,})[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*(?:\n|$)/g),
  ].map((match) => ({ raw: match[0], language: match[2].toLowerCase(), body: match[3] }));

  const ordered = [
    ...blocks.filter((block) => block.language === 'json').reverse(),
    ...blocks.filter((block) => block.language !== 'json').reverse(),
  ];
  for (const block of ordered) {
    const value = parseObject(block.body);
    if (value) return { ok: true, value, explanation: text.replace(block.raw, '').trim() };
  }

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    const value = parseObject(text.slice(first, last + 1));
    if (value) return { ok: true, value, explanation: text.slice(0, first).trim() };
  }

  return {
    ok: false,
    error: 'The reply did not contain the profile as valid JSON in a ```json fenced block.',
    explanation: text.trim(),
  };
}

/** A compact view of how a parser split the file, for the model to inspect. */
export function outlineExcerpt(text, sections, maxSectionTokens) {
  const rows = sections.slice(0, OUTLINE_ROWS).map((section) => {
    const indent = '  '.repeat(Math.max(0, section.path.length - 1));
    const label = section.preamble ? '(preamble)' : sectionLabel(section, text) || '(blank)';
    const tokens = sectionTokens(section);
    return `${indent}- ${label} (~${tokens} tokens${tokens > maxSectionTokens ? ', over the limit' : ''})`;
  });
  if (sections.length > OUTLINE_ROWS) rows.push(`… and ${sections.length - OUTLINE_ROWS} more sections`);
  return rows.join('\n');
}

export function problemsMessage(problems, outline) {
  const list = problems.map((problem) => `- ${problem}`).join('\n');
  const view = outline ? `\n\nThis is how your parser split the whole file:\n${outline}` : '';
  return `Your profile has problems:\n${list}${view}\n\nFix them and reply again in the same format, with the complete profile.`;
}
