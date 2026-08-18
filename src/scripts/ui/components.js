import { state, DEFAULT_GOD_MODE_PROMPT, SETTING_DEFAULTS, FILE_SETTING_DEFAULTS, $, escapeHTML } from '../state.js';

export function updateModelDropdown() {
  const select = $("#model-select");
  if (!select) return;
  const models = state.config.models.split(",").map((m) => m.trim()).filter(Boolean);
  select.innerHTML = models.map((m) => `<option value="${m}">${m}</option>`).join("");
  if (state.config.lastModel && models.includes(state.config.lastModel)) {
    select.value = state.config.lastModel;
  } else if (models.length > 0) {
    state.config.lastModel = models[0];
  }
}

export function saveLastModel() {
  const select = $("#model-select");
  if (select) {
    state.config.lastModel = select.value;
  }
}

export function toggleSidebar() {
  state.isSidebarHidden = !state.isSidebarHidden;
  applySidebarState();
}

export function applySidebarState() {
  const sidebar = $("#sidebar");
  const btn = $("#toggle-sidebar-btn");
  if (sidebar) sidebar.classList.toggle("hidden", state.isSidebarHidden);
  if (btn) btn.textContent = state.isSidebarHidden ? "[show sidebar]" : "[hide sidebar]";
}

export function toggleTitle() {
  state.isTitleHidden = !state.isTitleHidden;
  applyTitleState();
}

export function applyTitleState() {
  const header = $("#header");
  const btn = $("#toggle-title-btn");
  if (header) header.classList.toggle("hidden", state.isTitleHidden);
  if (btn) btn.textContent = state.isTitleHidden ? "[show title]" : "[hide title]";
}

export function applyInputAreaState() {
  const area = $("#chat-input");
  if (!area) return;
  const modelSel = $("#model-select"), sendBtn = $("#send-btn"), saveBtn = $("#save-edit-btn");
  const cancelBtn = $("#cancel-edit-btn"), secSaveBtn = $("#secret-save-btn");
  const secResetBtn = $("#secret-reset-btn"), secCancelBtn = $("#secret-cancel-btn");

  modelSel.classList.add("hidden");
  sendBtn.classList.add("hidden");
  saveBtn.classList.add("hidden");
  cancelBtn.classList.add("hidden");
  secSaveBtn.classList.add("hidden");
  secResetBtn.classList.add("hidden");
  secCancelBtn.classList.add("hidden");

  area.style.height = state.promptHeight;

  if (state.isSuperSecretSettingsOpen || state.isAdvancedRAGSettingsOpen) {
    secSaveBtn.classList.remove("hidden");
    secResetBtn.classList.remove("hidden");
    secCancelBtn.classList.remove("hidden");

    const isAdvanced = state.isAdvancedRAGSettingsOpen;
    const activeSetting = isAdvanced ? state.activeAdvancedRAGSetting : state.activeSuperSecretSetting;
    const defaultsMap = isAdvanced ? FILE_SETTING_DEFAULTS : SETTING_DEFAULTS;

    if (!activeSetting) {
      area.disabled = true;
      if (area.value !== "") area.value = "";
      area.placeholder = "Select a setting above to edit...";
      secSaveBtn.disabled = true;
      secResetBtn.disabled = true;
      secCancelBtn.disabled = true;
    } else {
      area.disabled = false;
      secSaveBtn.disabled = false;
      secResetBtn.disabled = false;
      secCancelBtn.disabled = false;
      area.placeholder = defaultsMap[activeSetting].tooltip;
    }
  } else if (state.editingMessageIndex !== null) {
    saveBtn.classList.remove("hidden");
    cancelBtn.classList.remove("hidden");
    area.disabled = false;

    const chat = state.chats.find((c) => c.id === state.currentChatId);
    const isFile = chat && chat.messages[state.editingMessageIndex]?.role === "file";
    const isEmbed = isFile && chat.messages[state.editingMessageIndex]?.mode === "embed";

    area.placeholder = isEmbed
      ? "Type an embeddings prompt here. Default behavior: Uses subsequent user messages for search."
      : "";
  } else {
    modelSel.classList.remove("hidden");
    sendBtn.classList.remove("hidden");
    area.disabled = false;
    area.placeholder = "Type your prompt here...";
  }
}

