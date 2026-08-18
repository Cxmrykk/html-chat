import { state, dbGet, dbDelete, saveState, saveAllChats, SETTING_DEFAULTS, $ } from './state.js';
import { updateModelDropdown, applySidebarState, applyTitleState, updateTokenCount, toggleSidebar, toggleTitle, saveLastModel } from './ui/components.js';
import { renderApp } from './ui/render.js';
import { startEmbeddingLoop, toggleAdvancedEmbedding } from './embeddings/core.js';
import { attemptChunking, exportChunksAndVectors, importChunksAndVectors, executeEmbedMessage } from './embeddings/rag.js';
import { saveConfig, importChats, exportChats, saveSuperSecretSetting, resetSuperSecretSetting, cancelSuperSecretSetting, selectSuperSecretSetting, resetAllSuperSecretSettings, toggleSuperSecretSettings, exportSingleChat } from './settings.js';
import { handleNewChatClick, handleUploadClick, loadChat, renameChat, deleteChat, deleteFile, appendFileMessage, reuploadFile, toggleAdvancedRAGSettings, selectAdvancedRAGSetting, resetAllAdvancedRAGSettings, newChat } from './files.js';
import { sendMessage, saveGlobalEdit, cancelGlobalEdit, startGlobalEdit, toggleGlobalWrap, forkChat, retryMessage, deleteMessage } from './chat.js';

// Expose functions to HTML inline event handlers
window.toggleTitle = toggleTitle;
window.toggleSidebar = toggleSidebar;
window.saveConfig = saveConfig;
window.importChats = importChats;
window.exportChats = exportChats;
window.handleNewChatClick = handleNewChatClick;
window.handleUploadClick = handleUploadClick;
window.saveLastModel = saveLastModel;
window.sendMessage = sendMessage;
window.saveGlobalEdit = saveGlobalEdit;
window.cancelGlobalEdit = cancelGlobalEdit;
window.saveSuperSecretSetting = saveSuperSecretSetting;
window.resetSuperSecretSetting = resetSuperSecretSetting;
window.cancelSuperSecretSetting = cancelSuperSecretSetting;
window.attemptChunking = attemptChunking;
window.toggleAdvancedEmbedding = toggleAdvancedEmbedding;
window.exportChunksAndVectors = exportChunksAndVectors;
window.importChunksAndVectors = importChunksAndVectors;
window.selectAdvancedRAGSetting = selectAdvancedRAGSetting;
window.selectSuperSecretSetting = selectSuperSecretSetting;
window.resetAllAdvancedRAGSettings = resetAllAdvancedRAGSettings;
window.resetAllSuperSecretSettings = resetAllSuperSecretSettings;

