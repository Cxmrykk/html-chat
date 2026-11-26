/** Centralized key definitions for IndexedDB storage. */

export const KEYS = {
  config: 'mf_config',
  currentChatId: 'mf_current_chat_id',
  chatIndex: 'mf_chat_index',
  chat: (id) => `mf_chat_${id}`,
  sidebarHidden: 'mf_sidebar_hidden',
  titleHidden: 'mf_title_hidden',
  promptHeight: 'mf_prompt_height',
  theme: 'mf_theme',
  /** Legacy single-record chat key for backward compatibility migrations. */
  legacyChats: 'mf_chats',
};

/**
 * Records left by file search, which no longer exists: file metadata, search
 * profiles, and per-file text, sections and embedding units. Nothing reads
 * them; `data/retired-repo.js` deletes them.
 */
export const RETIRED_KEYS = ['mf_files', 'mf_rag_profiles'];
export const RETIRED_PREFIXES = ['mf_filedata_', 'mf_sections_', 'mf_chunk_'];
