import { state, findFile } from '../store/state.js';
import * as chunksRepo from '../data/chunks-repo.js';
import { fetchEmbeddings } from './api/embeddings.js';
import { loadDocument } from './indexing.js';
import { textPattern, compilePattern, findMatches, hitsBySection } from '../core/rag-search.js';
import { windowAround } from '../core/sections.js';
import { assembleResults } from '../core/rag-results.js';
import { CHARS_PER_TOKEN } from '../core/tokens.js';
import { pickNumber } from '../core/values.js';
import { GLOBAL_SETTINGS } from '../core/settings-schema.js';

/**
 * Searching documents by one method and producing the text handed to the
 * model. Candidates from every file compete for one Max RAG Tokens budget:
 *
 *   - text and regex rank sections by how many matches they hold, then by
 *     file and position;
 *   - embeddings rank units by similarity.
 *
 * A file that could not be searched properly is named in a trailing note —
 * without it, the model would read "no results" as "the documents do not
 * say".
 */

const NO_MATCHES = 'No matching passages were found.';

function budget() {
  return pickNumber(5000, state.data.config.maxRagTokens, GLOBAL_SETTINGS.maxRagTokens.default);
}

function lexicalCandidates(method, documents, args) {
  let regex;
  if (method === 'regex') {
    const compiled = compilePattern(args.pattern, args.flags);
    if (!compiled.ok) throw new Error(`Invalid regular expression: ${compiled.error}`);
    regex = compiled.regex;
  } else {
    const query = String(args.query ?? '').trim();
    if (!query) throw new Error('The query is empty.');
    regex = textPattern(query);
  }

  const candidates = [];
  const notes = [];
  let order = 0;

  for (const document of documents.values()) {
    const { matches, truncated } = findMatches(document.text, regex);
    if (truncated) {
      notes.push(
        `"${document.fileName}" has more than ${matches.length} matches; only the first ${matches.length} were counted, so a narrower query will rank better.`,
      );
    }

    const maxChars = document.profile.maxSectionTokens * CHARS_PER_TOKEN;
    for (const [sectionIndex, hit] of hitsBySection(document.sections, matches)) {
      const span = windowAround(document.text, document.sections[sectionIndex], hit.first, maxChars);
      candidates.push({
        fileId: document.fileId,
        sectionIndex,
        start: span.start,
        end: span.end,
        score: hit.count,
        order: order++,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.order - b.order);
  return { candidates, notes };
}

async function semanticCandidates(documents, args, signal) {
  const query = String(args.query ?? '').trim();
  if (!query) throw new Error('The query is empty.');

  // Far more than the budget can hold, so deduplication has slack.
  const limit = Math.max(100, Math.ceil(budget() / 25));
  const [vector] = await fetchEmbeddings(state.data.config, [query], signal);

  const candidates = [];
  const notes = [];
  for (const document of documents.values()) {
    signal?.throwIfAborted();
    const meta = findFile(document.fileId);
    const result = await chunksRepo.scoreChunks(document.fileId, vector, {
      threshold: document.profile.threshold,
      limit,
    });

    if (result.vectorCount === 0) {
      notes.push(`"${document.fileName}" has not been indexed for semantic search yet and was not searched.`);
    } else if ((meta?.progress ?? 0) < 100) {
      notes.push(
        `"${document.fileName}" is only ${meta?.progress ?? 0}% indexed, so its results may be incomplete.`,
      );
    }

    for (const scored of result.scored) {
      if (scored.end > document.text.length || !document.sections[scored.sectionIndex]) continue;
      candidates.push({
        fileId: document.fileId,
        sectionIndex: scored.sectionIndex,
        start: scored.start,
        end: scored.end,
        score: scored.score,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return { candidates, notes };
}

function summaryLine(candidates, admitted) {
  const files = new Set(candidates.map((candidate) => candidate.fileId)).size;
  const total =
    `${candidates.length} matching section${candidates.length === 1 ? '' : 's'} ` +
    `in ${files} file${files === 1 ? '' : 's'}`;
  if (admitted < candidates.length) {
    return `Found ${total}; showing the ${admitted} with the most matches. Narrow the query to see the others.`;
  }
  return `Found ${total}.`;
}

/**
 * Search prepared documents (a Map of fileId -> document, see
 * `services/indexing.js#loadDocument`) with `method` ('text', 'regex' or
 * 'embeddings'). Throws on a bad query, for the caller to report.
 */
export async function searchDocuments({ method, documents, args, signal, notes: extraNotes = [] }) {
  const { candidates, notes } =
    method === 'embeddings'
      ? await semanticCandidates(documents, args, signal)
      : lexicalCandidates(method, documents, args);

  for (const document of documents.values()) {
    if (document.error) {
      notes.push(
        `"${document.fileName}" could not be split into sections (${document.error}), so it was searched as a single section.`,
      );
    }
  }

  const { parts, admitted } = assembleResults({ candidates, documents, maxTokens: budget() });

  let body = NO_MATCHES;
  if (admitted) {
    const summary = method === 'embeddings' ? '' : summaryLine(candidates, admitted);
    body = [summary, ...parts].filter(Boolean).join('\n\n');
  }

  const allNotes = [...extraNotes, ...notes];
  return allNotes.length ? `${body}\n\n${allNotes.map((note) => `[Note: ${note}]`).join('\n')}` : body;
}

/** Search stored files: load (and if need be re-parse) each one, then search. */
export async function searchFiles({ method, files, args, signal }) {
  const documents = new Map();
  const notes = [];

  for (const meta of files) {
    signal?.throwIfAborted();
    const document = await loadDocument(meta);
    if (document) documents.set(meta.id, document);
    else notes.push(`"${meta.name}" is not configured for search and was skipped.`);
  }

  if (!documents.size) {
    return `${NO_MATCHES}\n\n${notes.map((note) => `[Note: ${note}]`).join('\n')}`;
  }
  return searchDocuments({ method, documents, args, signal, notes });
}
