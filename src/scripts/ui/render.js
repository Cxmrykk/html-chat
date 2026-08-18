import { state, SETTING_DEFAULTS, FILE_SETTING_DEFAULTS, $, escapeHTML } from '../state.js';
import { applyInputAreaState, updateTokenCount, renderFileList, renderChatList } from './components.js';

export function generateMessageHTML(msg, i, isEditing = false) {
  let displayContent = msg.content || "";
  let configHtml = "";

  if (msg.role === "assistant") {
    displayContent = displayContent.replace(
      /<run>([\s\S]*?)<\/run>/g,
      (match, code) => `**Executing Code:**\n\`\`\`javascript\n${code.trim()}\n\`\`\``
    );
  } else if (msg.role === "file") {
    if (msg.mode === "embed") {
      displayContent = `*Estimated file size: ~${msg.approxTokens || 0} tokens*<br>*(<= ${msg.maxTokens || 5000} tokens with embeddings enabled)*`;
      if (msg.prompt) {
        displayContent += `\n\n**Search Prompt:** ${msg.prompt}`;
      }
      if (isEditing) {
        configHtml = `
          <div style="display:flex; gap:15px; flex-wrap:wrap; margin-top:10px; align-items:center; background: #eee; padding: 10px; border: 1px solid #ccc; border-radius: 4px;">
            <label style="display:flex; flex-direction:column; font-size:0.85em; font-weight:bold;">Max Tokens 
              <input type="number" class="embed-cfg-tokens" value="${msg.maxTokens || 5000}" style="width:100px; margin:4px 0 0 0; padding:4px; font-weight:normal;">
            </label>
            <label style="display:flex; flex-direction:column; font-size:0.85em; font-weight:bold;">Match Threshold 
              <input type="number" step="0.1" class="embed-cfg-threshold" value="${msg.ragThreshold || 0.0}" style="width:100px; margin:4px 0 0 0; padding:4px; font-weight:normal;">
            </label>
          </div>`;
      }
    } else {
      displayContent = `*Estimated file size: ~${msg.approxTokens || 0} tokens*`;
    }
  }

  let actionsHtml = "";
  if (isEditing) {
    actionsHtml = `
      <button data-action="save-edit">Save</button>
      <button data-action="cancel-edit">Cancel</button>
      <button data-action="toggle-wrap">Toggle Wrap</button>`;
  } else {
    let editBtn = `<button data-action="edit">${msg.role === "file" && msg.mode === "embed" ? "Config" : "Edit"}</button>`;
    if (msg.role === "file" && msg.mode === "embed") {
      actionsHtml = `${editBtn}<button data-action="run-embed">Embed</button><button data-action="fork">Fork</button><button data-action="delete">Delete</button>`;
    } else {
      actionsHtml = `${editBtn}<button data-action="fork">Fork</button>${msg.role === "user" || (msg.role === "file" && msg.mode === "full") ? `<button data-action="retry">Retry</button>` : ""}<button data-action="delete">Delete</button>`;
    }
  }

  return `
    <div class="msg ${msg.role} ${isEditing ? "editing" : ""}" data-index="${i}">
      <div class="msg-meta">
        ${
          msg.role === "file"
            ? `<span>FILE: ${escapeHTML(msg.fileName)}</span>`
            : `<select class="role-select">
            <option value="user" ${msg.role === "user" ? "selected" : ""}>user</option>
            <option value="assistant" ${msg.role === "assistant" ? "selected" : ""}>assistant</option>
            <option value="system" ${msg.role === "system" ? "selected" : ""}>system</option>
            ${msg.role === "error" ? `<option value="error" selected>error</option>` : ""}
          </select>`
        }
        <div class="msg-actions">${actionsHtml}</div>
      </div>
      <div class="msg-content">${window.marked.parse(displayContent)}${configHtml}</div>
    </div>`;
}

export function appendMessageToDOM(msg, index) {
  const container = $("#chat-container");
  if (!container) return;
  const emptyMsg = container.querySelector(".empty-chat-msg");
  if (emptyMsg) emptyMsg.remove();

  const wrapper = document.createElement("div");
  wrapper.innerHTML = generateMessageHTML(msg, index, false);
  const msgEl = wrapper.firstElementChild;
  container.appendChild(msgEl);

  window.renderMathInElement(msgEl, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
    ],
    output: "htmlAndMathml",
    throwOnError: false,
  });
  window.Prism.highlightAllUnder(msgEl);
  container.scrollTop = container.scrollHeight;
}

