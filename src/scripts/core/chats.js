import { isThinking, THINKING_ROLE } from './roles.js';
import { roundHasOutput } from './thinking.js';
import { normalizeRoundReasoning } from './reasoning.js';

/**
 * Bringing a chat record — from storage, from an import, or from a fork — up
 * to the current message model.
 *
 * Files used to be inserted into the transcript as `file` messages, either
 * whole or as a retrieval placeholder. A whole file already carries the exact
 * text that was sent, so it becomes an ordinary user message with nothing
 * lost. A placeholder was never sent at all (running it appended a separate
 * user message), so it is dropped.
 *
 * Everything the model does before its answer now lives in one thinking
 * message per turn, grouped by round (`core/thinking.js`). Two older shapes
 * are folded into it:
 *
 *   - one thinking box per round, holding only reasoning in `content`, with
 *     the round's calls in a separate `tools` message after it and any text
 *     written alongside them in an assistant message between the two;
 *   - older still, calls on the assistant message (`toolCalls`), each result
 *     in a `tool` message after it.
 *
 * Within a turn, each old thinking box starts a round, preamble text becomes
 * that round's `text`, and each round of calls fills it (or starts the next).
 * The turn's boxes share one clock: the first box's start, their durations
 * added up. An assistant message not followed by calls is the answer and
 * closes the turn, as does anything else that is not the model's work. A
 * legacy result with no call is dropped: it was never sent.
 *
 * A round's stored reasoning is validated rather than trusted: an import can
 * carry anything, and a malformed block sent back would fail the request.
 *
 * Nothing can be running when a record is read, so a thinking message that
 * never stopped counting, or a call that never returned, was cut off (a
 * reload, a crash, a fork taken mid-turn) and is marked as interrupted, and
 * the `active` flag of a turn in progress is dropped.
 */

const LEGACY_TOOL_RESULT_ROLE = 'tool';
const LEGACY_TOOLS_ROLE = 'tools';
const UNSETTLED_STATUSES = ['pending', 'running'];
const ROUND_OUTCOMES = ['stopped', 'failed'];

function normalizeFileMessage(message) {
  if (message.mode === 'full' && message.content) {
    return { role: 'user', content: message.content };
  }
  return null;
}

function normalizeCall(call) {
  if (!call || typeof call !== 'object') return null;
  if (typeof call.name !== 'string' || !call.name) return null;

  const copy = { ...call };
  copy.id = typeof copy.id === 'string' ? copy.id : String(copy.id ?? '');
  if (typeof copy.arguments !== 'string') copy.arguments = JSON.stringify(copy.arguments ?? {});
  if (typeof copy.result !== 'string') delete copy.result;
  if (!copy.status || UNSETTLED_STATUSES.includes(copy.status)) {
    copy.status = typeof copy.result === 'string' ? 'done' : 'interrupted';
  }
  return copy;
}

/** A round reduced to known fields, or null if nothing in it survives. */
function normalizeRound(round) {
  if (!round || typeof round !== 'object') return null;

  const normalized = {
    thinking: typeof round.thinking === 'string' ? round.thinking : '',
    calls: (Array.isArray(round.calls) ? round.calls : []).map(normalizeCall).filter(Boolean),
  };
  if (typeof round.text === 'string' && round.text) normalized.text = round.text;

  const reasoning = normalizeRoundReasoning(round.reasoning);
  if (reasoning && normalized.calls.length) normalized.reasoning = reasoning;

  if (ROUND_OUTCOMES.includes(round.outcome)) normalized.outcome = round.outcome;

  return roundHasOutput(normalized) ? normalized : null;
}

/** Still counting: the wait began and has neither ended nor been cut off. */
function isUnsettled(message) {
  return (
    Number.isFinite(message.startedAt) && !Number.isFinite(message.seconds) && !message.outcome
  );
}

/** A current-shape thinking message, settled as nothing could still be running. */
function normalizeWork(message) {
  const { active, content, rounds, ...rest } = message;
  const work = {
    ...rest,
    role: THINKING_ROLE,
    rounds: (Array.isArray(rounds) ? rounds : []).map(normalizeRound).filter(Boolean),
  };
  if (isUnsettled(work)) work.outcome = 'interrupted';
  return work;
}

/** One legacy round: the calls of an assistant message, paired with the results after it. */
function legacyRound(toolCalls, results) {
  const calls = toolCalls
    .map((call) => {
      const answer = results.find((entry) => entry.toolCallId === call?.id);
      const result = answer ? String(answer.content ?? '') : undefined;
      return normalizeCall({
        id: call?.id,
        name: call?.name,
        arguments: call?.arguments,
        ...(answer
          ? { result, status: result.startsWith('Error:') ? 'error' : 'done' }
          : { status: 'interrupted' }),
        // The open/closed state used to live on the result row.
        collapsed: answer ? answer.collapsed !== false : true,
      });
    })
    .filter(Boolean);
  return { calls };
}

