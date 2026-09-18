/**
 * What each message role means outside the transcript: whether it reaches the
 * API, whether the user may pick it from the role dropdown, and whether its
 * row can be folded away.
 */

export const THINKING_ROLE = 'thinking';
export const TOOL_ROLE = 'tool';

/** Roles a user can assign by hand. */
const SELECTABLE_ROLES = ['user', 'assistant', 'system'];

/** Transcript-only roles: shown, stored and exported, but never sent. */
const COSMETIC_ROLES = ['error', THINKING_ROLE];

export function isThinking(message) {
  return message?.role === THINKING_ROLE;
}

/** The result of one tool call, answering `toolCallId`. */
export function isToolResult(message) {
  return message?.role === TOOL_ROLE;
}

/** An assistant message that asked for at least one tool to be run. */
export function hasToolCalls(message) {
  return (
    message?.role === 'assistant' &&
    Array.isArray(message.toolCalls) &&
    message.toolCalls.length > 0
  );
}

/**
 * Anything the model's turn produced — its reasoning, its reply, the results
 * of the tools it called — as opposed to anything the user put there.
 */
export function isModelOutput(message) {
  return message?.role === 'assistant' || isThinking(message) || isToolResult(message);
}

/** Rows that render as a one-line header until opened. */
export function isCollapsible(message) {
  return isThinking(message) || isToolResult(message);
}

/**
 * True when a message may contribute to the request sent to the API. Whether a
 * tool call or tool result *actually* goes out also depends on its partner
 * being present; `core/tool-calls.js` decides that.
 */
export function isSendable(message) {
  return Boolean(message) && !COSMETIC_ROLES.includes(message.role);
}

/**
 * Tool calls and their results are a matched pair on the wire. Re-labelling
 * either half by hand would only orphan the other, so their role is fixed.
 */
export function isRoleLocked(message) {
  return isToolResult(message) || hasToolCalls(message);
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