export function updateMessageInDOM(index) {
  const chat = state.chats.find((c) => c.id === state.currentChatId);
  const msg = chat.messages[index];
  const existingEl = document.querySelector(`.msg[data-index="${index}"]`);
  if (!existingEl) {
    return renderCurrentChat();
  }

  const wrapper = document.createElement("div");
  wrapper.innerHTML = generateMessageHTML(msg, index, state.editingMessageIndex === index);
  const newEl = wrapper.firstElementChild;

  existingEl.replaceWith(newEl);
  window.renderMathInElement(newEl, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
    ],
    output: "htmlAndMathml",
    throwOnError: false,
  });
  window.Prism.highlightAllUnder(newEl);
}

export function updateMessageContentInDOM(index, content, isFinal = true, alignMode = "none") {
  const el = document.querySelector(`.msg[data-index="${index}"] .msg-content`);
  if (!el) return;

  let displayContent = content.replace(
    /<run>([\s\S]*?)<\/run>/g,
    (match, code) => `**Executing Code:**\n\`\`\`javascript\n${code.trim()}\n\`\`\``
  );
  el.innerHTML = window.marked.parse(displayContent);

  if (isFinal) {
    window.renderMathInElement(el, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      output: "htmlAndMathml",
      throwOnError: false,
    });
    window.Prism.highlightAllUnder(el);
    const container = $("#chat-container");
    if (alignMode === "top") {
      const msgEl = el.closest(".msg");
      if (msgEl) container.scrollTop = msgEl.offsetTop - 15;
    } else if (alignMode === "bottom") {
      container.scrollTop = container.scrollHeight;
    }
  }
}

