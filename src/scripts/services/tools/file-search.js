import { chatFiles } from '../../store/state.js';
import { searchFiles } from '../retrieval.js';

/** The file search tool: semantic search over the files attached to a chat. */

export async function runFileSearch(args, { chat, signal }) {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return { content: 'Error: `query` must be a non-empty string.', failed: true };

  const attached = chatFiles(chat);
  const requested = Array.isArray(args.files)
    ? args.files.filter((name) => typeof name === 'string')
    : [];

  const files = requested.length
    ? attached.filter((file) => requested.includes(file.name))
    : attached;

  if (!files.length) {
    const names = attached.map((file) => `"${file.name}"`).join(', ') || 'none';
    return {
      content: `Error: none of the requested files is attached to this chat. Attached files: ${names}.`,
      failed: true,
    };
  }

  const result = await searchFiles({ files, query, signal });

  const unknown = requested.filter((name) => !attached.some((file) => file.name === name));
  if (!unknown.length) return { content: result, failed: false };
  return {
    content: `${result}\n\n[Note: not attached to this chat, so not searched: ${unknown.join(', ')}.]`,
    failed: false,
  };
}
