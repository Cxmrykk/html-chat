import { isThinking, THINKING_ROLE } from './roles.js';
import { roundHasOutput } from './thinking.js';
import { normalizeRoundReasoning } from './reasoning.js';
import { normalizeAttachments } from './attachments.js';

/**
 * Bringing a chat record — from storage, from an import, or from a fork — up
 * to the current message model.
 *
 * A chat has no name: it is told apart by when it was made and what it holds
 * (`core/chat-summary.js`), so any stored `title` is dropped. It may be
 * `locked` (kept from Auto-Purge and Reset Chats), and carries `updatedAt`,
 * when it last changed (`core/chat-retention.js`).
 *
 * Files used to be inserted into the transcript as `file` messages, either
 * whole or as a retrieval placeholder. A whole file already carries the exact
 * text that was sent, so it becomes an ordinary user message with nothing
 * lost. A placeholder was never sent at all (running it appended a separate
 * user message), so it is dropped. Later, chats carried `fileIds`, the files
 * they could search; file search no longer exists, so those are dropped too.
 *
 * Everything the model does before its answer lives in thinking messages,
 * grouped by round (`core/thinking.js`). Two older shapes are folded into
 * them:
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
 * Text written before a round's calls is then split out of its thinking
 * message into a preamble (`core/roles.js`): the reasoning before it stays in
 * one box, the preamble follows, and the round's calls start the next box,
 * marked as continuing it. On the wire nothing changes. The first box keeps
 * the old clock, the last one how the wait ended.
 *
 * A round's stored reasoning is validated rather than trusted: an import can
 * carry anything, and a malformed block sent back would fail the request.
 *
 * Image attachments (`core/attachments.js`) are validated the same way, and
 * an attachment that cannot be shown is dropped. A thinking message never
 * carries any itself; its tool calls may (the images an image tool made).
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

  const images = normalizeAttachments(copy.attachments);
  if (images.length) copy.attachments = images;
  else delete copy.attachments;

  return copy;
}

/** A round reduced to known fields, or null if nothing in it survives. */
function normalizeRound(round) {
  if (!round || typeof round !== 'object') return null;

  const normalized = {
    thinking: typeof round.thinking === 'string' ? round.thinking : '',
    calls: (Array.isArray(round.calls) ? round.calls : []).map(normalizeCall).filter(Boolean),
  };
  if (typeof round.text === 'string' && round.text) {
    normalized.text = round.text;
    if (round.trailing === true) normalized.trailing = true;
  }
  if (round.continues === true && normalized.calls.length) normalized.continues = true;

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
  const {
    active,
    content,
    rounds,
    attachments: _attachments,
    attachmentsOpen: _attachmentsOpen,
    ...rest
  } = message;
  const work = {
    ...rest,
    role: THINKING_ROLE,
    rounds: (Array.isArray(rounds) ? rounds : []).map(normalizeRound).filter(Boolean),
  };
  if (isUnsettled(work)) work.outcome = 'interrupted';
  return work;
}

/** A round whose text came before its calls: what a preamble is made of. */
function isPreambleRound(round) {
  return Boolean(round.text) && !round.trailing && !round.continues;
}

/**
 * A thinking message with text written before a round's calls, split into
 * the boxes and preambles a turn makes now. Anything else comes back as it is.
 */
function splitWork(work) {
  if (!work.rounds.some(isPreambleRound)) return [work];

  const { rounds, startedAt, seconds, outcome, ...meta } = work;
  const pieces = [];
  let box = { ...meta, rounds: [] };

  const flush = () => {
    if (box.rounds.length) pieces.push(box);
    box = { ...meta, rounds: [] };
  };

  for (const round of rounds) {
    if (!isPreambleRound(round)) {
      box.rounds.push(round);
      continue;
    }
    const { thinking, text, ...rest } = round;
    if (thinking) box.rounds.push({ thinking, calls: [] });
    flush();
    pieces.push({ role: 'assistant', content: text, preamble: true });
    if (rest.calls.length) box.rounds.push({ ...rest, thinking: '', continues: true });
  }
  flush();

  const boxes = pieces.filter(isThinking);
  if (boxes.length) {
    // A clock that never stopped would count forever in the first box once
    // the outcome that settled it has moved to the last one.
    if (Number.isFinite(seconds)) {
      if (Number.isFinite(startedAt)) boxes[0].startedAt = startedAt;
      boxes[0].seconds = seconds;
    }
    if (outcome) boxes[boxes.length - 1].outcome = outcome;
  }
  return pieces;
}

/** Any other message: its attachments validated, the fields dropped when none survive. */
function normalizeAttached(message) {
  if (!('attachments' in message) && !('attachmentsOpen' in message)) return message;
  const { attachments, attachmentsOpen, ...rest } = message;
  const list = normalizeAttachments(attachments);
  if (!list.length) return rest;
  return { ...rest, attachments: list, ...(attachmentsOpen === true ? { attachmentsOpen: true } : {}) };
}

/**
 * Any message but a thinking one: no turn is running, so nothing is active,
 * and only an assistant message can be a preamble.
 */
function normalizeOther(message) {
  const { active: _active, preamble, ...base } = message;
  const kept = preamble === true && base.role === 'assistant' ? { ...base, preamble: true } : base;
  return normalizeAttached(kept);
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
  return foldMessages(messages).flatMap((message) =>
    isThinking(message) ? splitWork(normalizeWork(message)) : [normalizeOther(message)],
  );
}

/** Idempotent: a current record comes back equivalent. */
export function normalizeChat(chat) {
  // `fileIds` named the files a chat could search, when file search existed;
  // `title` is from when chats had names.
  const { fileIds: _retired, title: _title, locked, updatedAt, ...rest } = chat || {};
  const messages = Array.isArray(rest.messages) ? rest.messages : [];
  const out = {
    ...rest,
    messages: normalizeMessages(messages),
  };
  if (locked === true) out.locked = true;
  const touched = Number(updatedAt);
  if (Number.isFinite(touched) && touched > 0) out.updatedAt = touched;
  return out;
}
