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
import { buildApiMessages } from '../core/tool-calls.js';
import { normalizeChat } from '../core/chats.js';
import { GLOBAL_SETTINGS } from '../core/settings-schema.js';
import { isCollapsible, isTools, THINKING_ROLE, TOOLS_ROLE } from '../core/roles.js';
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

/**
 * A fork taken mid-turn copies a thinking box that is still counting or a
 * call that is still running. Nothing will ever finish them in the copy, so
 * the copy goes through `normalizeChat`, which settles them as interrupted.
 */
export async function forkChat(messageIndex) {
  const chat = currentChat();
  if (!chat) return;

  const id = Date.now().toString();
  state.data.chats.unshift(
    normalizeChat({
      id,
      title: `${chat.title} (Forked)`,
      messages: JSON.parse(JSON.stringify(chat.messages.slice(0, messageIndex + 1))),
      fileIds: [...(chat.fileIds || [])],
    }),
  );
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
 * Expand or collapse a thinking box. Purely presentational: what is sent does
 * not depend on it, so the context estimate is untouched, and the repaint is
 * `anchored` so the view does not scroll away from the box just clicked.
 */
export async function setCollapsed(index, collapsed) {
  const chat = currentChat();
  const message = chat?.messages[index];
  if (!isCollapsible(message)) return;
  message.collapsed = collapsed;
  emit(EVENTS.MESSAGE, { index, anchored: true });
  await persistChat();
}

/** A call inside a tools message, by its `"round.call"` position key. */
function findCall(message, key) {
  if (!isTools(message) || typeof key !== 'string') return null;
  const [roundIndex, callIndex] = key.split('.').map((part) => Number.parseInt(part, 10));
  if (!Number.isInteger(roundIndex) || !Number.isInteger(callIndex)) return null;
  return message.rounds?.[roundIndex]?.calls?.[callIndex] || null;
}

/**
 * Expand or collapse one call in a tools box. Calls are addressed by position
 * rather than id: some servers reuse ids like `call_0` in every request, so an
 * id is only unique within its round.
 */
export async function toggleCallCollapsed(index, key) {
  const chat = currentChat();
  const call = findCall(chat?.messages[index], key);
  if (!call) return;
  // Collapsed unless explicitly opened, so anything but `false` opens.
  call.collapsed = call.collapsed === false;
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
 * The transcript side of one submission, across all of its tool rounds.
 *
 * A thinking box is mounted the moment a round's request goes out, whether or 
 * not the model reasons, and counts how long the user has been waiting. It stops
 * at the first visible text of the reply — or, if none ever comes, when the
 * round ends. Reasoning from every round streams into its own box.
 *
 * Tool calls go into a tools message that grows round by round, for as long
 * as the model writes nothing between rounds. Text between rounds (the model
 * announcing what it will do next, say) is an assistant message of its own,
 * and the calls after it start a new box, so the transcript stays in the
 * order things happened. Text that shares a round with calls always streams
 * in before them, so it naturally lands in front of its box.
 *
 * Messages are held by reference and their index is looked up when emitting,
 * so deleting or truncating mid-stream cannot redirect writes into whichever
 * message inherits the old index; a removed message simply stops repainting.
 * A removed box is not added to again: the next round starts a fresh one.
 *
 * Renders read the message back out of the store by index, so a chat the user
 * has since navigated away from must stay silent: otherwise every delta
 * repaints whichever message happens to share that index in the chat now on
 * screen. Returning to the chat re-renders it in full anyway.
 */
function createTurn(chat, chatId) {
  const isVisible = () => chatId === state.data.currentChatId;
  const isMounted = (message) => chat.messages.includes(message);

  /** The active thinking box for the current round, if any. */
  let currentThinking = null;
  let thinkingFinished = false;

  /** The tools message new rounds join, and whether text has appeared since it. */
  let box = null;
  let textSinceBox = false;

  /** Every round of calls this turn started, with the message holding it. */
  const started = [];

  // Per-round state, reset by `startRound`.
  let reasoningBefore = '';
  let assistant = null;
  let round = null;
  let replying = false;

  const repaint = (message, streaming) => {
    const index = chat.messages.indexOf(message);
    if (index !== -1 && isVisible()) emit(EVENTS.MESSAGE, { index, streaming });
  };

  const mount = (message) => {
    let removedThinking = false;
    
    // If mounting a real message (assistant/tools) and the current round's 
    // thinking box never received actual reasoning, erase the empty thinking box.
    if (message.role !== THINKING_ROLE && currentThinking && !currentThinking.content) {
      const tIndex = chat.messages.indexOf(currentThinking);
      if (tIndex !== -1) {
        chat.messages.splice(tIndex, 1);
        thinkingFinished = true;
        removedThinking = true;
      }
    }

    chat.messages.push(message);
    invalidateContext();
    if (isVisible()) {
      if (removedThinking) {
        // Splice changes preceding indices, so a full re-render is safest.
        emit(EVENTS.MESSAGES);
      } else {
        emit(EVENTS.MESSAGE_APPENDED, { index: chat.messages.length - 1 });
      }
    }
    persistChat(chatId);
  };

  /**
   * Stamp how long the wait lasted and give the box its final render.
   * `outcome` is recorded only when the wait ended without a reply
   * ('stopped' or 'failed'). Idempotent: the first call wins.
   */
  const finishThinking = (outcome = null) => {
    if (thinkingFinished || !currentThinking) return;
    thinkingFinished = true;
    currentThinking.seconds = (Date.now() - currentThinking.startedAt) / 1000;
    if (outcome) currentThinking.outcome = outcome;

    // The 'Responded after xyz' should not be visible for completely empty boxes.
    if (!currentThinking.content) {
      const index = chat.messages.indexOf(currentThinking);
      if (index !== -1) {
        chat.messages.splice(index, 1);
        if (isVisible()) emit(EVENTS.MESSAGES);
      }
    } else {
      repaint(currentThinking, false);
    }
  };

  /**
   * Fold the latest calls into the current round. Positions are stable while
   * a round streams, so each call keeps its status and open/closed state as
   * its name and arguments grow. Returns whether anything changed.
   */
  const mergeCalls = (toolCalls) => {
    let changed = false;
    toolCalls.forEach((incoming, i) => {
      const existing = round.calls[i];
      if (!existing) {
        round.calls.push({
          id: incoming.id,
          name: incoming.name,
          arguments: incoming.arguments,
          status: 'pending',
          collapsed: true,
        });
        changed = true;
        return;
      }
      if (
        existing.id !== incoming.id ||
        existing.name !== incoming.name ||
        existing.arguments !== incoming.arguments
      ) {
        existing.id = incoming.id;
        existing.name = incoming.name;
        existing.arguments = incoming.arguments;
        changed = true;
      }
    });
    return changed;
  };

  const applyReasoning = (thought) => {
    if (!thought || !currentThinking) return;
    const combined = reasoningBefore ? `${reasoningBefore}\n\n${thought}` : thought;
    if (currentThinking.content === combined) return;
    const first = !currentThinking.content;
    currentThinking.content = combined;
    // The first reasoning turns a plain header into an expandable box, so the
    // whole row is re-rendered; after that only the body changes.
    repaint(currentThinking, !first);
  };

  const applyContent = (content) => {
    if (!content) return;
    if (!assistant) {
      // The first word of a reply ends the wait.
      finishThinking();
      assistant = { role: 'assistant', content };
      mount(assistant);
      textSinceBox = true;
      return;
    }
    if (assistant.content !== content) {
      assistant.content = content;
      repaint(assistant, true);
    }
  };

  const applyToolCalls = (toolCalls) => {
    if (!toolCalls.length) return;

    if (round) {
      if (mergeCalls(toolCalls)) repaint(box, true);
      return;
    }

    // The first tool call of the round ends the wait.
    finishThinking();

    round = { calls: [] };
    mergeCalls(toolCalls);

    if (box && !textSinceBox && isMounted(box)) {
      box.rounds.push(round);
      started.push({ round, message: box });
      repaint(box, true);
      return;
    }

    box = { role: TOOLS_ROLE, rounds: [round] };
    textSinceBox = false;
    started.push({ round, message: box });
    mount(box);
  };

  return {
    startRound() {
      currentThinking = { role: THINKING_ROLE, content: '', collapsed: true, startedAt: Date.now() };
      thinkingFinished = false;
      reasoningBefore = '';
      assistant = null;
      round = null;
      replying = false;
      mount(currentThinking);
    },

    /** Apply everything accumulated so far this round. Safe to call repeatedly with the same reply. */
    apply({ thinking: thought = '', content = '', toolCalls = [] } = {}) {
      applyReasoning(thought);
      if (!replying && (content || toolCalls.length)) {
        replying = true;
        setGeneration({ phase: 'generating' });
      }
      applyContent(content);
      applyToolCalls(toolCalls);
    },

    /** Final renders and a durable save for the round, however its request ended. */
    async settleRound() {
      if (currentThinking && currentThinking.content !== reasoningBefore) repaint(currentThinking, false);
      if (assistant) repaint(assistant, false);
      if (round) repaint(box, false);
      invalidateContext();
      await persistChat(chatId);
    },

    /** The calls of the current round, in the order they must run. */
    roundCalls() {
      return round ? round.calls : [];
    },

    /** Whether the current round produced any text or calls. */
    roundHasOutput() {
      return Boolean(assistant || round);
    },

    /**
     * Run one call of the current round. `execute` resolves with
     * `{ content, failed }` and rejects only on the user's abort, which leaves
     * the call running for `finish` to mark as stopped.
     */
    async runCall(call, execute) {
      const holder = started.find((entry) => entry.round.calls.includes(call))?.message;

      call.status = 'running';
      call.startedAt = Date.now();
      if (holder) repaint(holder, false);

      const outcome = await execute();

      call.result = outcome.content;
      call.status = outcome.failed ? 'error' : 'done';
      call.seconds = (Date.now() - call.startedAt) / 1000;
      invalidateContext();
      if (holder) repaint(holder, false);
      await persistChat(chatId);
    },

    /**
     * Close the turn: calls that never returned are marked stopped (the user
     * stopped the turn) or skipped (it ended any other way), and the wait is
     * stamped if no reply ever started.
     */
    async finish(outcome = null) {
      const now = Date.now();
      const touched = new Set();

      for (const { round: entry, message } of started) {
        for (const call of entry.calls) {
          if (call.status !== 'pending' && call.status !== 'running') continue;
          if (call.status === 'running' && Number.isFinite(call.startedAt)) {
            call.seconds = (now - call.startedAt) / 1000;
          }
          call.status = outcome === 'stopped' ? 'stopped' : 'skipped';
          touched.add(message);
        }
      }
      for (const message of touched) repaint(message, false);

      finishThinking(outcome);
      invalidateContext();
      await persistChat(chatId);
    },
  };
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
 * One request to the API, streamed into the turn. Resolves with whether the
 * user stopped it; the round is given its final render and saved before any
 * failure is rethrown.
 */
async function requestRound({ turn, chat, chatId, signal, forceAnswer }) {
  turn.startRound();

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

  await turn.settleRound();
  if (failure) throw failure;

  // Nothing but reasoning (or nothing at all) came back: say so with an empty
  // reply rather than leaving the turn without an answer.
  if (!aborted && !turn.roundHasOutput()) {
    await appendMessage({ role: 'assistant', content: reply.content }, { chatId });
  }

  return { aborted };
}

/**
 * Run the model until it answers without asking for a tool.
 *
 * Each round is one request. If the reply carries tool calls they are run in
 * order — never in parallel, since JavaScript calls share `window` and may
 * depend on each other — each result is stored on its call, and the
 * transcript is sent again. After `maxToolRounds` of that the model is asked
 * to answer without tools; if it still calls one, the turn ends with an error.
 *
 * This is a loop, not recursion, so there is exactly one abort controller and
 * one cleanup for the whole turn. The turn is pinned to `chatId`, so switching
 * chats mid-run cannot redirect it.
 *
 * Stopping can leave a call with no result. That is fine: `buildApiMessages`
 * leaves unanswered calls out of the next request.
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

  const turn = createTurn(chat, chatId);
  /** How the turn ended when it ended without a reply: 'stopped' or 'failed'. */
  let outcome = null;

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
      const { aborted } = await requestRound({
        turn,
        chat,
        chatId,
        signal,
        forceAnswer: lastRound,
      });

      if (aborted) {
        outcome = 'stopped';
        await appendStopped(chatId);
        return;
      }

      const calls = turn.roundCalls();
      if (!calls.length) return;

      if (lastRound) {
        outcome = 'failed';
        await appendMessage(
          {
            role: 'error',
            content: `**System Error:** Maximum tool rounds (${maxRounds}) reached.`,
          },
          { chatId },
        );
        return;
      }

      for (const call of calls) {
        setGeneration({ phase: 'tool', tool: call.name });
        await turn.runCall(call, () => runToolCall(call, { chat, signal }));
        // Running code cannot be interrupted, but the loop can stop after it.
        if (signal.aborted) {
          outcome = 'stopped';
          await appendStopped(chatId);
          return;
        }
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      outcome = 'stopped';
      await appendStopped(chatId);
    } else {
      outcome = 'failed';
      await appendMessage(
        { role: 'error', content: `**Error:**\n\n${error.message}` },
        { chatId },
      );
    }
  } finally {
    // Settled before going idle: the live counters stop ticking at idle, and
    // must already show their final values by then.
    try {
      await turn.finish(outcome);
    } catch (error) {
      console.error('Could not settle the turn:', error);
    }

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
