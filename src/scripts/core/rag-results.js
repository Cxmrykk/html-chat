import { CHARS_PER_TOKEN, tokensForLength } from './tokens.js';
import { sectionAt, lineAt, breadcrumb, forwardToLine, backToLine } from './sections.js';
import { extensionOf } from './rag-profile.js';
import { fenceFor } from './tools.js';

/**
 * Turning ranked search candidates into the text handed to the model.
 *
 * A candidate is `{ fileId, sectionIndex, start, end }`, best first: the span
 * to show for one matching section. Candidates are admitted in order until
 * the shared token budget runs out, each bringing the context its profile
 * asks for (neighbouring sections, the file's header lines). Overlapping
 * matches in one file are dropped, and whatever is admitted from a file is
 * put back in document order and merged where spans touch. Files come out in
 * the order of their best match.
 *
 * A document is `{ fileId, fileName, text, sections, lines, profile }`, with
 * a normalized profile.
 */

export function mergeSpans(spans) {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ start: span.start, end: span.end });
  }
  return merged;
}

function spansTokens(spans) {
  return mergeSpans(spans).reduce((sum, span) => sum + tokensForLength(span.end - span.start), 0);
}

/** The tail of each earlier neighbour and the head of each later one, to whole lines. */
function neighborSpans(document, candidate) {
  const { text, sections, profile } = document;
  const limit = profile.maxSectionTokens * CHARS_PER_TOKEN;
  const spans = [];

  for (let k = 1; k <= profile.context.neighbors; k++) {
    const before = sections[candidate.sectionIndex - k];
    if (before) {
      const cut = before.end - limit;
      let start = before.start;
      if (cut > before.start) {
        const snapped = forwardToLine(text, cut, before.end);
        start = snapped < before.end ? snapped : cut;
      }
      spans.push({ start, end: before.end });
    }

    const after = sections[candidate.sectionIndex + k];
    if (after) {
      const cut = after.start + limit;
      let end = after.end;
      if (cut < after.end) {
        const snapped = backToLine(text, cut, after.start);
        end = snapped > after.start ? snapped : cut;
      }
      spans.push({ start: after.start, end });
    }
  }
  return spans;
}

/** The file's first lines, when its profile asks for them above every result. */
function headerSpan(document) {
  const count = document.profile.context.headerLines;
  if (!count) return null;
  const end = count < document.lines.length ? document.lines[count] : document.text.length;
  return end > 0 ? { start: 0, end } : null;
}

function renderSpan(document, span) {
  const section = sectionAt(document.sections, span.start);
  const first = lineAt(document.lines, span.start);
  const last = lineAt(document.lines, Math.max(span.start, span.end - 1));

  const place =
    document.profile.context.breadcrumb && section?.path.length
      ? `${breadcrumb(section.path)} — `
      : '';
  const lines = first === last ? `line ${first}` : `lines ${first}–${last}`;
  const partial = section && (span.start > section.start || span.end < section.end) ? ' (excerpt)' : '';

  const body = document.text.slice(span.start, span.end).replace(/\s+$/, '');
  const fence = fenceFor(body);
  return `${place}${lines}${partial}:\n${fence}${extensionOf(document.fileName)}\n${body}\n${fence}`;
}

function renderDocument(document, spans) {
  const parts = mergeSpans(spans).map((span) => renderSpan(document, span));
  return `\`${document.fileName}\`:\n\n${parts.join('\n\n')}`;
}

/**
 * Returns `{ parts, admitted }`: one rendered block per file, best-matching
 * file first, and how many candidates made it in. At least one candidate is
 * always admitted, even if it alone exceeds the budget.
 */
export function assembleResults({ candidates, documents, maxTokens }) {
  const groups = new Map();
  let used = 0;
  let admitted = 0;

  for (const candidate of candidates) {
    const document = documents.get(candidate.fileId);
    if (!document) continue;

    const group = groups.get(candidate.fileId) || { primary: [], spans: [], tokens: 0 };
    if (group.primary.some((span) => span.start < candidate.end && candidate.start < span.end)) continue;

    const primary = { start: candidate.start, end: candidate.end };
    const extras = neighborSpans(document, candidate);
    if (!group.spans.length) {
      const header = headerSpan(document);
      if (header) extras.push(header);
    }

    let pieces = [primary, ...extras];
    let tokens = spansTokens([...group.spans, ...pieces]) - group.tokens;
    if (admitted > 0 && used + tokens > maxTokens) {
      // Try the match alone before giving up on it.
      pieces = [primary];
      tokens = spansTokens([...group.spans, primary]) - group.tokens;
      if (used + tokens > maxTokens) break;
    }

    group.primary.push(primary);
    group.spans.push(...pieces);
    group.tokens += tokens;
    used += tokens;
    admitted++;
    // Map order is first-admission order: the best-matching file leads.
    groups.set(candidate.fileId, group);
  }

  const parts = [...groups].map(([fileId, group]) => renderDocument(documents.get(fileId), group.spans));
  return { parts, admitted };
}
