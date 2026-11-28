import { buildApiMessages, payloadChars } from './tool-calls.js';
import { CHARS_PER_TOKEN } from './tokens.js';
import { attachmentsOf, sendsImages, imagesToSend } from './attachments.js';
import { isThinking, isSendable } from './roles.js';
import { formatShortCount, truncate } from './format.js';

/**
 * How a chat is told apart: its name, when the user gave it one; otherwise
 * what it would cost to send (estimated tokens of the payload its messages
 * build) and how many images go with it, and a preview of how it began.
 *
 * A named chat is one the user means to keep: Auto-Purge and Reset Chats
 * leave it alone (`core/chat-retention.js`).
 */

const PREVIEW_LENGTH = 120;

/** The chat's name, or '' when it has none. */
export function chatName(chat) {
  return typeof chat?.name === 'string' ? chat.name.trim() : '';
}

/**
 * `{ messages, tokens, images }` for a chat. `images` counts what a request
 * sends as image parts: every user image, each time a message carries it,
 * and with `generated` (Send Generated Images), every image the model made,
 * once each.
 */
export function chatStats(chat, { generated = false } = {}) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const chars = payloadChars(buildApiMessages(messages));

  let images = 0;
  const made = new Set();
  for (const message of messages.filter(isSendable)) {
    if (sendsImages(message)) {
      images += attachmentsOf(message).length;
      continue;
    }
    if (!generated) continue;
    for (const attachment of imagesToSend(message, { generated: true })) made.add(attachment.hash);
  }

  return {
    messages: messages.length,
    tokens: Math.ceil(chars / CHARS_PER_TOKEN),
    images: images + made.size,
  };
}

/** One short line, e.g. "1.2k tokens + 5", or "Empty chat". */
export function describeChatStats({ messages = 0, tokens = 0, images = 0 } = {}) {
  if (!messages) return 'Empty chat';
  const text = `${formatShortCount(tokens)} tokens`;
  return images ? `${text} + ${images}` : text;
}

/** The same in full, for a tooltip, e.g. "1,234 tokens (estimated), 5 images sent". */
export function describeChatStatsFully({ messages = 0, tokens = 0, images = 0 } = {}) {
  if (!messages) return 'Empty chat';
  const text = `${tokens.toLocaleString()} tokens (estimated)`;
  return images ? `${text}, ${images} image${images === 1 ? '' : 's'} sent` : text;
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
