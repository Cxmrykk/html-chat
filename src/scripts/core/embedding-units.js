import { CHARS_PER_TOKEN } from './tokens.js';
import { splitWindows } from './sections.js';
import { isUnembeddable } from './progress.js';

/**
 * Embedding units: what gets a vector for semantic search.
 *
 * Every section becomes one unit, or several when it is longer than the
 * profile's section size. A unit's text is its breadcrumb (file name and
 * section path) followed by its span of the file, so a passage that only
 * makes sense in context still embeds with that context. Units are stored as
 * chunk records: `{ index, sectionIndex, start, end, text, vector }`.
 */

const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0));

export function buildUnits(text, sections, { fileName, maxSectionTokens }) {
  const maxChars = Math.max(200, maxSectionTokens * CHARS_PER_TOKEN);
  const units = [];
  for (const section of sections) {
    const header = [fileName, ...section.path].filter(Boolean).join(' › ');
    for (const window of splitWindows(text, section.start, section.end, maxChars)) {
      const body = text.slice(window.start, window.end);
      if (!body.trim()) continue;
      units.push({
        index: units.length,
        sectionIndex: section.index,
        start: window.start,
        end: window.end,
        text: header ? `${header}\n\n${body}` : body,
      });
    }
  }
  return units;
}

/**
 * Carry vectors over from the previous records wherever a unit's text is
 * unchanged. `changed` is false only when the stored records already match
 * exactly, so the caller can skip every write.
 */
export async function reconcileUnits(units, previous) {
  const reusable = new Map();
  for (const record of previous) {
    if (record.vector && !reusable.has(record.text)) reusable.set(record.text, record.vector);
  }

  let changed = units.length !== previous.length;
  const out = [];
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    const vector = reusable.get(unit.text) || null;
    const old = previous[i];
    if (
      !old ||
      old.text !== unit.text ||
      old.start !== unit.start ||
      old.end !== unit.end ||
      old.sectionIndex !== unit.sectionIndex ||
      !old.vector !== !vector
    ) {
      changed = true;
    }
    out.push({ ...unit, vector });
    if (i % 500 === 0) await yieldToEventLoop();
  }
  return { units: out, changed };
}

/** How many units can never be embedded under the current batch limit. */
export async function countUnembeddable(units, limits) {
  let count = 0;
  for (let i = 0; i < units.length; i++) {
    if (!units[i].vector && isUnembeddable(units[i], limits)) count++;
    if (i % 1000 === 0) await yieldToEventLoop();
  }
  return count;
}
