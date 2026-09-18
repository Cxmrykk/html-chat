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
import { toolSchemasFor, runToolCall } from './tools/index.js';
import { buildApiMessages, toolCallsSignature } from '../core/tool-calls.js';
import { GLOBAL_SETTINGS } from '../core/settings-schema.js';
import { isCollapsible, THINKING_ROLE, TOOL_ROLE } from '../core/roles.js';
import { pickInteger } from '../core/values.js';
import { truncate } from '../core/format.js';

/** Chat lifecycle and the send / tool-call loop. */

const IDLE = { active: false, phase: 'idle', tool: null, loop: 0, maxLoops: 0 };

/* ------------------------------------------------------------------ *
 * Chat CRUD
 * ------------------------------------------------------------------ */

export async function createChat() {
  const id = Date.now().toString();
  state.data.chats.unshift({ id, title: 'New Chat', messages: [], fileIds: [] });
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
    fileIds: [...(chat.fileIds || [])],
  });
  state.data.currentChatId = id;

  invalidateContext();
  await persistCurrentChat();
  await persistPrefs();
  emit(EVENTS.CHATS);
  emit(EVENTS.MESSAGES);
}

/**
 * Attach a file to the current chat, or detach it. Attached files are what the
 * model's file search covers; there is no other way for a file to reach a chat.
 * Returns whether the file is attached afterwards.
 */
