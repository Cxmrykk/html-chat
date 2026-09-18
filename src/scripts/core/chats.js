/**
 * Bringing a chat record — from storage or from an import — up to the current
 * message model.
 *
 * Files used to be inserted into the transcript as `file` messages, either
 * whole or as a retrieval placeholder. A whole file already carries the exact
 * text that was sent, so it becomes an ordinary user message with nothing
 * lost. A placeholder was never sent at all (running it appended a separate
 * user message), so it is dropped.
 */

function normalizeMessage(message) {
  if (!message || typeof message !== 'object') return null;
  if (message.role !== 'file') return message;
  if (message.mode === 'full' && message.content) {
    return { role: 'user', content: message.content };
  }
  return null;
}

/** Idempotent: a current record comes back equivalent. */
export function normalizeChat(chat) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const fileIds = Array.isArray(chat?.fileIds) ? chat.fileIds : [];
  return {
    ...chat,
    messages: messages.map(normalizeMessage).filter(Boolean),
    // The files this chat may search. Ids of files that no longer exist are
    // harmless; they are filtered out wherever the list is read.
    fileIds: [...new Set(fileIds.filter((id) => typeof id === 'string' && id))],
  };
}
