import { isThinking } from './roles.js';

/**
 * The shape of a thinking message, read safely whatever a stored or imported
 * record holds:
 *
 *   { role: 'thinking', startedAt?, seconds?, outcome?, collapsed?, active?,
 *     rounds: [{ thinking, text?, trailing?, continues?, calls, reasoning?, outcome? }] }
 *
 * One round per request. `thinking` is the reasoning shown for it; `calls`
 * are described in `core/tool-calls.js` and `reasoning` in
 * `core/reasoning.js`. A round's `outcome` ('stopped' or 'failed') marks the
 * round a turn ended in, while the message's own `outcome` is how the wait
 * ended. `active` is set only while the turn that owns the message is running.
 *
 * Text the model wrote before its calls is not part of the round: it is the
 * preamble message right before this one (`core/roles.js`), and the round
 * whose calls it introduced is marked `continues`. Only text written after a
 * round's calls stays in the round, as `text` with `trailing` set. Chats from
 * before preambles kept that text in the round; `core/chats.js` splits them.
 */

export function roundsOf(message) {
  return isThinking(message) && Array.isArray(message.rounds) ? message.rounds : [];
}

/** Whether a round holds anything the model produced. */
export function roundHasOutput(round) {
  if (!round || typeof round !== 'object') return false;
  return Boolean(round.thinking || round.text || (Array.isArray(round.calls) && round.calls.length));
}

/** Whether a thinking message holds anything the model produced. */
export function hasOutput(message) {
  return roundsOf(message).some(roundHasOutput);
}

/** Whether the model reasoned visibly in any round. */
export function hasReasoning(message) {
  return roundsOf(message).some((round) => Boolean(round?.thinking));
}

/**
 * Rows that render as a one-line header until opened: a thinking message with
 * something in it. One that only timed a wait has nothing to open.
 */
export function isCollapsible(message) {
  return hasOutput(message);
}

/**
 * The reasoning shown so far in the turn the transcript ends with: every
 * thinking message after the latest user message, round by round. What a
 * retry carries along when Retry Keeps Thinking is on.
 */
export function turnReasoning(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let start = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role === 'user') {
      start = i + 1;
      break;
    }
  }
  return list
    .slice(start)
    .flatMap(roundsOf)
    .map((round) => (typeof round?.thinking === 'string' ? round.thinking.trim() : ''))
    .filter(Boolean)
    .join('\n\n');
}
