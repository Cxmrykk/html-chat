import { createEmitter } from './emitter.js';
import { EVENTS } from './events.js';
import * as chatsRepo from '../data/chats-repo.js';
import * as filesRepo from '../data/files-repo.js';
import * as configRepo from '../data/config-repo.js';
import * as prefsRepo from '../data/prefs-repo.js';
import * as profilesRepo from '../data/profiles-repo.js';
import { SEARCH_METHODS } from '../core/rag-profile.js';

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
    /** Search profiles, normalized, sorted by name (see `core/rag-profile.js`). */
    profiles: [],
    currentChatId: null,
  },

  session: {
    /** 'chat' | 'settings' | 'wizard' */
    view: 'chat',
    sidebarHidden: false,
    titleHidden: false,
    promptHeight: '',
    theme: 'light',
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
    /** Which setting the settings editor has open. */
    activeSettingKey: null,
    /** Unsaved editor contents, restored when returning to the same key. */
    settingsDraft: null,
    /**
     * The file search configurator, or null (see `services/wizard.js`):
     *
     *   { fileId, fileName, text, lines, queue, attachOnSave, step, draft,
     *     baseProfileId, applyToOthers, saving, error, preview, test, assistant }
     */
    wizard: null,
  },

  runtime: {
    /**
     * `phase` is 'idle' | 'thinking' | 'generating' | 'tool'; `tool` names the
     * tool being run during the last of those; `loop` counts the tool rounds
     * completed so far in this turn.
     */
    generation: { active: false, phase: 'idle', tool: null, loop: 0, maxLoops: 0 },
    completionAbort: null,
    /** fileId -> { controller, promise } */
    embedding: new Map(),
    /** Cached context size; -1 means "recompute". */
    contextChars: -1,
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

export function findFile(id) {
  return state.data.files.find((file) => file.id === id) || null;
}

export function findProfile(id) {
  if (!id) return null;
  return state.data.profiles.find((profile) => profile.id === id) || null;
}

/** A file's search profile, or null when it has none (or it was deleted). */
export function profileOf(file) {
  return file?.profileId ? findProfile(file.profileId) : null;
}

/** A file can be searched only once it has a profile. */
export function isConfigured(file) {
  return Boolean(profileOf(file));
}

export function embeddingsEnabled() {
  const model = state.data.config.embeddingsModel;
  return Boolean(model && model.trim() !== '');
}

/** The methods of a profile that can actually run: embeddings need a model. */
export function usableMethods(profile) {
  if (!profile) return [];
  return SEARCH_METHODS.filter(
    (method) => profile.methods?.[method] && (method !== 'embeddings' || embeddingsEnabled()),
  );
}

/**
 * The files a chat may search, in sidebar order. A chat can outlive a file (or
 * arrive by import from another browser), so ids with no file are skipped here
 * rather than being cleaned up everywhere a file can disappear.
 */
export function chatFiles(chat = currentChat()) {
  const ids = new Set(chat?.fileIds || []);
  if (!ids.size) return [];
  return state.data.files.filter((file) => ids.has(file.id));
}

/**
 * The attached files that can be searched at all, or with `method`: a file
 * without a profile, or whose profile's methods cannot run, is left out.
 */
export function searchableFiles(chat = currentChat(), method = null) {
  return chatFiles(chat).filter((file) => {
    const methods = usableMethods(profileOf(file));
    return method ? methods.includes(method) : methods.length > 0;
  });
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

export function setModelStatus(patch) {
  Object.assign(state.runtime.models, patch);
  emit(EVENTS.MODELS);
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

export function persistProfiles() {
  return profilesRepo.saveProfiles(state.data.profiles);
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
    theme: state.session.theme,
  });
}

/** Chat content plus its index entry (title may have changed). */
export async function persistCurrentChat() {
  await persistChat();
  await persistChatIndex();
}
