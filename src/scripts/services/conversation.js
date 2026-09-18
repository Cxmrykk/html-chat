import { EVENTS } from '../store/events.js';
import {
  state,
  emit,
  findChat,
  currentChat,
  setGeneration,
  invalidateContext,
  persistChat,
  persistChatIndex,
  persistCurrentChat,
  persistPrefs,
} from '../store/state.js';
import * as chatsRepo from '../data/chats-repo.js';
import { requestCompletion } from './api/completions.js';
import { fullFileContent } from './retrieval.js';
import { extractRunBlocks, executeRunBlock } from './god-mode.js';
import { DEFAULT_GOD_MODE_PROMPT } from '../core/settings-schema.js';
import { isSendable, isThinking, THINKING_ROLE } from '../core/roles.js';
import { truncate } from '../core/format.js';

/** Chat lifecycle and the send/execute loop. */

const MAX_GOD_MODE_LOOPS = 5;

/* ------------------------------------------------------------------ *
 * Chat CRUD
 * ------------------------------------------------------------------ */

export async function createChat() {
  const id = Date.now().toString();
  state.data.chats.unshift({ id, title: 'New Chat', messages: [] });
  state.data.currentChatId = id;
  invalidateContext();
  await persistCurrentChat();
  await persistPrefs();
  emit(EVENTS.CHATS);
  emit(EVENTS.MESSAGES);
  return id;
}

export async function openChat(id) {
  state.data.currentChatId = id;
  invalidateContext();
  await persistPrefs();
  emit(EVENTS.CHATS);
  emit(EVENTS.MESSAGES);
}

export async function removeChat(id) {
  state.data.chats = state.data.chats.filter((chat) => chat.id !== id);
  if (state.data.currentChatId === id) {
    state.data.currentChatId = state.data.chats.length ? state.data.chats[0].id : null;
  }
  invalidateContext();
  await chatsRepo.deleteChat(id, state.data.chats);
  await persistPrefs();
  emit(EVENTS.CHATS);
  emit(EVENTS.MESSAGES);
}

export async function renameChat(id, title) {
  const chat = findChat(id);
  if (!chat) return;
  chat.title = title.trim();
  await persistChat(id);
  await persistChatIndex();
  emit(EVENTS.CHATS);
}

export async function forkChat(messageIndex) {
  const chat = currentChat();
  if (!chat) return;

  const id = Date.now().toString();
  state.data.chats.unshift({
    id,
    title: `${chat.title} (Forked)`,
    messages: JSON.parse(JSON.stringify(chat.messages.slice(0, messageIndex + 1))),
  });
  state.data.currentChatId = id;

  invalidateContext();
  await persistCurrentChat();
  await persistPrefs();
  emit(EVENTS.CHATS);
  emit(EVENTS.MESSAGES);
}

/* ------------------------------------------------------------------ *
 * Messages
 * ------------------------------------------------------------------ */

export async function appendMessage(message, { chatId = state.data.currentChatId } = {}) {
  const chat = findChat(chatId);
  if (!chat) return -1;
  chat.messages.push(message);
  const index = chat.messages.length - 1;
  invalidateContext();
  await persistChat(chatId);
  if (chatId === state.data.currentChatId) emit(EVENTS.MESSAGE_APPENDED, { index });
  return index;
}

export async function updateMessage(index, patch) {
  const chat = currentChat();
  if (!chat || !chat.messages[index]) return;
  Object.assign(chat.messages[index], patch);
  invalidateContext();
  await persistChat();
  emit(EVENTS.MESSAGE, { index });
}

/**
 * Expand or collapse a thinking message. Purely presentational: thinking is
 * never sent, so the context estimate is untouched, and the repaint is
 * `anchored` so the view does not scroll away from the box just clicked.
 */
export async function setThinkingCollapsed(index, collapsed) {
  const chat = currentChat();
  const message = chat?.messages[index];
  if (!isThinking(message)) return;
  message.collapsed = collapsed;
  emit(EVENTS.MESSAGE, { index, anchored: true });
  await persistChat();
}

export async function deleteMessage(index) {
  const chat = currentChat();
  if (!chat) return;
  chat.messages.splice(index, 1);
  invalidateContext();
  await persistChat();
  emit(EVENTS.MESSAGES);
}

