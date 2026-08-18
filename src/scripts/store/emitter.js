/** Tiny synchronous pub/sub. A listener throwing must not break the others. */
export function createEmitter() {
  const listeners = new Map();

  return {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return () => listeners.get(event)?.delete(handler);
    },

    emit(event, payload) {
      const handlers = listeners.get(event);
      if (!handlers) return;
      for (const handler of [...handlers]) {
        try {
          handler(payload);
        } catch (error) {
          console.error(`Listener for "${event}" failed:`, error);
        }
      }
    },
  };
}
