import { searchableFiles } from '../../store/state.js';
import { SEARCH_TOOLS } from '../../core/tools.js';
import { searchFiles } from '../retrieval.js';

/**
 * The three file search tools. Each searches the attached files whose
 * profile enables its method, optionally narrowed to the files the model
 * named. A bad query (an invalid regex, say) throws in `services/retrieval.js`
 * and comes back to the model as an error result.
 */

function resolveFiles(method, args, chat) {
  const available = searchableFiles(chat, method);
  const requested = Array.isArray(args.files)
    ? args.files.filter((name) => typeof name === 'string')
    : [];
  const files = requested.length
    ? available.filter((file) => requested.includes(file.name))
    : available;
  const unknown = requested.filter((name) => !available.some((file) => file.name === name));
  return { available, files, unknown };
}

async function run(method, args, { chat, signal }, validate) {
  const problem = validate(args);
  if (problem) return { content: `Error: ${problem}`, failed: true };

  const { available, files, unknown } = resolveFiles(method, args, chat);
  if (!files.length) {
    const names = available.map((file) => `"${file.name}"`).join(', ') || 'none';
    return {
      content: `Error: none of the requested files can be searched with ${SEARCH_TOOLS[method]}. Files it can search: ${names}.`,
      failed: true,
    };
  }

  const result = await searchFiles({ method, files, args, signal });
  if (!unknown.length) return { content: result, failed: false };
  return {
    content:
      `${result}\n\n[Note: not searched, because they are not attached or cannot be searched this way: ${unknown.join(', ')}.]`,
    failed: false,
  };
}

const requireText = (field) => (args) =>
  typeof args[field] === 'string' && args[field].trim() ? '' : `\`${field}\` must be a non-empty string.`;

export function runTextSearch(args, context) {
  return run('text', args, context, requireText('query'));
}

export function runRegexSearch(args, context) {
  return run('regex', args, context, (value) => {
    const problem = requireText('pattern')(value);
    if (problem) return problem;
    if (value.flags !== undefined && typeof value.flags !== 'string') return '`flags` must be a string.';
    return '';
  });
}

export function runSemanticSearch(args, context) {
  return run('embeddings', args, context, requireText('query'));
}
