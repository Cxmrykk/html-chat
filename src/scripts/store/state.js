import { createEmitter } from './emitter.js';
import { EVENTS } from './events.js';
import * as chatsRepo from '../data/chats-repo.js';
import * as filesRepo from '../data/files-repo.js';
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
 *   runtime — transient lifecycle state (abort controllers, in-flight loops, caches)
 */
export const state = {
  data: {
    config: {},
    chats: [],
    files: [],
    currentChatId: null,
  },

  session: {
    /** 'chat' | 'settings' | 'file-settings' */
    view: 'chat',
    sidebarHidden: false,
    titleHidden: false,
    promptHeight: '',
    editingMessageIndex: null,
    /** Which setting the settings editor has open. */
    activeSettingKey: null,
    /** Which file 'file-settings' applies to. */
    activeFileId: null,
    /** Unsaved editor contents, restored when returning to the same key. */
    settingsDraft: null,
  },

  runtime: {
    generation: { active: false, phase: 'idle', loop: 0, maxLoops: 0 },
    completionAbort: null,
    /** fileId -> { controller, promise } */
    embedding: new Map(),
    /** Cached context size; -1 means "recompute". */
    contextChars: -1,
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

export function findFile(id) {
  return state.data.files.find((file) => file.id === id) || null;
}

export function activeFile() {
  return findFile(state.session.activeFileId);
}

export function embeddingsEnabled() {
  const model = state.data.config.embeddingsModel;
  return Boolean(model && model.trim() !== '');
}

export function isEmbedding(fileId) {
  return state.runtime.embedding.has(fileId);
}

/* ------------------------------------------------------------------ *
 * Mutations
 * ------------------------------------------------------------------ */

export function setSession(patch, { silent = false } = {}) {
  Object.assign(state.session, patch);
  if (!silent) emit(EVENTS.SESSION);
}

export function invalidateContext() {
  state.runtime.contextChars = -1;
  emit(EVENTS.CONTEXT);
}

export function setGeneration(patch) {
  Object.assign(state.runtime.generation, patch);
  emit(EVENTS.GENERATION);
}

export function reportHookError(key, error) {
  console.error(`User hook "${key}" failed:`, error);
  emit(EVENTS.HOOK_ERROR, { key, error });
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

export function persistConfig() {
  return configRepo.saveConfig(state.data.config);
}

export function persistFiles() {
  return filesRepo.saveFileMetas(state.data.files);
}

export function persistChatIndex() {
  return chatsRepo.saveChatIndex(state.data.chats);
}

export function persistChat(id = state.data.currentChatId) {
  const chat = findChat(id);
  return chat ? chatsRepo.saveChat(chat) : Promise.resolve();
}

export function persistPrefs() {
  return prefsRepo.savePrefs({
    sidebarHidden: state.session.sidebarHidden,
    titleHidden: state.session.titleHidden,
    promptHeight: state.session.promptHeight,
    currentChatId: state.data.currentChatId,
  });
}

/** Chat content plus its index entry (title may have changed). */
export async function persistCurrentChat() {
  await persistChat();
  await persistChatIndex();
}
