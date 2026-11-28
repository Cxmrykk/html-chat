import { buildApiMessages, payloadChars } from './tool-calls.js';
import { CHARS_PER_TOKEN } from './tokens.js';
import { allImagesOf, uniqueImages } from './attachments.js';
import { isThinking } from './roles.js';
import { formatCompactCount, truncate } from './format.js';

/**
 * How a chat is told apart, now that chats have no names: what it would cost
 * to send (estimated tokens of the payload its messages build), how many
 * images it holds, and a preview of how it began.
 */

const PREVIEW_LENGTH = 120;

/** `{ messages, tokens, images }` for a chat. Images are counted once each, by hash. */
export function chatStats(chat) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const chars = payloadChars(buildApiMessages(messages));
  return {
    messages: messages.length,
    tokens: Math.ceil(chars / CHARS_PER_TOKEN),
    images: uniqueImages(messages.flatMap(allImagesOf)).length,
  };
}

/** One line, e.g. "1.2k tokens · 2 images", or "Empty chat". */
export function describeChatStats({ messages = 0, tokens = 0, images = 0 } = {}) {
  if (!messages) return 'Empty chat';
  const parts = [`${formatCompactCount(tokens) || tokens} tokens`];
  if (images) parts.push(`${images} image${images === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function hasText(message) {
  return typeof message?.content === 'string' && Boolean(message.content.trim());
}

/** The start of the first user message (or of any text), on one line. Empty when there is none. */
export function chatPreview(chat) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const first =
    messages.find((message) => message?.role === 'user' && hasText(message)) ||
    messages.find((message) => !isThinking(message) && hasText(message));
  if (!first) return '';
  return truncate(first.content.replace(/\s+/g, ' ').trim(), PREVIEW_LENGTH);
}
