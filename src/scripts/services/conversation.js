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
import { normalizeRoundReasoning } from '../core/reasoning.js';
import { normalizeChat } from '../core/chats.js';
import { GLOBAL_SETTINGS } from '../core/settings-schema.js';
import { isThinking, THINKING_ROLE } from '../core/roles.js';
import { roundsOf, roundHasOutput, hasOutput, isCollapsible } from '../core/thinking.js';
import { pickInteger, pickBoolean } from '../core/values.js';
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
 * A fork taken mid-turn copies a thinking message that is still counting or a
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
 * Expand or collapse a thinking message. Purely presentational: what is sent
 * does not depend on it, so the context estimate is untouched, and the
 * repaint is `anchored` so the view does not scroll away from the box just
 * clicked.
 */
export async function setCollapsed(index, collapsed) {
  const chat = currentChat();
  const message = chat?.messages[index];
  if (!isCollapsible(message)) return;
  message.collapsed = collapsed;
  emit(EVENTS.MESSAGE, { index, anchored: true });
  await persistChat();
}

/** A call inside a thinking message, by its `"round.call"` position key. */
function findCall(message, key) {
  if (!isThinking(message) || typeof key !== 'string') return null;
  const [roundIndex, callIndex] = key.split('.').map((part) => Number.parseInt(part, 10));
  if (!Number.isInteger(roundIndex) || !Number.isInteger(callIndex)) return null;
  return roundsOf(message)[roundIndex]?.calls?.[callIndex] || null;
}

/**
 * Expand or collapse one call in a thinking message. Calls are addressed by
 * position rather than id: some servers reuse ids like `call_0` in every
 * request, so an id is only unique within its round.
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
 * Everything the model does before its answer lives in one thinking message:
 * one round per request, each holding the reasoning streamed during it, the
 * text written alongside its calls, and the calls themselves with their
 * results. The message is mounted the moment the first request goes out, and
 * its header counts how long the user has been waiting — across every round
 * and every tool run — until the answer starts. A retried turn resumes the
 * thinking message the transcript ends with: new rounds follow the old ones,
 * and its clock continues from where it stopped.
 *
 * Text in a round cannot be told apart from the answer until the round either
 * calls a tool or ends. It is shown as an assistant message straight away,
 * because the answer is the common case; if calls follow, it moves into the
 * round (`round.text`) and the clock resumes.
 *
 * A thinking message that never received anything — no reasoning, text or
 * calls — only timed the wait, and is removed when the answer starts or the
 * turn ends. So its buttons, which act on what the model produced, only ever
 * appear on a box with something in it. While its turn runs the message is
 * marked `active`, which keeps them hidden.
 *
 * When a round's request settles, the reasoning the provider may need back —
 * signed thinking blocks, or the raw reasoning field — is attached to the
 * round, tagged with the model that wrote it. Whether it is ever sent is
 * decided by `core/tool-calls.js`.
 *
 * Messages are held by reference and their index is looked up when emitting,
 * so deleting or truncating mid-stream cannot redirect writes into whichever
 * message inherits the old index; a removed message simply stops repainting.
 * If the user deletes the thinking message mid-turn, the next calls get a
 * fresh one rather than vanishing.
 *
 * Renders read the message back out of the store by index, so a chat the user
 * has since navigated away from must stay silent: otherwise every delta
 * repaints whichever message happens to share that index in the chat now on
 * screen. Returning to the chat re-renders it in full anyway.
 */
