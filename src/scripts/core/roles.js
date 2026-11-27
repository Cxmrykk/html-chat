/**
 * What each message role means outside the transcript: whether it reaches the
 * API, whether the user may pick it from the role dropdown, and whether it can
 * be edited as text.
 */

/**
 * Everything the model did before its answer: its reasoning, the text it
 * wrote alongside tool calls, and the calls with their results, grouped by
 * round. Its shape is `core/thinking.js`; how it becomes wire messages is
 * `core/tool-calls.js`.
 */
export const THINKING_ROLE = 'thinking';

/** Roles a user can assign by hand. */
const SELECTABLE_ROLES = ['user', 'assistant', 'system'];

/** Transcript-only roles: shown, stored and exported, but never sent. */
const COSMETIC_ROLES = ['error'];

export function isThinking(message) {
  return message?.role === THINKING_ROLE;
}

/**
 * Text the model wrote before calling tools in the same round: an assistant
 * message marked `preamble`. It is part of the model's work rather than an
 * answer, so it is shown like a thinking box, and on the wire it travels with
 * the calls in the thinking message right after it (`core/tool-calls.js`).
 */
export function isPreamble(message) {
  return message?.role === 'assistant' && message.preamble === true;
}

/**
 * Anything the model's turn produced — its work or its reply — as opposed to
 * anything the user put there.
 */
export function isModelOutput(message) {
  return message?.role === 'assistant' || isThinking(message);
}

/**
 * True when a message may contribute to the request sent to the API. A
 * thinking message contributes only its calls that have a result, and the
 * text written alongside them; `core/tool-calls.js` decides that. Its
 * reasoning is never sent as text, except when a retry carries it.
 */
export function isSendable(message) {
  return Boolean(message) && !COSMETIC_ROLES.includes(message.role);
}

/**
 * Whether the message is plain text the composer can edit. A thinking message
 * is structured (and its replayed reasoning is signed), and a preamble belongs
 * to the calls after it, so neither is.
 */
export function isEditable(message) {
  return Boolean(message) && !isThinking(message) && !isPreamble(message);
}

/**
 * Options for a message's role dropdown. A role that cannot be chosen by hand
 * (error, anything unknown from an import) is offered only to the message that
 * already has it, so the dropdown always tells the truth.
 */
export function roleOptionsFor(message) {
  const role = message?.role;
  return SELECTABLE_ROLES.includes(role) ? SELECTABLE_ROLES : [...SELECTABLE_ROLES, role];
}
