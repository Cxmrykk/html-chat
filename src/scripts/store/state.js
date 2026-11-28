import { createEmitter } from './emitter.js';
import { EVENTS } from './events.js';
import * as chatsRepo from '../data/chats-repo.js';
import * as configRepo from '../data/config-repo.js';
import * as prefsRepo from '../data/prefs-repo.js';

const emitter = createEmitter();
export const on = emitter.on;
export const emit = emitter.emit;

/**
 * State store split by lifecycle:
 *
 *   data    — persisted domain data
 *   session — UI mode (active view, editor drafts, sidebar visibility)
 *   runtime — transient lifecycle state (abort controllers, caches)
 */
export const state = {
  data: {
    config: {},
    chats: [],
    currentChatId: null,
  },

  session: {
    /** 'chat' | 'settings' | 'chats' (the page that searches and manages chats) */
    view: 'chat',
    /**
     * Which page the settings view shows: 'main' (every setting), or one of
     * the model pickers, 'imageModels', 'imageToolModels' or 'modelFilter'.
     */
    settingsPage: 'main',
    sidebarHidden: false,
    titleHidden: false,
    promptHeight: '',
    theme: 'light',
    /** Labels of the chat list's date groups the user has folded (`core/chat-dates.js`). */
    collapsedChatGroups: [],
    /** The chats page's search (`core/chat-search.js`). */
    chatSearch: { query: '', mode: 'text', caseSensitive: false },
    editingMessageIndex: null,
    /**
     * The part of that message being edited: a range of its markdown blocks,
     * `{ start, end }` inclusive (see `core/edit-range.js`), or null while
     * nothing has been picked.
     */
    editingRange: null,
    /**
     * The message's content when the range was picked. Block indices only mean
     * something against that exact text; if the message changes, the range is
     * stale and is not applied.
     */
    editingSource: null,
    /** What the composer was loaded with, to tell an untouched part from an edited one. */
    editingLoaded: null,
    editingThinking: false,
    /**
     * Images pasted or dropped into the composer, waiting to go out with the
     * next message: attachment records (`core/attachments.js`) whose originals
     * are held by `services/images.js`.
     */
    pendingAttachments: [],
    /**
     * The image opened across its attachments area, or null:
     * `{ chatId, index, call, at, hash, scrollTop }`, where `call` is the
     * `"round.call"` key of the tool call that made it, or null for a
     * message's own image (`ui/components/attachments.js`).
     */
    expandedImage: null,
    /** Which setting the settings editor has open. */
    activeSettingKey: null,
    /** Unsaved editor contents, restored when returning to the same key. */
    settingsDraft: null,
    /**
     * The model whose LLM parameters the settings view edits, or null for the
     * defaults every model inherits (see `core/model-params.js`).
     */
    settingsModel: null,
  },

  runtime: {
    /**
     * `phase` is 'idle' | 'thinking' | 'generating' | 'tool'; `tool` names the
     * tool being run during the last of those; `loop` counts the tool rounds
     * completed so far in this turn.
     */
    generation: { active: false, phase: 'idle', tool: null, loop: 0, maxLoops: 0 },
    completionAbort: null,
    /** chat id -> its token and image count, as shown in the chat lists. */
    chatStats: new Map(),
    /** Discovery status; the list itself is cached in `data.config.models`. */
    models: { loading: false, error: null },
    modelsAbort: null,
  },
};

/* ------------------------------------------------------------------ *
 * Selectors
 * ------------------------------------------------------------------ */

export function currentChat() {
  return state.data.chats.find((chat) => chat.id === state.data.currentChatId) || null;
}

export function findChat(id) {
  return state.data.chats.find((chat) => chat.id === id) || null;
}

/* ------------------------------------------------------------------ *
 * Mutations
 * ------------------------------------------------------------------ */

export function setSession(patch, { silent = false } = {}) {
  Object.assign(state.session, patch);
  if (!silent) emit(EVENTS.SESSION);
}

/** What `chatId` would send may have changed: its counts are worked out again. */
export function invalidateContext(chatId = state.data.currentChatId) {
  if (chatId) state.runtime.chatStats.delete(chatId);
  emit(EVENTS.CONTEXT, { chatId });
}

export function setGeneration(patch) {
  Object.assign(state.runtime.generation, patch);
  emit(EVENTS.GENERATION);
}

export function setModelStatus(patch) {
  Object.assign(state.runtime.models, patch);
  emit(EVENTS.MODELS);
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

export function persistConfig() {
  return configRepo.saveConfig(state.data.config);
}

export function persistChatIndex() {
  return chatsRepo.saveChatIndex(state.data.chats);
}

/** Save a chat, stamped with when it last changed (what Auto-Purge goes by). */
export function persistChat(id = state.data.currentChatId) {
  const chat = findChat(id);
  if (!chat) return Promise.resolve();
  chat.updatedAt = Date.now();
  return chatsRepo.saveChat(chat);
}

export function persistPrefs() {
  return prefsRepo.savePrefs({
    sidebarHidden: state.session.sidebarHidden,
    titleHidden: state.session.titleHidden,
    promptHeight: state.session.promptHeight,
    currentChatId: state.data.currentChatId,
    theme: state.session.theme,
  });
}

/** Chat content plus its index entry. */
export async function persistCurrentChat() {
  await persistChat();
  await persistChatIndex();
}