function createTurn(chat, chatId, { resume = null } = {}) {
  const isVisible = () => chatId === state.data.currentChatId;
  const isMounted = (message) => Boolean(message) && chat.messages.includes(message);
  const collapseByDefault = pickBoolean(
    true,
    state.data.config.collapseThinking,
    GLOBAL_SETTINGS.collapseThinking.default,
  );

  /** The thinking message this turn's work goes into. */
  let work = resume;
  /** Set when the turn itself removed `work` (it was empty when the answer began). */
  let detached = false;
  /** Every round this turn started, for settling calls that never returned. */
  const turnRounds = [];

  // Per-round state, reset by `startRound`.
  let round = null;
  let assistant = null;
  let replying = false;
  /** The model this round's request went to, and the reasoning it may need back. */
  let roundModel = '';
  let replay = null;

  const repaint = (message, streaming) => {
    const index = chat.messages.indexOf(message);
    if (index !== -1 && isVisible()) emit(EVENTS.MESSAGE, { index, streaming });
  };

  /** After a change that moves indices: re-render the transcript and save. */
  const refresh = () => {
    invalidateContext();
    if (isVisible()) emit(EVENTS.MESSAGES);
    persistChat(chatId);
  };

  const append = (message) => {
    chat.messages.push(message);
    invalidateContext();
    if (isVisible()) emit(EVENTS.MESSAGE_APPENDED, { index: chat.messages.length - 1 });
    persistChat(chatId);
  };

  const freshWork = (rounds = []) => ({
    role: THINKING_ROLE,
    rounds,
    startedAt: Date.now(),
    collapsed: collapseByDefault,
    active: true,
  });

  const isWaiting = () => Boolean(work) && !Number.isFinite(work.seconds);

  /** Stamp how long the wait lasted. Idempotent until the clock resumes. */
  const stampWait = () => {
    if (!work || Number.isFinite(work.seconds)) return;
    const startedAt = Number.isFinite(work.startedAt) ? work.startedAt : Date.now();
    work.seconds = (Date.now() - startedAt) / 1000;
  };

  /**
   * Give the current round a mounted home again. The box the turn removed
   * itself is reused (it holds only this round); one the user deleted is not,
   * and the round starts a fresh one.
   */
  const reclaimWork = () => {
    if (!detached) work = freshWork([round]);
    detached = false;
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
    if (!thought || round.thinking === thought) return;
    // Going from empty to something turns a plain header into an expandable
    // box, so the whole row is re-rendered; after that only the body changes.
    const wasCollapsible = isCollapsible(work);
    round.thinking = thought;
    repaint(work, wasCollapsible);
  };

  /**
   * The round's text turned out to belong with its calls: move it off the
   * transcript and into the round, and start the clock again.
   */
  const moveAnswerIntoRound = () => {
    round.text = assistant.content;
    const answerIndex = chat.messages.indexOf(assistant);
    const mounted = isMounted(work);
    if (!mounted) reclaimWork();

    if (answerIndex !== -1) {
      if (mounted) chat.messages.splice(answerIndex, 1);
      else chat.messages.splice(answerIndex, 1, work);
    } else if (!mounted) {
      chat.messages.push(work);
    }

    assistant = null;
    delete work.seconds;
    refresh();
  };

  const applyContent = (content) => {
    if (!content) return;

    // Text after this round's calls belongs with them.
    if (round.calls.length) {
      if (round.text !== content) {
        const wasCollapsible = isCollapsible(work);
        round.text = content;
        repaint(work, wasCollapsible);
      }
      return;
    }

    if (!assistant) {
      // The first word of a reply ends the wait.
      stampWait();
      assistant = { role: 'assistant', content };

      const index = chat.messages.indexOf(work);
      if (index !== -1 && !hasOutput(work)) {
        // The box only timed the wait; the answer takes its place.
        chat.messages.splice(index, 1);
        detached = true;
        chat.messages.push(assistant);
        refresh();
        return;
      }
      append(assistant);
      return;
    }

    if (assistant.content !== content) {
      assistant.content = content;
      repaint(assistant, true);
    }
  };

  const applyToolCalls = (toolCalls) => {
    if (!toolCalls.length) return;

    if (round.calls.length) {
      if (mergeCalls(toolCalls)) repaint(work, true);
      return;
    }

    mergeCalls(toolCalls);

    if (assistant) {
      moveAnswerIntoRound();
      return;
    }
    if (!isMounted(work)) {
      reclaimWork();
      append(work);
      return;
    }
    repaint(work, false);
  };

  return {
    /**
     * Start a round: the thinking message is mounted (or resumed) and a new
     * round opened in it. `model` is where the round's request is going.
     */
    startRound(model = '') {
      if (!isMounted(work)) {
        work = freshWork();
        detached = false;
        append(work);
      } else if (!work.active) {
        // Resuming a message from an earlier run: its clock continues from
        // where it stopped, and how that run ended no longer applies.
        const elapsed = Number.isFinite(work.seconds) ? work.seconds : 0;
        work.startedAt = Date.now() - elapsed * 1000;
        delete work.seconds;
        delete work.outcome;
        work.active = true;
        repaint(work, false);
      }

      round = { thinking: '', calls: [] };
      work.rounds.push(round);
      turnRounds.push(round);

      assistant = null;
      replying = false;
      roundModel = model;
      replay = null;
    },

    /** Apply everything accumulated so far this round. Safe to call repeatedly with the same reply. */
    apply({ thinking: thought = '', content = '', toolCalls = [], replay: latest = null } = {}) {
      if (latest) replay = latest;
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
      if (round.calls.length) {
        const reasoning = normalizeRoundReasoning({ model: roundModel, ...(replay || {}) });
        if (reasoning) round.reasoning = reasoning;
        else delete round.reasoning;
      }

      // A request that produced nothing for the box leaves no round behind.
      if (!roundHasOutput(round)) {
        const at = work.rounds.indexOf(round);
        if (at !== -1) work.rounds.splice(at, 1);
      }

      if (isMounted(work)) repaint(work, false);
      if (assistant) repaint(assistant, false);
      invalidateContext();
      await persistChat(chatId);
    },

    /** The calls of the current round, in the order they must run. */
    roundCalls() {
      return round ? round.calls : [];
    },

    /** Whether the current round produced any text or calls. */
    roundHasOutput() {
      return Boolean(assistant || round?.calls.length);
    },

    /**
     * Run one call of the current round. `execute` resolves with
     * `{ content, failed }` and rejects only on the user's abort, which leaves
     * the call running for `finish` to mark as stopped.
     */
    async runCall(call, execute) {
      const holder = () =>
        chat.messages.find((message) =>
          roundsOf(message).some((entry) => Array.isArray(entry.calls) && entry.calls.includes(call)),
        );

      call.status = 'running';
      call.startedAt = Date.now();
      const before = holder();
      if (before) repaint(before, false);

      const outcome = await execute();

      call.result = outcome.content;
      call.status = outcome.failed ? 'error' : 'done';
      call.seconds = (Date.now() - call.startedAt) / 1000;
      invalidateContext();
      const after = holder();
      if (after) repaint(after, false);
      await persistChat(chatId);
    },

    /**
     * Close the turn: calls that never returned are marked stopped (the user
     * stopped the turn) or skipped (it ended any other way). If the turn ended
     * before an answer started, the wait is stamped with how it ended, and so
     * is the round it ended in. The message stops being active, which shows
     * its buttons — or, if it never received anything, it is removed.
     */
    async finish(outcome = null) {
      const now = Date.now();

      for (const entry of turnRounds) {
        for (const call of entry.calls) {
          if (call.status !== 'pending' && call.status !== 'running') continue;
          if (call.status === 'running' && Number.isFinite(call.startedAt)) {
            call.seconds = (now - call.startedAt) / 1000;
          }
          call.status = outcome === 'stopped' ? 'stopped' : 'skipped';
        }
      }

      if (work) {
        const endedWaiting = isWaiting();
        if (outcome && endedWaiting && roundHasOutput(round)) round.outcome = outcome;
        stampWait();
        if (outcome && endedWaiting) work.outcome = outcome;
        delete work.active;

        const index = chat.messages.indexOf(work);
        if (index !== -1 && !hasOutput(work)) {
          chat.messages.splice(index, 1);
          if (isVisible()) emit(EVENTS.MESSAGES);
        } else {
          repaint(work, false);
        }
      }

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
 * The wire messages for a request to `model`: reasoning from the turn in
 * progress is replayed to the model that wrote it, plain text only under the
 * configured field.
 */
function apiMessagesFor(chat, model) {
  return buildApiMessages(chat.messages, {
    model,
    echoField: String(state.data.config.reasoningEchoField ?? '').trim(),
  });
}

/**
 * One request to the API, streamed into the turn. Resolves with whether the
 * user stopped it; the round is given its final render and saved before any
 * failure is rethrown.
 */
async function requestRound({ turn, chat, chatId, signal, forceAnswer }) {
  // Read once: the same model receives the request, the replayed reasoning,
  // and the tag on whatever reasoning comes back.
  const model = state.data.config.lastModel;
  turn.startRound(model);

  let reply = { thinking: '', content: '', toolCalls: [], replay: null };
  let aborted = false;
  let failure = null;

  try {
    reply = await requestCompletion({
      config: state.data.config,
      model,
      messages: apiMessagesFor(chat, model),
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
 * transcript is sent again, with each earlier round's reasoning replayed as
 * the provider requires. After `maxToolRounds` of that the model is asked to
 * answer without tools; if it still calls one, the turn ends with an error.
 *
 * If the transcript ends with a thinking message (a retried turn), that
 * message is resumed rather than a new one started.
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

  const last = chat.messages[chat.messages.length - 1];
  const turn = createTurn(chat, chatId, { resume: isThinking(last) ? last : null });
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

/**
 * Run the model's turn again from the end of the transcript. If that end is a
 * thinking message, the turn picks up where it left off.
 */
export async function regenerate() {
  if (!state.data.config.key) {
    throw new Error('Please enter your API key in the settings first.');
  }
  if (!state.data.config.lastModel) {
    throw new Error('No model selected. Check the connection settings, or add one under Extra Models.');
  }
  if (!state.data.currentChatId) return;

  await runTurns(state.data.currentChatId);
}