export async function toggleChatFile(fileId) {
  if (!state.data.currentChatId) await createChat();
  const chat = currentChat();
  if (!chat) return false;

  const ids = new Set(chat.fileIds || []);
  const attached = !ids.has(fileId);
  if (attached) ids.add(fileId);
  else ids.delete(fileId);
  chat.fileIds = [...ids];

  // The tool definition lists the attached files, so the estimate moves too.
  invalidateContext();
  await persistChat();
  emit(EVENTS.CHAT_FILES);
  return attached;
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
 * Expand or collapse a thinking box or a tool result. Purely presentational:
 * what is sent does not depend on it, so the context estimate is untouched,
 * and the repaint is `anchored` so the view does not scroll away from the box
 * just clicked.
 */
export async function setCollapsed(index, collapsed) {
  const chat = currentChat();
  const message = chat?.messages[index];
  if (!isCollapsible(message)) return;
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
 * The transcript side of one model turn: an optional thinking message,
 * followed by the assistant's reply — its text, its tool calls, or both. Each
 * is created lazily, on the first sign of its kind.
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

  /** Stamp the duration and give the box its final render. Idempotent. */
  const finishThinking = () => {
    if (!thinking || thinkingFinished) return;
    thinkingFinished = true;
    thinking.seconds = (Date.now() - startedAt) / 1000;
    repaint(thinking, false);
  };

  /** Apply everything accumulated so far. Safe to call repeatedly with the same reply. */
  const apply = ({ thinking: thought, content, toolCalls = [] }) => {
    if (thought) {
      if (!thinking) {
        thinking = { role: THINKING_ROLE, content: thought, collapsed: true };
        mount(thinking);
      } else if (thinking.content !== thought) {
        thinking.content = thought;
        repaint(thinking, true);
      }
    }

    if (!content && !toolCalls.length) return;

    if (!assistant) {
      // The first word of the answer — or the first tool call — is the end of
      // the thinking.
      finishThinking();
      onReplyStart?.();
      assistant = { role: 'assistant', content: content || '' };
      if (toolCalls.length) assistant.toolCalls = toolCalls;
      mount(assistant);
      return;
    }

    let changed = false;
    if (content && assistant.content !== content) {
      assistant.content = content;
      changed = true;
    }
    if (toolCallsSignature(assistant.toolCalls) !== toolCallsSignature(toolCalls)) {
      assistant.toolCalls = toolCalls;
      changed = true;
    }
    if (changed) repaint(assistant, true);
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
  setGeneration(IDLE);
}

function appendStopped(chatId) {
  return appendMessage({ role: 'error', content: '*[Stopped by user]*' }, { chatId });
}

/**
 * One request to the API, streamed into the transcript. Resolves with the
 * complete reply and whether the user stopped it; a partial reply is given its
 * final render and saved before any failure is rethrown.
 */
async function requestTurn({ chat, chatId, signal, forceAnswer }) {
  // The phase stays 'thinking' until the answer itself starts, so the send
  // button and the thinking box agree about what the model is doing.
  const turn = createTurn(chat, chatId, {
    onReplyStart: () => setGeneration({ phase: 'generating' }),
  });

  let reply = { thinking: '', content: '', toolCalls: [] };
  let aborted = false;
  let failure = null;

  try {
    reply = await requestCompletion({
      config: state.data.config,
      model: state.data.config.lastModel,
      messages: buildApiMessages(chat.messages),
      tools: toolSchemasFor(chat),
      forceAnswer,
      signal,
      onDelta: turn.apply,
    });
    // The resolved reply can differ from the last delta: text held back as a
    // possible opening `<think>` tag is only released at the end.
    turn.apply(reply);
  } catch (error) {
    if (error.name === 'AbortError') aborted = true;
    else failure = error;
  }

  await turn.settle();
  if (failure) throw failure;

  // Nothing but reasoning (or nothing at all) came back: say so with an empty
  // reply rather than leaving the turn without an answer.
  if (!aborted && !turn.hasReply()) {
    await appendMessage({ role: 'assistant', content: reply.content }, { chatId });
  }

  return { reply, aborted };
}

/**
 * Run the model until it answers without asking for a tool.
 *
 * Each round is one request. If the reply carries tool calls they are run in
 * order — never in parallel, since JavaScript calls share `window` and may
 * depend on each other — each result is appended as a `tool` message, and the
 * transcript is sent again. After `maxToolRounds` of that the model is asked to
 * answer without tools; if it still calls one, the turn ends with an error.
 *
 * This is a loop, not recursion, so there is exactly one abort controller and
 * one cleanup for the whole turn. The turn is pinned to `chatId`, so switching
 * chats mid-run cannot redirect it.
 *
 * Stopping can leave a call in the transcript with no result. That is fine:
 * `buildApiMessages` leaves unanswered calls out of the next request.
 */
async function runTurns(chatId) {
  const chat = findChat(chatId);
  if (!chat) return;

  const controller = new AbortController();
  const { signal } = controller;
  state.runtime.completionAbort = controller;

  const maxRounds = Math.max(
    1,
    pickInteger(10, state.data.config.maxToolRounds, GLOBAL_SETTINGS.maxToolRounds.default),
  );

  try {
    for (let round = 0; ; round++) {
      setGeneration({
        active: true,
        phase: 'thinking',
        tool: null,
        loop: round,
        maxLoops: maxRounds,
      });

      const lastRound = round >= maxRounds;
      const { reply, aborted } = await requestTurn({
        chat,
        chatId,
        signal,
        forceAnswer: lastRound,
      });

      if (aborted) {
        await appendStopped(chatId);
        return;
      }
      if (!reply.toolCalls.length) return;

      if (lastRound) {
        await appendMessage(
          {
            role: 'error',
            content: `**System Error:** Maximum tool rounds (${maxRounds}) reached.`,
          },
          { chatId },
        );
        return;
      }

      for (const call of reply.toolCalls) {
        setGeneration({ phase: 'tool', tool: call.name });
        const content = await runToolCall(call, { chat, signal });
        await appendMessage(
          { role: TOOL_ROLE, toolCallId: call.id, name: call.name, content, collapsed: true },
          { chatId },
        );
        // Running code cannot be interrupted, but the loop can stop after it.
        if (signal.aborted) {
          await appendStopped(chatId);
          return;
        }
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      await appendStopped(chatId);
    } else {
      await appendMessage(
        { role: 'error', content: `**Error:**\n\n${error.message}` },
        { chatId },
      );
    }
  } finally {
    // A stop followed at once by a new send may already own the runtime state.
    const current = state.runtime.completionAbort;
    if (current === controller || current === null) {
      state.runtime.completionAbort = null;
      setGeneration(IDLE);
    }
    invalidateContext();
  }
}

/**
 * Append the user's message and run the model's turn. `skipApi` appends the
 * message without calling the API at all.
 */
export async function sendMessage({ text = '', skipApi = false } = {}) {
  const trimmed = text.trim();
  if (!trimmed) return;

  if (!state.data.config.key && !skipApi) {
    throw new Error('Please enter your API key in the settings first.');
  }
  if (!state.data.config.lastModel && !skipApi) {
    throw new Error('No model selected. Check the connection settings, or add one under Extra Models.');
  }
  if (!state.data.currentChatId) await createChat();

  const chat = currentChat();
  if (!chat.messages.length) {
    chat.title = buildTitle(trimmed);
    await persistChatIndex();
    emit(EVENTS.CHATS);
  }
  await appendMessage({ role: 'user', content: trimmed });
  if (skipApi) return;

  await runTurns(state.data.currentChatId);
}
