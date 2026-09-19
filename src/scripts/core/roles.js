/**
 * What each message role means outside the transcript: whether it reaches the
 * API, whether the user may pick it from the role dropdown, whether it can be
 * edited as text, and whether its row can be folded away.
 */

export const THINKING_ROLE = 'thinking';

/**
 * Every tool call of one or more consecutive rounds, with its result. Its
 * shape, and how it becomes wire messages, is `core/tool-calls.js`.
 */
export const TOOLS_ROLE = 'tools';

/** Roles a user can assign by hand. */
const SELECTABLE_ROLES = ['user', 'assistant', 'system'];

/** Transcript-only roles: shown, stored and exported, but never sent. */
const COSMETIC_ROLES = ['error', THINKING_ROLE];

export function isThinking(message) {
  return message?.role === THINKING_ROLE;
}

export function isTools(message) {
  return message?.role === TOOLS_ROLE;
}

/**
 * Anything the model's turn produced — its reasoning, its reply, the tools it
 * called — as opposed to anything the user put there.
 */
export function isModelOutput(message) {
  return message?.role === 'assistant' || isThinking(message) || isTools(message);
}

/**
 * Rows that render as a one-line header until opened: a thinking box with
 * reasoning in it. A box whose model returned no reasoning has nothing to
 * open, so it is a plain header. (Tool calls fold individually, inside their
 * box; the box itself is always open.)
 */
export function isCollapsible(message) {
  return isThinking(message) && Boolean(message.content);
}

/**
 * True when a message may contribute to the request sent to the API. Which of
 * a tools message's calls actually go out also depends on each having a
 * result; `core/tool-calls.js` decides that.
 */
export function isSendable(message) {
  return Boolean(message) && !COSMETIC_ROLES.includes(message.role);
}

/**
 * Tool calls and their results are matched pairs on the wire. Re-labelling a
 * tools message by hand would turn structured calls into meaningless text, so
 * its role is fixed.
 */
export function isRoleLocked(message) {
  return isTools(message);
}

/** Whether the message is plain text the composer can edit. */
export function isEditable(message) {
  return Boolean(message) && !isTools(message) && !isThinking(message);
}

/**
 * Options for a message's role dropdown. A role that cannot be chosen by hand
 * (error, thinking, anything unknown from an import) is offered only to the
 * message that already has it, so the dropdown always tells the truth.
 */
export function roleOptionsFor(message) {
  const role = message?.role;
  if (isRoleLocked(message)) return [role];
  return SELECTABLE_ROLES.includes(role) ? SELECTABLE_ROLES : [...SELECTABLE_ROLES, role];
}
