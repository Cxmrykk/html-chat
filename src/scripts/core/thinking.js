import { isThinking } from './roles.js';

/**
 * The shape of a thinking message, read safely whatever a stored or imported
 * record holds:
 *
 *   { role: 'thinking', startedAt?, seconds?, outcome?, collapsed?, active?,
 *     rounds: [{ thinking, text?, calls, reasoning?, outcome? }] }
 *
 * One round per request. `thinking` is the reasoning shown for it; `text` is
 * what the model wrote alongside its calls; `calls` are described in
 * `core/tool-calls.js` and `reasoning` in `core/reasoning.js`. A round's
 * `outcome` ('stopped' or 'failed') marks the round a turn ended in, while
 * the message's own `outcome` is how the wait ended. `active` is set only
 * while the turn that owns the message is running.
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
