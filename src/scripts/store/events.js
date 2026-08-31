/** Every event the store can emit. Views subscribe; nothing else pushes renders. */
export const EVENTS = {
  /** Chat list membership, ordering, titles or selection changed. */
  CHATS: 'chats',
  /** The current chat's message array changed wholesale. */
  MESSAGES: 'messages',
  /** One message changed in place. Payload: { index }. */
  MESSAGE: 'message',
  /** Messages were removed from the end of the chat. Payload: { length }. */
  MESSAGES_TRUNCATED: 'messages:truncated',
  /** One message was appended. Payload: { index }. */
  MESSAGE_APPENDED: 'message:appended',
  /** File list membership changed. */
  FILES: 'files',
  /** Embedding progress for one file. Payload: { id }. */
  FILE_PROGRESS: 'file:progress',
  /** UI mode: active view, editing target, sidebar visibility. */
  SESSION: 'session',
  /** A request started, changed phase, or finished. */
  GENERATION: 'generation',
  /** The estimated context size may have changed. */
  CONTEXT: 'context',
  /** A user-supplied hook failed. Payload: { key, error }. */
  HOOK_ERROR: 'hook:error',
};
