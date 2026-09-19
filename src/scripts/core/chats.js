import { isThinking, isTools, TOOLS_ROLE } from './roles.js';

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
 * Tool calls used to live on the assistant message (`toolCalls`), each result
 * in a `tool` message after it. They now live in one `tools` message per run
 * of consecutive rounds. The assistant's text, if it wrote any alongside the
 * calls, stays an assistant message directly before the box — the wire
 * builder attaches it to the calls again. Consecutive legacy rounds with
 * nothing between them share a box, as live ones do. A legacy result with no
 * call is dropped: it was never sent.
 *
 * Nothing can be running when a record is read, so a thinking box that never
 * stopped counting, or a call that never returned, was cut off (a reload, a
 * crash, a fork taken mid-turn) and is marked as interrupted.
 */

const LEGACY_TOOL_RESULT_ROLE = 'tool';
const UNSETTLED_STATUSES = ['pending', 'running'];

function normalizeFileMessage(message) {
  if (message.mode === 'full' && message.content) {
    return { role: 'user', content: message.content };
  }
  return null;
}

function normalizeThinking(message) {
  const unfinished =
    Number.isFinite(message.startedAt) && !Number.isFinite(message.seconds) && !message.outcome;
  return unfinished ? { ...message, outcome: 'interrupted' } : message;
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

function normalizeTools(message) {
  const rounds = (Array.isArray(message.rounds) ? message.rounds : [])
    .map((round) => ({
      ...round,
      calls: (Array.isArray(round?.calls) ? round.calls : []).map(normalizeCall).filter(Boolean),
    }))
    .filter((round) => round.calls.length > 0);
  return rounds.length ? { ...message, rounds } : null;
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

function normalizeMessages(messages) {
  const out = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message || typeof message !== 'object') continue;

    if (message.role === 'file') {
      const user = normalizeFileMessage(message);
      if (user) out.push(user);
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

      if (assistant.content || !calls.length) out.push(assistant);
      if (!calls.length) continue;

      const round = legacyRound(calls, results);
      if (!round.calls.length) continue;

      const previous = out[out.length - 1];
      if (isTools(previous)) previous.rounds.push(round);
      else out.push({ role: TOOLS_ROLE, rounds: [round] });
      continue;
    }

    if (isTools(message)) {
      const tools = normalizeTools(message);
      if (tools) out.push(tools);
      continue;
    }

    if (isThinking(message)) {
      out.push(normalizeThinking(message));
      continue;
    }

    out.push(message);
  }

  return out;
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
