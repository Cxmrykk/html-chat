/** Centralized key definitions for IndexedDB storage. */

const CHUNK_INDEX_WIDTH = 6;

export const KEYS = {
  config: 'mf_config',
  currentChatId: 'mf_current_chat_id',
  chatIndex: 'mf_chat_index',
  chat: (id) => `mf_chat_${id}`,
  files: 'mf_files',
  fileData: (id) => `mf_filedata_${id}`,
  chunkPrefix: (fileId) => `mf_chunk_${fileId}_`,
  chunk: (fileId, index) =>
    `mf_chunk_${fileId}_${String(index).padStart(CHUNK_INDEX_WIDTH, '0')}`,
  sidebarHidden: 'mf_sidebar_hidden',
  titleHidden: 'mf_title_hidden',
  promptHeight: 'mf_prompt_height',
  theme: 'mf_theme',
  /** Legacy single-record chat key for backward compatibility migrations. */
  legacyChats: 'mf_chats',
};