function setupEventDelegation() {
  const settingsHeading = $("#settings-heading");
  if (settingsHeading) {
    settingsHeading.addEventListener("click", (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        toggleSuperSecretSettings();
      }
    });
  }

  const sidebar = $("#sidebar");
  if (sidebar) {
    sidebar.addEventListener("click", (e) => {
      const item = e.target.closest(".chat-item");
      if (!item) return;
      const id = item.dataset.id;
      const type = item.dataset.type || "chat";
      const action = e.target.dataset.action;

      if (type === "chat") {
        if (action === "rename") renameChat(id);
        else if (action === "delete") deleteChat(id);
        else if (action === "load") {
          if (e.altKey) { 
            e.preventDefault(); 
            exportSingleChat(id); 
          } else if (e.ctrlKey || e.metaKey) {
            const chat = state.chats.find((c) => c.id === id);
            const apiMessages = chat.messages.filter((m) => m.role !== "error" && !(m.role === "file" && m.mode === "embed"));
            const text = `# ${chat.title}\n\n` + apiMessages.map((m) => {
              const roleLabel = m.role === "file" ? "USER" : m.role.toUpperCase();
              return `## ${roleLabel}\n${m.content || ""}\n\n`;
            }).join("");
            navigator.clipboard.writeText(text.trim()).then(() => {
              item.style.background = "#ccc";
              setTimeout(() => (item.style.background = ""), 150);
            });
          } else {
            loadChat(id);
          }
        }
      } else if (type === "file") {
        if (e.ctrlKey || e.metaKey) { 
          e.preventDefault(); 
          toggleAdvancedRAGSettings(id); 
          return; 
        }
        if (action === "delete") deleteFile(id);
        else if (action === "embed") {
          const meta = state.files.find((f) => f.id === id);
          if (meta && meta.progress >= 100) appendFileMessage(id, "embed");
        } else if (action === "load") {
          if (e.altKey) { 
            e.preventDefault(); 
            reuploadFile(id); 
          } else {
            appendFileMessage(id, "full");
          }
        }
      }
    });
  }

  const chatContainer = $("#chat-container");
  if (chatContainer) {
    chatContainer.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const msgDiv = btn.closest(".msg");
      if (!msgDiv || !msgDiv.hasAttribute("data-index")) return;
      const index = parseInt(msgDiv.dataset.index, 10);
      if (isNaN(index)) return;

      const action = btn.dataset.action;
      if (action === "edit") startGlobalEdit(index);
      else if (action === "save-edit") saveGlobalEdit();
      else if (action === "cancel-edit") cancelGlobalEdit();
      else if (action === "toggle-wrap") toggleGlobalWrap();
      else if (action === "fork") forkChat(index);
      else if (action === "retry") retryMessage(index);
      else if (action === "delete") deleteMessage(index);
      else if (action === "run-embed") executeEmbedMessage(index);
    });

    chatContainer.addEventListener("change", (e) => {
      if (e.target.classList.contains("role-select")) {
        const msgDiv = e.target.closest(".msg");
        if (!msgDiv || !msgDiv.hasAttribute("data-index")) return;
        const index = parseInt(msgDiv.dataset.index, 10);
        if (isNaN(index)) return;

        const chat = state.chats.find((c) => c.id === state.currentChatId);
        chat.messages[index].role = e.target.value;
        saveState();
        renderApp(true);
      }
    });
  }
}

function setupKeyboardListeners() {
  const chatInput = $("#chat-input");
  if (chatInput) {
    chatInput.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        if (state.isSuperSecretSettingsOpen && state.activeSuperSecretSetting) {
          saveSuperSecretSetting();
        } else if (state.editingMessageIndex !== null) {
          saveGlobalEdit();
        } else {
          sendMessage(0, e.shiftKey);
        }
      }
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "t") { 
      e.preventDefault(); 
      newChat(); 
      if ($("#chat-input")) $("#chat-input").focus(); 
    }
    if (e.altKey && e.key.toLowerCase() === "w") { 
      e.preventDefault(); 
      if (state.currentChatId) deleteChat(state.currentChatId); 
    }
    if (e.altKey && e.key.toLowerCase() === "r") { 
      e.preventDefault(); 
      if (state.currentChatId) renameChat(state.currentChatId); 
    }
    if (e.altKey && e.key.toLowerCase() === "p") { 
      e.preventDefault(); 
      toggleSidebar(); 
    }
    if (e.altKey && e.key.toLowerCase() === "o") { 
      e.preventDefault(); 
      toggleTitle(); 
    }
    if (e.altKey && e.key.toLowerCase() === "i") { 
      e.preventDefault(); 
      toggleSuperSecretSettings(); 
    }

    if (e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      if (document.activeElement?.tagName === "TEXTAREA") return;
      e.preventDefault();
      const container = $("#chat-container");
      if (!container) return;
      const msgs = Array.from(container.querySelectorAll(".msg"));
      if (!msgs.length) return;

      if (e.key === "ArrowDown") {
        const next = msgs.find((m) => m.offsetTop - 15 > container.scrollTop + 5);
        container.scrollTop = next ? next.offsetTop - 15 : container.scrollHeight;
      } else {
        const prev = msgs.slice().reverse().find((m) => m.offsetTop - 15 < container.scrollTop - 5);
        container.scrollTop = prev ? prev.offsetTop - 15 : 0;
      }
    }

    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      if (!state.chats.length) return;
      let idx = Math.max(0, state.chats.findIndex((c) => c.id === state.currentChatId));
      if (e.key === "ArrowUp" && idx > 0) {
        loadChat(state.chats[idx - 1].id);
      }
      if (e.key === "ArrowDown" && idx < state.chats.length - 1) {
        loadChat(state.chats[idx + 1].id);
      }

      const activeChat = document.querySelector("#chat-list .chat-item.active");
      if (activeChat) activeChat.scrollIntoView({ block: "nearest" });
    }

    if (!e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const tag = document.activeElement?.tagName.toLowerCase();
      if (tag !== "input" && tag !== "textarea" && tag !== "select") {
        e.preventDefault();
        const container = $("#chat-container");
        if (container) container.scrollBy({ top: e.key === "ArrowDown" ? 150 : -150, behavior: "smooth" });
      }
    }
  });

  const toggleModifierMode = (e) => {
    if (e.key === "Control" || e.key === "Meta") document.body.classList.toggle("ctrl-down", e.type === "keydown");
    if (e.key === "Alt") document.body.classList.toggle("alt-down", e.type === "keydown");
  };
  window.addEventListener("keydown", toggleModifierMode);
  window.addEventListener("keyup", toggleModifierMode);
  window.addEventListener("blur", () => {
    document.body.classList.remove("ctrl-down");
    document.body.classList.remove("alt-down");
  });

  const chatContainer = $("#chat-container");
  if (chatContainer) {
    chatContainer.addEventListener("click", (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target.closest(".katex") || e.target.closest("pre") || e.target.closest("code");
      if (!target) return;

      let text = target.classList.contains("katex")
        ? target.querySelector("annotation")?.textContent || target.querySelector(".katex-mathml math")?.getAttribute("alttext") || ""
        : target.innerText;

      if (text) {
        e.preventDefault();
        navigator.clipboard.writeText(text).then(() => {
          const bg = target.style.backgroundColor;
          target.style.backgroundColor = "#ccc";
          setTimeout(() => (target.style.backgroundColor = bg), 100);
        });
      }
    });
  }
}

