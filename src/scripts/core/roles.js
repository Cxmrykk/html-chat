/**
 * What each message role means outside the transcript: whether it reaches the
 * API, and whether the user may pick it from the role dropdown.
 */

export const THINKING_ROLE = 'thinking';

/** Roles a user can assign by hand. */
const SELECTABLE_ROLES = ['user', 'assistant', 'system'];

/** Transcript-only roles: shown, stored and exported, but never sent. */
const COSMETIC_ROLES = ['error', THINKING_ROLE];

export function isThinking(message) {
  return message?.role === THINKING_ROLE;
}

/** Anything the model produced, as opposed to anything the user put there. */
export function isModelOutput(message) {
  return message?.role === 'assistant' || isThinking(message);
}

/**
 * True when a message contributes to the request sent to the API.
 *
 * Cosmetic roles never do. File messages do only when inserted whole: an
 * embed-mode placeholder contributes nothing until it is run, at which point
 * the retrieved text is appended as its own user message.
 */
export function isSendable(message) {
  if (!message || COSMETIC_ROLES.includes(message.role)) return false;
  if (message.role === 'file') return message.mode === 'full';
  return true;
}

/**
 * Options for a message's role dropdown. A role that cannot be chosen by hand
 * (error, thinking, anything unknown from an import) is offered only to the
 * message that already has it, so the dropdown always tells the truth.
 */
export function roleOptionsFor(role) {
  return SELECTABLE_ROLES.includes(role) ? SELECTABLE_ROLES : [...SELECTABLE_ROLES, role];
}