export function renderCurrentChat(preserveScroll = false) {
  const container = $("#chat-container");
  if (!container) return;
  const prevScroll = container.scrollTop;

  if (state.isSuperSecretSettingsOpen || state.isAdvancedRAGSettingsOpen) {
    const isAdvanced = state.isAdvancedRAGSettingsOpen;
    const settingsDefaults = isAdvanced ? FILE_SETTING_DEFAULTS : SETTING_DEFAULTS;
    const activeSetting = isAdvanced ? state.activeAdvancedRAGSetting : state.activeSuperSecretSetting;
    let targetConfig = state.config;
    if (isAdvanced) {
      targetConfig = state.files.find((f) => f.id === state.activeAdvancedRAGFileId) || {};
    }

    const getSettingDisplay = (k) => {
      const val = targetConfig[k];
      const isDefault = val === undefined || val === "" || val === settingsDefaults[k].default;

      if (isAdvanced) return k === "fileText" ? "Custom" : isDefault ? "Default" : "Custom";
      if (k === "godModePrompt" || k === "fileWrapperFunc") return isDefault ? "Default" : "Custom";
      if (k === "embeddingsKey") return val ? "Custom" : "API Default";
      if (k === "embeddingsModel") return val === "" || val === undefined ? "Disabled" : escapeHTML(val);
      if (k === "maxVisibleChats" || k === "maxVisibleFiles") return val === "" || val === undefined ? "Unlimited" : escapeHTML(String(val));

      let displayVal = val === "" || val === undefined ? "API Default" : val;
      return escapeHTML(String(displayVal));
    };

    const settingNames = {
      godModePrompt: "God Mode Prompt", temperature: "Temperature", top_p: "Top P",
      max_tokens: "Max Tokens", frequency_penalty: "Frequency Penalty", presence_penalty: "Presence Penalty",
      streamResponse: "Stream Response", embeddingsUrl: "Embeddings Base URL", embeddingsKey: "Embeddings API Key",
      embeddingsModel: "Embeddings Model", maxRagTokens: "Max RAG Tokens", ragThreshold: "RAG Match Threshold",
      chunkMaxTokens: "Max Tokens Per Chunk", chunkBatchSize: "Chunk Batch Size", chunkBatchMaxTokens: "Chunk Batch Max Tokens",
      maxVisibleChats: "Max Visible Chats", maxVisibleFiles: "Max Visible Files", fileWrapperFunc: "File Wrapper Function (JS)",
      fileText: "File Content Text", customChunks: "Custom Chunks (JSON)", customChunker: "Custom Chunking Function (JS)",
      retrievalFunc: "1. Retrieval Function (JS)", dedupFunc: "2. Deduplication Function (JS)", mergeChunksFunc: "3. Merge Chunks Function (JS)",
    };

    const categories = {};
    Object.keys(settingsDefaults).forEach((key) => {
      const cat = settingsDefaults[key].category || "Other";
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(key);
    });

    let sectionsHTML = "";
    for (const [catName, keys] of Object.entries(categories)) {
      sectionsHTML += `
        <div style="margin-top: 20px; border-bottom: 1px solid #ccc; padding-bottom: 5px;">
          <h3 style="margin: 0; font-size: 0.9em; text-transform: uppercase; color: #666;">${catName}</h3>
        </div>
        <div style="padding: 10px 0;">`;
      sectionsHTML += keys.map((k) => `
        <button class="${activeSetting === k ? "active-setting" : ""}" 
                onclick="${isAdvanced ? `selectAdvancedRAGSetting('${k}')` : `selectSuperSecretSetting('${k}')`}" 
                title="${escapeHTML(settingsDefaults[k].tooltip)}" 
                style="width:100%; margin-bottom:5px; text-align:left; font-family: monospace; display: flex; justify-content: space-between;">
          <span>${settingNames[k] || k}</span>
          <span style="opacity: 0.7;">${getSettingDisplay(k)}</span>
        </button>`).join("");
      sectionsHTML += `</div>`;
    }

    let buttonsHTML = "";
    if (isAdvanced) {
      buttonsHTML = `
        <div style="display:flex; gap:10px; margin-top: 15px; flex-wrap: wrap;">
          <button onclick="attemptChunking()" title="Generate chunks and overwrite Custom Chunks array">Attempt Chunking</button>
          <button onclick="toggleAdvancedEmbedding()" title="Start or pause embeddings for this file">${targetConfig.isEmbedding ? "⏸ Pause Embedding" : "▶ Start Embedding"}</button>
          <button onclick="exportChunksAndVectors()" title="Export JSON of Chunk & Vector pairs">Export Vectors</button>
          <button onclick="importChunksAndVectors()" title="Import JSON of Chunk & Vector pairs">Import Vectors</button>
        </div>`;
    }

    container.innerHTML = `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0;">${isAdvanced ? `Advanced RAG Settings` : `Super Secret Settings`}</h2>
          <button onclick="${isAdvanced ? `resetAllAdvancedRAGSettings()` : `resetAllSuperSecretSettings()`}">Reset All</button>
        </div>
        <p style="margin-top: 5px; font-size: 0.85em; color: #555;">${isAdvanced ? `Configure specific embedding and retrieval logic for this file. (${escapeHTML(targetConfig.name || "File")})` : `Advanced engine parameters. Hover over a setting to see its description.`}</p>
        ${buttonsHTML}
        ${sectionsHTML}
      </div>`;
    return;
  }

  if (!state.currentChatId) {
    container.innerHTML = '<h3 style="margin:0;">No chat selected.</h3>';
    return;
  }
  const chat = state.chats.find((c) => c.id === state.currentChatId);

  let html = "";
  if (state.config.godMode) {
    html += `<div class="msg system"><div class="msg-meta"><span>System</span><div class="msg-actions"><span style="font-size: 0.8em; color: #888;">[Read-Only]</span></div></div><div class="msg-content">${window.marked.parse("**JS Execution Enabled**. Proceed with caution.")}</div></div>`;
  }
  
  if (!chat.messages.length && !state.config.godMode) {
    html += '<p class="empty-chat-msg" style="margin:0; padding-top: 15px;">It is empty in here. Send a prompt.</p>';
  } else {
    html += chat.messages.map((msg, i) => generateMessageHTML(msg, i, state.editingMessageIndex === i)).join("");
  }

  container.innerHTML = html;

  window.renderMathInElement(container, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
    ],
    output: "htmlAndMathml",
    throwOnError: false,
  });
  window.Prism.highlightAllUnder(container);

  if (preserveScroll) {
    container.scrollTop = prevScroll;
  } else {
    const lastMsg = container.lastElementChild;
    if (lastMsg && lastMsg.classList.contains("msg")) {
      container.scrollTop = lastMsg.classList.contains("user") || lastMsg.classList.contains("file")
          ? container.scrollHeight : lastMsg.offsetTop - 15;
    }
  }
  updateTokenCount();
}

export function renderApp(preserveScroll = false) {
  renderFileList();
  renderChatList();
  renderCurrentChat(preserveScroll);
  applyInputAreaState();
}

if (window.marked) {
  window.marked.use({
    extensions: [
      {
        name: "math",
        level: "inline",
        start(src) { return src.match(/\$/)?.index; },
        tokenizer(src) {
          const blockMatch = /^\$\$([\s\S]+?)\$\$/.exec(src);
          if (blockMatch) return { type: "math", raw: blockMatch[0], text: blockMatch[1] };
          const inlineMatch = /^\$([^\s$](?:\\.|[^$\n])*?)\$/.exec(src);
          if (inlineMatch) return { type: "math", raw: inlineMatch[0], text: inlineMatch[1] };
        },
        renderer(token) { return escapeHTML(token.raw); },
      },
    ],
  });
}
