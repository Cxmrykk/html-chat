/** Every event the store can emit. Views subscribe; nothing else pushes renders. */
export const EVENTS = {
  /** Chat list membership, ordering, titles or selection changed. */
  CHATS: 'chats',
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
  /** The images waiting in the composer changed. */
  COMPOSER: 'composer',
  /**
   * Whether the original of an image is held changed: it was found, found
   * missing, or restored. Payload: { hash }.
   */
  IMAGES: 'images',
  /** UI mode: active view, editing target, sidebar visibility. */
  SESSION: 'session',
  /** A request started, changed phase, or finished. */
  GENERATION: 'generation',
  /** The estimated context size may have changed. */
  CONTEXT: 'context',
  /** The model list, or the status of fetching it, changed. */
  MODELS: 'models',
};