export function updateTokenCount() {
  const btn = $("#send-btn");
  if (!btn) return;
  if (
    btn.textContent.includes("Thinking") ||
    btn.textContent.includes("Generating") ||
    btn.textContent.includes("Embedding") ||
    btn.classList.contains("hidden")
  ) {
    return;
  }

  if (state.cachedContextChars === -1) {
    let contextChars = 0;
    if (state.currentChatId) {
      const chat = state.chats.find((c) => c.id === state.currentChatId);
      if (chat && chat.messages) {
        contextChars = chat.messages.reduce((acc, m) => {
          if (m.role === "file") {
            if (m.mode === "full") return acc + (m.content || "").length;
            return acc;
          }
          return acc + (m.content || "").length;
        }, 0);
      }
    }
    if (state.config.godMode) {
      contextChars += (state.config.godModePrompt || DEFAULT_GOD_MODE_PROMPT).length;
    }
    state.cachedContextChars = contextChars;
  }

  const inputEl = $("#chat-input");
  const inputVal = inputEl ? inputEl.value || "" : "";
  const totalChars = inputVal.length + state.cachedContextChars;
  const tokens = Math.ceil(totalChars / 4);

  if (tokens < 1000) {
    btn.textContent = "Send";
  } else {
    let label;
    if (tokens >= 1000000) {
      label = (tokens / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    } else {
      label = (tokens / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    }
    btn.textContent = `Send (${label} tokens)`;
  }
}

export function updateFileProgressDOM(id) {
  const f = state.files.find((meta) => meta.id === id);
  if (!f) return;

  const itemEl = document.querySelector(`.chat-item[data-id="${id}"][data-type="file"]`);
  if (itemEl) {
    let statsEl = itemEl.querySelector(".file-progress-stats");
    let barEl = itemEl.querySelector(".file-progress-bar");

    if (f.isEmbedding && f.progress < 100) {
      const speed = f.embeddingSpeed ? `${f.embeddingSpeed.toFixed(1)} c/s` : "...";
      let eta = "...";
      if (f.embeddingEta !== undefined && f.embeddingEta !== null) {
        if (f.embeddingEta > 3600) {
          eta = `${Math.floor(f.embeddingEta / 3600)}h ${Math.floor((f.embeddingEta % 3600) / 60)}m ${Math.round(f.embeddingEta % 60)}s`;
        } else if (f.embeddingEta > 60) {
          eta = `${Math.floor(f.embeddingEta / 60)}m ${Math.round(f.embeddingEta % 60)}s`;
        } else {
          eta = `${Math.round(f.embeddingEta)}s`;
        }
      }
      const pct = f.exactProgress !== undefined ? f.exactProgress.toFixed(1) : (f.progress || 0).toFixed(1);

      if (!statsEl) {
        statsEl = document.createElement("div");
        statsEl.className = "file-progress-stats";
        statsEl.style.cssText = "font-size: 0.75em; color: #666; text-align: left; margin-top: 2px;";
        itemEl.insertBefore(statsEl, barEl || null);
      }
      statsEl.innerHTML = `<div>Progress: ${pct}% (${speed})</div><div>ETA: ${eta}</div>`;
    } else if (statsEl) {
      statsEl.remove();
    }

    if (barEl) {
      barEl.style.width = `${f.exactProgress !== undefined ? f.exactProgress : f.progress}%`;
    }

    const actionsEl = itemEl.querySelector(".chat-item-actions");
    if (actionsEl) {
      let embedBtn = actionsEl.querySelector('button[data-action="embed"]');
      if (f.progress >= 100 && !embedBtn) {
        embedBtn = document.createElement("button");
        embedBtn.dataset.action = "embed";
        embedBtn.title = "Insert Embedding";
        embedBtn.textContent = "e";
        actionsEl.insertBefore(embedBtn, actionsEl.firstChild);
      } else if (f.progress < 100 && embedBtn) {
        embedBtn.remove();
      }
    }
  }

  if (state.isAdvancedRAGSettingsOpen && state.activeAdvancedRAGFileId === id) {
    const toggleBtn = document.querySelector('button[onclick="toggleAdvancedEmbedding()"]');
    if (toggleBtn) {
      toggleBtn.textContent = f.isEmbedding ? "⏸ Pause Embedding" : "▶ Start Embedding";
    }
  }
}

export function renderFileList() {
  const list = $("#file-list");
  if (!list) return;
  const maxVisible = parseInt(state.config.maxVisibleFiles, 10);
  if (!isNaN(maxVisible) && maxVisible > 0) {
    list.style.maxHeight = `calc(${maxVisible} * (1.6em + 17px))`;
    list.style.overflowY = "auto";
  } else {
    list.style.maxHeight = "";
    list.style.overflowY = "";
  }

  if (!state.files.length) {
    list.innerHTML = '<p style="font-size:0.8em; color:#666;">No files uploaded.</p>';
    return;
  }
  
  const embeddingsEnabled = !!(state.config.embeddingsModel && state.config.embeddingsModel.trim() !== "");

  list.innerHTML = state.files.map((f) => {
    let embedBtn = "", progressBar = "", progressStats = "";
    if (embeddingsEnabled) {
      if (f.isEmbedding && f.progress < 100) {
        const speed = f.embeddingSpeed ? `${f.embeddingSpeed.toFixed(1)} c/s` : "...";
        let eta = "...";
        if (f.embeddingEta !== undefined && f.embeddingEta !== null) {
          if (f.embeddingEta > 60) {
            eta = `${Math.floor(f.embeddingEta / 60)}m ${Math.round(f.embeddingEta % 60)}s`;
          } else {
            eta = `${Math.round(f.embeddingEta)}s`;
          }
        }
        progressStats = `<div class="file-progress-stats" style="font-size: 0.75em; color: #666; text-align: left; margin-top: 2px;"><div>Progress: ${(f.exactProgress || f.progress || 0).toFixed(1)}% (${speed})</div><div>ETA: ${eta}</div></div>`;
      }
      progressBar = `<div class="file-progress-bar" style="width: ${f.exactProgress !== undefined ? f.exactProgress : f.progress}%"></div>`;
      if (f.progress >= 100) {
        embedBtn = `<button data-action="embed" title="Insert Embedding">e</button>`;
      }
    }

    return `
      <div class="chat-item" style="display:block;" data-id="${f.id}" data-type="file" title="Ctrl+Click for Advanced RAG Settings">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div class="chat-item-title" data-action="load" title="Click to insert full contents into chat\nAlt+Click to overwrite contents">${escapeHTML(f.name)}</div>
          <div class="chat-item-actions">
            ${embedBtn}
            <button data-action="delete" title="Delete File">d</button>
          </div>
        </div>
        ${progressStats}
        ${progressBar}
      </div>`;
  }).join("");
}

export function renderChatList() {
  const list = $("#chat-list");
  if (!list) return;
  const maxVisible = parseInt(state.config.maxVisibleChats, 10);
  if (!isNaN(maxVisible) && maxVisible > 0) {
    list.style.maxHeight = `calc(${maxVisible} * (1.6em + 17px))`;
    list.style.overflowY = "auto";
  } else {
    list.style.maxHeight = "";
    list.style.overflowY = "";
  }

  if (!state.chats.length) {
    list.innerHTML = '<p style="font-size:0.8em; color:#666;">No chats. Start a new one.</p>';
    return;
  }

  list.innerHTML = state.chats.map((chat) => `
    <div class="chat-item ${chat.id === state.currentChatId ? "active" : ""}" data-id="${chat.id}" data-type="chat">
      <div class="chat-item-title" data-action="load" title="Export: Alt+Click">${escapeHTML(chat.title)}</div>
      <div class="chat-item-actions">
        <button data-action="rename" title="Rename">r</button>
        <button data-action="delete" title="Delete">d</button>
      </div>
    </div>`
  ).join("");
}