export async function truncateMessages(length) {
  const chat = currentChat();
  if (!chat) return;
  chat.messages.length = Math.max(0, length);
  invalidateContext();
  await persistChat();
  emit(EVENTS.MESSAGES_TRUNCATED, { length: chat.messages.length });
}

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

/**
 * The messages that go to the API.
 *
 * Transcript-only rows (errors, thinking, un-run embed placeholders) are
 * dropped, file messages become plain user messages, and everything else is
 * reduced to `{ role, content }` so presentational fields never leave the app.
 */
async function buildPayload(chat) {
  const payload = [];

  if (state.data.config.godMode) {
    payload.push({
      role: 'system',
      content: state.data.config.godModePrompt || DEFAULT_GOD_MODE_PROMPT,
    });
  }

  for (const message of chat.messages) {
    if (!isSendable(message)) continue;
    if (message.role === 'file') {
      const content = message.content || (await fullFileContent(message.fileId));
      payload.push({ role: 'user', content: content || '*File not found.*' });
    } else {
      payload.push({ role: message.role, content: message.content || '' });
    }
  }

  return payload;
}

/**
 * The transcript side of one model turn: an optional thinking message,
 * followed by the assistant's reply. Both are created lazily, on the first
 * text of their kind.
 *
 * Messages are held by reference and their index is looked up when emitting,
 * so deleting or truncating mid-stream cannot redirect writes into whichever
 * message inherits the old index; a removed message simply stops repainting.
 *
 * Renders read the message back out of the store by index, so a chat the user
 * has since navigated away from must stay silent: otherwise every delta
 * repaints whichever message happens to share that index in the chat now on
 * screen. Returning to the chat re-renders it in full anyway.
 */
function createTurn(chat, chatId, { onReplyStart } = {}) {
  const startedAt = Date.now();
  const isVisible = () => chatId === state.data.currentChatId;

  let thinking = null;
  let assistant = null;
  let thinkingFinished = false;

  const repaint = (message, streaming) => {
    const index = chat.messages.indexOf(message);
    if (index !== -1 && isVisible()) emit(EVENTS.MESSAGE, { index, streaming });
  };

  const mount = (message) => {
    chat.messages.push(message);
    invalidateContext();
    if (isVisible()) emit(EVENTS.MESSAGE_APPENDED, { index: chat.messages.length - 1 });
    persistChat(chatId);
  };

  const write = (message, text) => {
    if (message.content === text) return;
    message.content = text;
    repaint(message, true);
  };

  /** Stamp the duration and give the box its final render. Idempotent. */
  const finishThinking = () => {
    if (!thinking || thinkingFinished) return;
    thinkingFinished = true;
    thinking.seconds = (Date.now() - startedAt) / 1000;
    repaint(thinking, false);
  };

  /** Apply the text accumulated so far. Safe to call repeatedly with the same text. */
  const apply = ({ thinking: thought, content }) => {
    if (thought) {
      if (thinking) {
        write(thinking, thought);
      } else {
        thinking = { role: THINKING_ROLE, content: thought, collapsed: true };
        mount(thinking);
      }
    }

    if (content) {
      if (assistant) {
        write(assistant, content);
      } else {
        // The first word of the answer is the end of the thinking.
        finishThinking();
        onReplyStart?.();
        assistant = { role: 'assistant', content };
        mount(assistant);
      }
    }
  };

  /** Final renders and a durable save, however the request ended. */
  const settle = async () => {
    finishThinking();
    if (!thinking && !assistant) return;
    if (assistant) repaint(assistant, false);
    invalidateContext();
    await persistChat(chatId);
  };

  return { apply, settle, hasReply: () => assistant !== null };
}

function buildTitle(text) {
  const lastBreak = text.lastIndexOf('\n\n');
  const source = lastBreak !== -1 ? text.substring(lastBreak + 2).trim() : text;
  return truncate(source, 30);
}

export function abortGeneration() {
  state.runtime.completionAbort?.abort();
  state.runtime.completionAbort = null;
  setGeneration({ active: false, phase: 'idle', loop: 0, maxLoops: 0 });
}

/**
 * Send the conversation to the API.
 *
 * `loopDepth` tracks God Mode re-entry after code execution; `resend` sends the
 * transcript exactly as it stands (retry) without appending a user message and
 * without consuming a God Mode loop; `skipApi` appends the user's message
 * without calling the API at all; `chatId` pins the turn to the chat it started
 * in, so switching chats mid-run cannot redirect it.
 */
