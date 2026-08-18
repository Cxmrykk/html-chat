import { state, dbSet, saveState, $, SETTING_DEFAULTS } from './state.js';
import { updateModelDropdown, updateTokenCount, applyInputAreaState } from './ui/components.js';
import { renderCurrentChat, renderApp } from './ui/render.js';
import { resetAllFileEmbeddings } from './embeddings/core.js';
import { saveAdvancedRAGSetting, resetAdvancedRAGSetting, cancelAdvancedRAGSetting } from './files.js';

export function saveConfig() {
  const oldRAG = state.config.embeddingsModel;

  state.config = {
    ...state.config,
    url: $("#cfg-url").value.trim(),
    key: $("#cfg-key").value.trim(),
    models: $("#cfg-models").value.trim(),
    godMode: $("#cfg-godmode").checked,
  };

  const newRAG = state.config.embeddingsModel;
  if (oldRAG !== newRAG) {
    resetAllFileEmbeddings();
  }

  saveState();
  updateModelDropdown();
  renderApp(true);
  updateTokenCount();
  alert("Settings saved.");
}

export function suspendSuperSecretSettings() {
  if (state.isSuperSecretSettingsOpen) {
    if (state.activeSuperSecretSetting) {
      state.uncommittedSuperSecretValue = $("#chat-input").value;
    }
    state.isSuperSecretSettingsOpen = false;
  }
  if (state.isAdvancedRAGSettingsOpen) {
    if (state.activeAdvancedRAGSetting) {
      state.uncommittedAdvancedRAGValue = $("#chat-input").value;
    }
    state.isAdvancedRAGSettingsOpen = false;
  }
}

export function toggleSuperSecretSettings() {
  if (state.isAdvancedRAGSettingsOpen) {
    if (state.activeAdvancedRAGSetting) {
      state.uncommittedAdvancedRAGValue = $("#chat-input").value;
    }
    state.isAdvancedRAGSettingsOpen = false;
    state.activeAdvancedRAGSetting = null;
    state.activeAdvancedRAGFileId = null;
  }

  state.isSuperSecretSettingsOpen = !state.isSuperSecretSettingsOpen;
  if (!state.isSuperSecretSettingsOpen) {
    state.activeSuperSecretSetting = null;
    state.uncommittedSuperSecretValue = null;
    $("#chat-input").value = "";
  } else {
    if (state.activeSuperSecretSetting) {
      const area = $("#chat-input");
      if (state.uncommittedSuperSecretValue !== null) {
        area.value = state.uncommittedSuperSecretValue;
      } else {
        area.value =
          state.config[state.activeSuperSecretSetting] !== "" &&
          state.config[state.activeSuperSecretSetting] !== undefined
            ? state.config[state.activeSuperSecretSetting]
            : SETTING_DEFAULTS[state.activeSuperSecretSetting].default;
      }
    }
  }
  renderCurrentChat();
  applyInputAreaState();
}

export function selectSuperSecretSetting(key) {
  state.activeSuperSecretSetting = key;
  state.uncommittedSuperSecretValue = null;
  const area = $("#chat-input");
  area.value =
    state.config[key] !== undefined && state.config[key] !== ""
      ? state.config[key]
      : SETTING_DEFAULTS[key].default;
  renderApp(true);
  area.focus();
}

export function saveSuperSecretSetting() {
  if (state.isAdvancedRAGSettingsOpen) {
    return saveAdvancedRAGSetting();
  }
  if (!state.activeSuperSecretSetting) return;

  let val = $("#chat-input").value;
  const key = state.activeSuperSecretSetting;
  const oldRAG = state.config.embeddingsModel;

  if (["godModePrompt", "embeddingsModel", "embeddingsUrl", "embeddingsKey", "streamResponse", "fileWrapperFunc"].includes(key)) {
    state.config[key] = val;
  } else {
    if (val.trim() === "") {
      state.config[key] = "";
    } else {
      const parsed = parseFloat(val);
      state.config[key] = isNaN(parsed) ? "" : parsed;
    }
  }

  if (oldRAG !== state.config.embeddingsModel) {
    resetAllFileEmbeddings();
  }

  saveState();
  state.activeSuperSecretSetting = null;
  state.uncommittedSuperSecretValue = null;
  renderApp(true);
  updateTokenCount();
}

export function resetSuperSecretSetting() {
  if (state.isAdvancedRAGSettingsOpen) {
    return resetAdvancedRAGSetting();
  }
  if (!state.activeSuperSecretSetting) return;

  const key = state.activeSuperSecretSetting;
  const oldRAG = state.config.embeddingsModel;
  state.config[key] = SETTING_DEFAULTS[key].default;

  if (oldRAG !== state.config.embeddingsModel) {
    resetAllFileEmbeddings();
  }

  saveState();
  state.activeSuperSecretSetting = null;
  state.uncommittedSuperSecretValue = null;
  renderApp(true);
  updateTokenCount();
}

export function cancelSuperSecretSetting() {
  if (state.isAdvancedRAGSettingsOpen) {
    return cancelAdvancedRAGSetting();
  }
  state.activeSuperSecretSetting = null;
  state.uncommittedSuperSecretValue = null;
  renderApp(true);
}

export function resetAllSuperSecretSettings() {
  if (!confirm("Reset ALL Advanced parameters to default?")) return;
  const oldRAG = state.config.embeddingsModel;

  for (let key in SETTING_DEFAULTS) {
    state.config[key] = SETTING_DEFAULTS[key].default;
  }

  if (oldRAG !== state.config.embeddingsModel) {
    resetAllFileEmbeddings();
  }

  saveState();
  if (state.activeSuperSecretSetting) {
    state.uncommittedSuperSecretValue = null;
    $("#chat-input").value = state.config[state.activeSuperSecretSetting] !== undefined
        ? state.config[state.activeSuperSecretSetting]
        : SETTING_DEFAULTS[state.activeSuperSecretSetting].default;
  }
  renderApp(true);
  updateTokenCount();
}

export function exportChats() {
  const dataStr = JSON.stringify(state.chats, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `html-chat-export-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportSingleChat(id) {
  const chat = state.chats.find((c) => c.id === id);
  if (!chat) return;

  const dataStr = JSON.stringify([chat], null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chat-timestamp-${chat.id}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importChats() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedChats = JSON.parse(event.target.result);
        if (!Array.isArray(importedChats)) {
          throw new Error("Invalid format: expected an array of chats.");
        }

        let addedCount = 0;
        const existingIds = new Set(state.chats.map((c) => c.id));

        for (const chat of importedChats) {
          if (!chat.id || !chat.messages) continue;
          if (!existingIds.has(chat.id)) {
            state.chats.push(chat);
            existingIds.add(chat.id);
            await dbSet(`mf_chat_${chat.id}`, chat);
            addedCount++;
          }
        }

        state.chats.sort((a, b) => Number(b.id) - Number(a.id));
        if (!state.currentChatId && state.chats.length > 0) {
          state.currentChatId = state.chats[0].id;
        }

        saveState();
        renderApp();
        alert(`Successfully imported ${addedCount} new chat(s).`);
      } catch (err) {
        alert("Failed to import chats: " + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}
