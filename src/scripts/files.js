import { state, dbGet, dbSet, dbDelete, dbDeleteByPrefix, saveState, invalidateTokenCache, $, pickFiles, readFileText, FILE_SETTING_DEFAULTS, SETTING_DEFAULTS, AsyncFunction } from './state.js';
import { applySidebarState, applyInputAreaState, updateTokenCount, renderFileList, renderChatList } from './ui/components.js';
import { renderApp, renderCurrentChat, appendMessageToDOM } from './ui/render.js';
import { importChats, toggleSuperSecretSettings, suspendSuperSecretSettings } from './settings.js';
import { refreshFileChunks } from './embeddings/core.js';
import { resetEditState } from './chat.js';

export function handleNewChatClick(e) {
  if (e.altKey) {
    e.preventDefault();
    importChats();
  } else {
    newChat();
  }
}

export function newChat() {
  suspendSuperSecretSettings();
  resetEditState();
  const id = Date.now().toString();
  state.chats.unshift({ id, title: "New Chat", messages: [] });
  state.currentChatId = id;
  if (window.innerWidth <= 768) {
    state.isSidebarHidden = true;
    applySidebarState();
  }
  invalidateTokenCache();
  saveState();
  renderApp();
  updateTokenCount();
}

export function loadChat(id) {
  suspendSuperSecretSettings();
  resetEditState();
  state.currentChatId = id;
  if (window.innerWidth <= 768) {
    state.isSidebarHidden = true;
    applySidebarState();
  }
  invalidateTokenCache();
  saveState();
  renderApp();
}

export function deleteChat(id) {
  suspendSuperSecretSettings();
  resetEditState();
  state.chats = state.chats.filter((c) => c.id !== id);
  if (state.currentChatId === id) {
    state.currentChatId = state.chats.length ? state.chats[0].id : null;
  }
  invalidateTokenCache();
  saveState();
  renderApp();
}

export function renameChat(id) {
  const chat = state.chats.find((c) => c.id === id);
  const newTitle = prompt("Rename chat:", chat.title);
  if (newTitle) {
    chat.title = newTitle.trim();
    saveState();
    renderChatList();
  }
}

export async function handleUploadClick() {
  const picked = await pickFiles(true);
  if (!picked || !picked.length) return;
  for (const f of picked) {
    const text = await readFileText(f);
    await uploadFile(f.name, text);
  }
}

export async function reuploadFile(id) {
  const picked = await pickFiles(false);
  if (!picked || !picked.length) return;
  const text = await readFileText(picked[0]);
  const meta = state.files.find((f) => f.id === id);
  await uploadFile(meta ? meta.name : picked[0].name, text, id);
}

export async function uploadFile(name, text, existingId = null) {
  let id = existingId || Date.now().toString() + Math.floor(Math.random() * 1000);
  let meta = state.files.find((f) => f.id === id);

  if (!meta) {
    let baseName = name;
    let counter = 1;
    while (state.files.some((f) => f.name === name)) {
      name = `${baseName} (${counter++})`;
    }
    meta = {
      id, name, progress: 0, exactProgress: 0, isEmbedding: false,
      chunkCount: 0, embeddedCount: 0, textLength: text.length,
    };
    state.files.unshift(meta);
    await dbSet(`mf_filedata_${id}`, { id, name, text });
  } else {
    meta.textLength = text.length;
    const data = await dbGet(`mf_filedata_${id}`);
    data.text = text;
    await dbSet(`mf_filedata_${id}`, data);
    await refreshFileChunks(id);
  }

  saveState();
  renderFileList();
}

export async function deleteFile(id) {
  if (state.isAdvancedRAGSettingsOpen && state.activeAdvancedRAGFileId === id) {
    toggleAdvancedRAGSettings(null);
  }
  state.files = state.files.filter((f) => f.id !== id);
  await dbDelete(`mf_filedata_${id}`);
  await dbDeleteByPrefix(`mf_chunk_${id}_`);
  saveState();
  renderFileList();
}