async function init() {
  state.config = (await dbGet("mf_config")) || {
    url: "https://api.openai.com/v1",
    key: "",
    models: "gpt-4o, gpt-4-turbo, gpt-3.5-turbo",
    godMode: false,
    lastModel: "",
  };

  for (const key in SETTING_DEFAULTS) {
    if (state.config[key] === undefined) {
      state.config[key] = SETTING_DEFAULTS[key].default;
    }
  }

  let oldChats = await dbGet("mf_chats");
  if (oldChats && Array.isArray(oldChats) && oldChats.length > 0) {
    state.chats = oldChats;
    await saveAllChats();
    await dbDelete("mf_chats");
  } else {
    const index = (await dbGet("mf_chat_index")) || [];
    state.chats = [];
    for (let idx of index) {
      let chatData = await dbGet(`mf_chat_${idx.id}`);
      if (chatData) {
        state.chats.push(chatData);
      } else {
        state.chats.push({ id: idx.id, title: idx.title, messages: [] });
      }
    }
  }

  state.files = (await dbGet("mf_files")) || [];
  state.currentChatId = (await dbGet("mf_current_chat_id")) || null;
  state.isSidebarHidden = (await dbGet("mf_sidebar_hidden")) === true;
  state.isTitleHidden = (await dbGet("mf_title_hidden")) === true;
  state.promptHeight = (await dbGet("mf_prompt_height")) || "";

  if ($("#cfg-url")) $("#cfg-url").value = state.config.url;
  if ($("#cfg-key")) $("#cfg-key").value = state.config.key;
  if ($("#cfg-models")) $("#cfg-models").value = state.config.models;
  if ($("#cfg-godmode")) $("#cfg-godmode").checked = state.config.godMode || false;

  updateModelDropdown();
  applySidebarState();
  applyTitleState();

  const chatInput = $("#chat-input");
  if (chatInput) {
    chatInput.style.height = state.promptHeight;
    chatInput.addEventListener("input", updateTokenCount);

    const textareaObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const h = entry.target.style.height;
        if (!h) continue;
        state.promptHeight = h;
        saveState();
      }
    });
    textareaObserver.observe(chatInput);
  }

  state.chats.sort((a, b) => Number(b.id) - Number(a.id));

  if (!state.currentChatId && state.chats.length > 0) {
    state.currentChatId = state.chats[0].id;
  }

  for (const f of state.files) {
    f._embeddingLoopActive = false; 
    if (f.isEmbedding && f.progress < 100) {
      startEmbeddingLoop(f.id);
    } else if (f.progress >= 100) {
      f.isEmbedding = false;
    }
  }

  setupEventDelegation();
  setupKeyboardListeners();

  renderApp();
}

init();
