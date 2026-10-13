import { runPreset, CUSTOM_PARSER } from '../core/parsers.js';
import { buildSections } from '../core/sections.js';
import { normalizeProfile } from '../core/rag-profile.js';
import { compileParser } from './user-hooks.js';

/**
 * Splitting a document into sections under a profile. Never throws: a parser
 * that fails (or returns something that is not an array) leaves the whole
 * file as one section, and the failure comes back as `error` for whoever can
 * show it.
 */
export async function parseDocument(profile, text, fileName) {
  const normalized = normalizeProfile(profile);
  const source = text || '';
  let boundaries = [];
  let error = '';

  try {
    if (normalized.parser.preset === CUSTOM_PARSER) {
      const parse = compileParser(normalized.parser.code);
      const result = await parse(source, fileName);
      if (!Array.isArray(result)) {
        throw new Error('The parser must return an array of { start, path } boundaries.');
      }
      boundaries = result;
    } else {
      boundaries = runPreset(normalized.parser.preset, source, normalized.parser.options);
    }
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
    boundaries = [];
  }

  return { sections: buildSections(source, boundaries), error };
}