export async function appendFileMessage(fileId, mode = "full") {
  const meta = state.files.find((f) => f.id === fileId);
  if (!meta) return;
  suspendSuperSecretSettings();
  resetEditState();

  if (!state.currentChatId) newChat();
  const chat = state.chats.find((c) => c.id === state.currentChatId);

  let approxTokens = Math.ceil((meta.textLength || 0) / 4);
  let content = "";

  if (mode === "full") {
    const data = await dbGet(`mf_filedata_${meta.id}`);
    const fileText = data ? data.text : "";

    let wrapperFnCode = meta.fileWrapperFunc && meta.fileWrapperFunc.trim() !== ""
        ? meta.fileWrapperFunc : state.config.fileWrapperFunc && state.config.fileWrapperFunc.trim() !== ""
          ? state.config.fileWrapperFunc : SETTING_DEFAULTS.fileWrapperFunc.default;

    let wrapperFn;
    try { 
      wrapperFn = new AsyncFunction("fileContent", "fileName", wrapperFnCode); 
    } catch (e) { 
      wrapperFn = async (c, n) => `\`${n}\`:\n\n\`\`\`\n${c}\n\`\`\``; 
    }

    content = await wrapperFn(fileText, meta.name);
    approxTokens = Math.ceil(content.length / 4);
  }

  chat.messages.push({
    role: "file", fileId: meta.id, fileName: meta.name,
    prompt: "", mode: mode, approxTokens: approxTokens, content: content,
    maxTokens: parseInt(state.config.maxRagTokens, 10) || 5000,
    ragThreshold: parseFloat(state.config.ragThreshold) || 0.0,
  });

  if (window.innerWidth <= 768) {
    state.isSidebarHidden = true;
    applySidebarState();
  }

  invalidateTokenCache();
  saveState();
  appendMessageToDOM(chat.messages[chat.messages.length - 1], chat.messages.length - 1);
  updateTokenCount();
}

export async function toggleAdvancedRAGSettings(id = null) {
  if (state.isSuperSecretSettingsOpen) {
    toggleSuperSecretSettings();
  }

  if (id === null && state.isAdvancedRAGSettingsOpen) {
    if (state.activeAdvancedRAGSetting) {
      state.uncommittedAdvancedRAGValue = $("#chat-input").value;
    }
    state.isAdvancedRAGSettingsOpen = false;
    $("#chat-input").value = "";
    renderCurrentChat();
    applyInputAreaState();
    return;
  }

  if (id !== null) {
    if (state.isAdvancedRAGSettingsOpen && state.activeAdvancedRAGFileId === id) {
      if (state.activeAdvancedRAGSetting) {
        state.uncommittedAdvancedRAGValue = $("#chat-input").value;
      }
      state.isAdvancedRAGSettingsOpen = false;
      $("#chat-input").value = "";
    } else {
      if (state.isAdvancedRAGSettingsOpen && state.activeAdvancedRAGSetting) {
        state.uncommittedAdvancedRAGValue = $("#chat-input").value;
      }

      const isReopeningSame = state.activeAdvancedRAGFileId === id;
      state.isAdvancedRAGSettingsOpen = true;
      state.activeAdvancedRAGFileId = id;

      if (!isReopeningSame) {
        state.activeAdvancedRAGSetting = null;
        state.uncommittedAdvancedRAGValue = null;
        $("#chat-input").value = "";
      } else if (state.activeAdvancedRAGSetting) {
        const area = $("#chat-input");
        if (state.uncommittedAdvancedRAGValue !== null) {
          area.value = state.uncommittedAdvancedRAGValue;
        } else {
          if (state.activeAdvancedRAGSetting === "fileText") {
            const data = await dbGet(`mf_filedata_${id}`);
            area.value = data ? data.text : "";
          } else {
            const meta = state.files.find((f) => f.id === id);
            area.value = meta && meta[state.activeAdvancedRAGSetting] !== undefined && meta[state.activeAdvancedRAGSetting] !== ""
                ? meta[state.activeAdvancedRAGSetting]
                : FILE_SETTING_DEFAULTS[state.activeAdvancedRAGSetting].default;
          }
        }
      }
    }
  }
  renderCurrentChat();
  applyInputAreaState();
}

