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

let isAdvancedRAGSettingsOpen = false;
let activeAdvancedRAGFileId = null;
let activeAdvancedRAGSetting = null;
let uncommittedAdvancedRAGValue = null;

let cachedContextChars = -1;

function invalidateTokenCache() {
  cachedContextChars = -1;
}

async function saveState() {
  dbSet("mf_config", config);
  dbSet("mf_current_chat_id", currentChatId || "");
  dbSet("mf_sidebar_hidden", isSidebarHidden);
  dbSet("mf_title_hidden", isTitleHidden);
  dbSet("mf_prompt_height", promptHeight);
  dbSet("mf_files", files);

  const index = chats.map((c) => ({ id: c.id, title: c.title }));
  dbSet("mf_chat_index", index);

  if (currentChatId) {
    const current = chats.find((c) => c.id === currentChatId);
    if (current) dbSet(`mf_chat_${currentChatId}`, current);
  }
}

async function saveAllChats() {
  const index = chats.map((c) => ({ id: c.id, title: c.title }));
  dbSet("mf_chat_index", index);
  for (let c of chats) {
    await dbSet(`mf_chat_${c.id}`, c);
  }
}
