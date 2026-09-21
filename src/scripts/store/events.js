/** Every event the store can emit. Views subscribe; nothing else pushes renders. */
export const EVENTS = {
  /** Chat list membership, ordering, titles or selection changed. */
  CHATS: 'chats',
  /** Which files the current chat may search changed. */
  CHAT_FILES: 'chat:files',
  /** The current chat's message array changed wholesale. */
  MESSAGES: 'messages',
  /**
   * One message changed in place. Payload: { index, streaming?, anchored? }.
   * `streaming` marks a partial update that will be followed by more;
   * `anchored` asks the view to stay where it is instead of following the
   * transcript down (used when a collapsible box is toggled, or an edit starts
   * or stops).
   */
  MESSAGE: 'message',
  /** Messages were removed from the end of the chat. Payload: { length }. */
  MESSAGES_TRUNCATED: 'messages:truncated',
  /** One message was appended. Payload: { index }. */
  MESSAGE_APPENDED: 'message:appended',
  /**
   * A message edit started, stopped, or its selected part changed. Only the
   * composer and the selection outline follow it; the transcript stays put.
   */
  EDIT: 'edit',
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
  /** The model list, or the status of fetching it, changed. */
  MODELS: 'models',
};