export async function selectAdvancedRAGSetting(key) {
  state.activeAdvancedRAGSetting = key;
  state.uncommittedAdvancedRAGValue = null;
  const area = $("#chat-input");

  if (key === "fileText") {
    const data = await dbGet(`mf_filedata_${state.activeAdvancedRAGFileId}`);
    area.value = data ? data.text : "";
  } else {
    const meta = state.files.find((f) => f.id === state.activeAdvancedRAGFileId);
    if (meta) {
      area.value = meta[key] !== undefined && meta[key] !== ""
          ? meta[key]
          : FILE_SETTING_DEFAULTS[key].default;
    }
  }
  renderApp(true);
  area.focus();
}

export async function saveAdvancedRAGSetting() {
  if (!state.activeAdvancedRAGSetting || !state.activeAdvancedRAGFileId) return;
  let val = $("#chat-input").value;
  const key = state.activeAdvancedRAGSetting;
  const meta = state.files.find((f) => f.id === state.activeAdvancedRAGFileId);
  if (!meta) return;

  if (key === "fileText") {
    const data = await dbGet(`mf_filedata_${state.activeAdvancedRAGFileId}`);
    if (data) {
      data.text = val;
      meta.textLength = val.length;
      await dbSet(`mf_filedata_${state.activeAdvancedRAGFileId}`, data);
      await refreshFileChunks(meta.id);
    }
  } else {
    const requiresReembed = ["customChunks", "customChunker"].includes(key);
    const oldVal = meta[key];

    if (["customChunks", "customChunker", "retrievalFunc", "dedupFunc", "mergeChunksFunc", "fileWrapperFunc"].includes(key)) {
      meta[key] = val;
    } else {
      if (val.trim() === "") {
        meta[key] = "";
      } else {
        const parsed = parseFloat(val);
        meta[key] = isNaN(parsed) ? "" : parsed;
      }
    }
    if (requiresReembed && oldVal !== meta[key]) {
      await refreshFileChunks(meta.id);
    }
  }

  saveState();
  state.activeAdvancedRAGSetting = null;
  state.uncommittedAdvancedRAGValue = null;
  renderApp(true);
  updateTokenCount();
}

export async function resetAdvancedRAGSetting() {
  if (!state.activeAdvancedRAGSetting || !state.activeAdvancedRAGFileId) return;
  const key = state.activeAdvancedRAGSetting;
  if (key === "fileText") return;

  const meta = state.files.find((f) => f.id === state.activeAdvancedRAGFileId);
  if (!meta) return;

  const requiresReembed = ["customChunks", "customChunker"].includes(key);
  const oldVal = meta[key];
  meta[key] = FILE_SETTING_DEFAULTS[key].default;

  if (requiresReembed && oldVal !== meta[key]) {
    await refreshFileChunks(meta.id);
  }

  saveState();
  state.activeAdvancedRAGSetting = null;
  state.uncommittedAdvancedRAGValue = null;
  renderApp(true);
  updateTokenCount();
}

export function cancelAdvancedRAGSetting() {
  state.activeAdvancedRAGSetting = null;
  state.uncommittedAdvancedRAGValue = null;
  renderApp(true);
}

export async function resetAllAdvancedRAGSettings() {
  if (!state.activeAdvancedRAGFileId) return;
  if (!confirm("Reset ALL Advanced RAG parameters to default for this file?")) return;

  const meta = state.files.find((f) => f.id === state.activeAdvancedRAGFileId);
  if (!meta) return;

  let requiresReembed = false;
  for (let key in FILE_SETTING_DEFAULTS) {
    if (key === "fileText") continue;
    if (["customChunks", "customChunker"].includes(key) && meta[key] !== undefined && meta[key] !== "" && meta[key] !== FILE_SETTING_DEFAULTS[key].default) {
      requiresReembed = true;
    }
    meta[key] = FILE_SETTING_DEFAULTS[key].default;
  }

  if (requiresReembed) {
    await refreshFileChunks(meta.id);
  }

  saveState();
  if (state.activeAdvancedRAGSetting) {
    state.uncommittedAdvancedRAGValue = null;
    if (state.activeAdvancedRAGSetting === "fileText") {
      const data = await dbGet(`mf_filedata_${meta.id}`);
      $("#chat-input").value = data ? data.text : "";
    } else {
      $("#chat-input").value = meta[state.activeAdvancedRAGSetting] !== undefined
          ? meta[state.activeAdvancedRAGSetting]
          : FILE_SETTING_DEFAULTS[state.activeAdvancedRAGSetting].default;
    }
  }
  renderApp(true);
  updateTokenCount();
}
