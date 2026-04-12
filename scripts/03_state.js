// --- GLOBAL STATE ---
let config = {};
let chats = [];
let files = [];
let currentChatId = null;
let currentAbortController = null;
let isSidebarHidden = false;
let isTitleHidden = false;
let editingMessageIndex = null;
let promptHeight = "";

let isSuperSecretSettingsOpen = false;
let activeSuperSecretSetting = null;
let uncommittedSuperSecretValue = null;

function saveState() {
  dbSet("mf_config", config);
  dbSet("mf_chats", chats);
  dbSet("mf_files", files);
  dbSet("mf_current_chat_id", currentChatId || "");
  dbSet("mf_sidebar_hidden", isSidebarHidden);
  dbSet("mf_title_hidden", isTitleHidden);
  dbSet("mf_prompt_height", promptHeight);
}
