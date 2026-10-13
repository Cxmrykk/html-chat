import { state } from '../store/state.js';
import { requestCompletion } from './api/completions.js';
import { parseDocument } from './parsing.js';
import { normalizeProfile, validateProfile } from '../core/rag-profile.js';
import { outlineStats } from '../core/sections.js';
import {
  systemPrompt,
  withDraft,
  extractProfileJSON,
  outlineExcerpt,
  problemsMessage,
} from '../core/rag-assistant.js';

/**
 * The configuration assistant's side of a conversation: one request to the
 * selected chat model, then a check of what came back.
 *
 * The proposed profile is validated and its parser is run on the WHOLE file,
 * not the sample. If that produces something unusable — invalid JSON, a
 * parser that throws, one giant section, most sections oversized — the
 * problems (and an outline of what the parser did) are sent back
 * automatically, up to `MAX_ATTEMPTS` requests in all. Only the final reply
 * is returned; the retries stay out of the conversation.
 *
 * The user's choice of search methods is never the model's to change: it is
 * overwritten on whatever comes back.
 */

const MAX_ATTEMPTS = 3;

async function check(profile, text, fileName) {
  const problems = validateProfile(profile, { forSave: true });
  if (problems.length) return { problems, outline: '' };

  const { sections, error } = await parseDocument(profile, text, fileName);
  if (error) return { problems: [`The parser failed on the whole file: ${error}`], outline: '' };

  const stats = outlineStats(text, sections, { maxSectionTokens: profile.maxSectionTokens });
  const severe = stats.warnings.filter((warning) => warning.severe).map((warning) => warning.message);
  return {
    problems: severe,
    outline: severe.length ? outlineExcerpt(text, sections, profile.maxSectionTokens) : '',
  };
}

/**
 * `history` is the visible conversation, `[{ role, content }]`, ending with
 * the user's new message. Resolves with
 * `{ profile, reply, explanation, problems, attempts }`, where `profile` is
 * null only if no reply ever contained a readable one.
 */
export async function runAssistant({ fileName, text, draft, history, signal, onProgress }) {
  const config = state.data.config;
  const model = config.lastModel;
  if (!config.key) throw new Error('Please enter your API key in the settings first.');
  if (!model) throw new Error('No model selected. Pick one in the model dropdown under the chat first.');

  const current = normalizeProfile(draft);
  const turns = history.map((message, index) => ({
    role: message.role,
    content:
      index === history.length - 1 && message.role === 'user'
        ? withDraft(message.content, current)
        : message.content,
  }));

  let messages = [{ role: 'system', content: systemPrompt({ fileName, text }) }, ...turns];
  let last = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    onProgress?.({
      status: attempt === 1 ? 'Writing...' : `Fixing problems (attempt ${attempt} of ${MAX_ATTEMPTS})...`,
      content: '',
    });

    const reply = await requestCompletion({
      config,
      model,
      messages,
      signal,
      onDelta: (partial) =>
        onProgress?.({
          status: partial.content ? undefined : 'Thinking...',
          content: partial.content,
        }),
    });

    const content = reply.content || '';
    const extracted = extractProfileJSON(content);
    let profile = null;
    let problems = [];
    let outline = '';

    if (!extracted.ok) {
      problems = [extracted.error];
    } else {
      profile = normalizeProfile({
        ...extracted.value,
        id: current.id,
        methods: current.methods,
        updatedAt: current.updatedAt,
      });
      ({ problems, outline } = await check(profile, text, fileName));
    }

    last = {
      profile,
      reply: content,
      explanation: extracted.explanation || '',
      problems,
      attempts: attempt,
    };
    if (!problems.length || attempt === MAX_ATTEMPTS) return last;

    messages = [
      ...messages,
      { role: 'assistant', content },
      { role: 'user', content: problemsMessage(problems, outline) },
    ];
  }

  return last;
}