export async function sendMessage({
  text = '',
  loopDepth = 0,
  skipApi = false,
  resend = false,
  chatId = null,
} = {}) {
  const isLoop = loopDepth > 0;
  // Both a loop turn and a retry resend the transcript as it already stands.
  const continuing = isLoop || resend;

  if (isLoop && loopDepth >= MAX_GOD_MODE_LOOPS) {
    await appendMessage(
      {
        role: 'error',
        content: `**System Error:** Maximum execution loop depth (${MAX_GOD_MODE_LOOPS}) reached.`,
      },
      { chatId: chatId || state.data.currentChatId },
    );
    return;
  }

  if (!continuing) {
    if (!text.trim()) return;
    if (!state.data.config.key && !skipApi) {
      throw new Error('Please enter your API key in the settings first.');
    }
    if (!state.data.config.lastModel && !skipApi) {
      throw new Error('No model selected. Check the connection settings, or add one under Extra Models.');
    }
    if (!state.data.currentChatId) await createChat();

    const chat = currentChat();
    if (!chat.messages.length) {
      chat.title = buildTitle(text.trim());
      await persistChatIndex();
      emit(EVENTS.CHATS);
    }
    await appendMessage({ role: 'user', content: text.trim() });
    if (skipApi) return;
  }

  const targetChatId = chatId || state.data.currentChatId;
  const chat = findChat(targetChatId);
  if (!chat) return;

  const controller = new AbortController();
  state.runtime.completionAbort = controller;
  setGeneration({
    active: true,
    phase: 'thinking',
    loop: loopDepth,
    maxLoops: MAX_GOD_MODE_LOOPS,
  });

  try {
    const payload = await buildPayload(chat);

    // The phase stays 'thinking' until the answer itself starts, so the send
    // button and the thinking box agree about what the model is doing.
    const turn = createTurn(chat, targetChatId, {
      onReplyStart: () => setGeneration({ phase: 'generating' }),
    });

    let reply = { thinking: '', content: '' };
    let aborted = false;
    let failure = null;

    try {
      reply = await requestCompletion({
        config: state.data.config,
        model: state.data.config.lastModel,
        messages: payload,
        signal: controller.signal,
        onDelta: turn.apply,
      });
      // The resolved reply can differ from the last delta: text held back as a
      // possible opening `<think>` tag is only released at the end.
      turn.apply(reply);
    } catch (error) {
      if (error.name === 'AbortError') aborted = true;
      else failure = error;
    }

    // Before anything else is appended, and before a failure is reported: a
    // partial reply still gets its final render and a save.
    await turn.settle();
    if (failure) throw failure;

    if (aborted) {
      await appendMessage(
        { role: 'error', content: '*[Stopped by user]*' },
        { chatId: targetChatId },
      );
      return;
    }

    // Nothing but reasoning (or nothing at all) came back: say so with an
    // empty reply rather than leaving the turn without an answer.
    if (!turn.hasReply()) {
      await appendMessage(
        { role: 'assistant', content: reply.content },
        { chatId: targetChatId },
      );
    }

    // Only the answer is scanned. Models draft `<run>` blocks while reasoning;
    // those must never execute.
    if (state.data.config.godMode && reply.content) {
      const blocks = extractRunBlocks(reply.content);
      if (blocks.length > 0) {
        for (const code of blocks) {
          if (!state.runtime.generation.active) break;
          const result = await executeRunBlock(code);
          await appendMessage({ role: 'user', content: result }, { chatId: targetChatId });
        }
        if (state.runtime.generation.active) {
          state.runtime.completionAbort = null;
          // Awaited, not returned: `return` would evaluate the call and then run
          // this function's `finally` while the next turn is still in flight,
          // clearing its abort controller and its generation state.
          await sendMessage({ loopDepth: loopDepth + 1, chatId: targetChatId });
          return;
        } else {
          await appendMessage(
            { role: 'error', content: '*[Stopped by user]*' },
            { chatId: targetChatId },
          );
          return;
        }
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      await appendMessage(
        { role: 'error', content: `**Error:**\n\n${error.message}` },
        { chatId: targetChatId },
      );
    }
  } finally {
    state.runtime.completionAbort = null;
    setGeneration({ active: false, phase: 'idle', loop: 0, maxLoops: 0 });
    invalidateContext();
  }
}