/**
 * Walk the messages once, folding each turn's legacy work rows into a single
 * thinking message. Rounds are normalized afterwards, by `normalizeWork`.
 */
function foldMessages(messages) {
  const out = [];
  /** The thinking message the current turn's legacy rows are folded into. */
  let work = null;

  const close = () => {
    work = null;
  };

  const open = () => {
    if (!work) {
      work = { role: THINKING_ROLE, rounds: [] };
      out.push(work);
    }
    return work;
  };

  const lastRound = () => (work && work.rounds.length ? work.rounds[work.rounds.length - 1] : null);

  /** An old per-round thinking box: its reasoning starts a round, its clock joins the turn's. */
  const addLegacyThinking = (message) => {
    const fresh = !work;
    open();
    if (fresh) {
      if (Number.isFinite(message.startedAt)) work.startedAt = message.startedAt;
      if (typeof message.collapsed === 'boolean') work.collapsed = message.collapsed;
    }
    if (Number.isFinite(message.seconds)) {
      work.seconds = (Number.isFinite(work.seconds) ? work.seconds : 0) + message.seconds;
    }
    if (isUnsettled(message)) work.outcome = 'interrupted';
    else if (message.outcome) work.outcome = message.outcome;

    work.rounds.push({
      thinking: typeof message.content === 'string' ? message.content : '',
      calls: [],
    });
  };

  /** Text the model wrote alongside calls: it belongs to the round they are in. */
  const addPreamble = (text) => {
    open();
    const round = lastRound();
    if (round && !round.calls.length && !round.text) round.text = text;
    else work.rounds.push({ thinking: '', text, calls: [] });
  };

  /** Rounds of calls: the first fills the round in progress, the rest follow it. */
  const addLegacyRounds = (rounds) => {
    open();
    rounds.forEach((legacy, k) => {
      const calls = Array.isArray(legacy?.calls) ? legacy.calls : [];
      const reasoning = legacy?.reasoning ? { reasoning: legacy.reasoning } : {};
      const round = lastRound();
      if (k === 0 && round && !round.calls.length) {
        round.calls = calls;
        Object.assign(round, reasoning);
      } else {
        work.rounds.push({ thinking: '', calls, ...reasoning });
      }
    });
  };

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message || typeof message !== 'object') continue;

    if (message.role === 'file') {
      const user = normalizeFileMessage(message);
      if (user) {
        close();
        out.push(user);
      }
      continue;
    }

    // Results are consumed with their calls below; one met here answers nothing.
    if (message.role === LEGACY_TOOL_RESULT_ROLE) continue;

    if (message.role === 'assistant' && 'toolCalls' in message) {
      const { toolCalls, ...assistant } = message;
      const calls = Array.isArray(toolCalls) ? toolCalls : [];

      const results = [];
      while (i + 1 < messages.length && messages[i + 1]?.role === LEGACY_TOOL_RESULT_ROLE) {
        results.push(messages[++i]);
      }

      const round = calls.length ? legacyRound(calls, results) : { calls: [] };
      if (!round.calls.length) {
        if (assistant.content || !calls.length) {
          close();
          out.push(assistant);
        }
        continue;
      }

      if (assistant.content) addPreamble(assistant.content);
      addLegacyRounds([round]);
      continue;
    }

    if (message.role === LEGACY_TOOLS_ROLE) {
      addLegacyRounds(Array.isArray(message.rounds) ? message.rounds : []);
      continue;
    }

    if (isThinking(message)) {
      if (Array.isArray(message.rounds)) {
        // Already the current shape.
        close();
        out.push(message);
      } else {
        addLegacyThinking(message);
      }
      continue;
    }

    if (message.role === 'assistant' && messages[i + 1]?.role === LEGACY_TOOLS_ROLE) {
      if (message.content) addPreamble(message.content);
      continue;
    }

    close();
    out.push(message);
  }

  return out;
}

function normalizeMessages(messages) {
  return foldMessages(messages).map((message) =>
    isThinking(message) ? normalizeWork(message) : message,
  );
}

/** Idempotent: a current record comes back equivalent. */
export function normalizeChat(chat) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const fileIds = Array.isArray(chat?.fileIds) ? chat.fileIds : [];
  return {
    ...chat,
    messages: normalizeMessages(messages),
    // The files this chat may search. Ids of files that no longer exist are
    // harmless; they are filtered out wherever the list is read.
    fileIds: [...new Set(fileIds.filter((id) => typeof id === 'string' && id))],
  };
}
