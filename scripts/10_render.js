// --- RENDERING LOGIC ---
marked.use({
  extensions: [
    {
      name: "math",
      level: "inline",
      start(src) {
        return src.match(/\$/)?.index;
      },
      tokenizer(src) {
        const blockMatch = /^\$\$([\s\S]+?)\$\$/.exec(src);
        if (blockMatch)
          return { type: "math", raw: blockMatch[0], text: blockMatch[1] };
        const inlineMatch = /^\$([^\s$](?:\\.|[^$\n])*?)\$/.exec(src);
        if (inlineMatch)
          return { type: "math", raw: inlineMatch[0], text: inlineMatch[1] };
      },
      renderer(token) {
        return escapeHTML(token.raw);
      },
    },
  ],
});

function renderApp(preserveScroll = false) {
  renderFileList();
  renderChatList();
  renderCurrentChat(preserveScroll);
  applyInputAreaState();
}

function applyInputAreaState() {
  const area = $("#chat-input");
  if (!area) return;
  const modelSel = $("#model-select");
  const sendBtn = $("#send-btn");
  const saveBtn = $("#save-edit-btn");
  const cancelBtn = $("#cancel-edit-btn");
  const secSaveBtn = $("#secret-save-btn");
  const secResetBtn = $("#secret-reset-btn");
  const secCancelBtn = $("#secret-cancel-btn");

  modelSel.classList.add("hidden");
  sendBtn.classList.add("hidden");
  saveBtn.classList.add("hidden");
  cancelBtn.classList.add("hidden");
  secSaveBtn.classList.add("hidden");
  secResetBtn.classList.add("hidden");
  secCancelBtn.classList.add("hidden");

  area.style.height = promptHeight;

  if (isSuperSecretSettingsOpen || isAdvancedRAGSettingsOpen) {
    secSaveBtn.classList.remove("hidden");
    secResetBtn.classList.remove("hidden");
    secCancelBtn.classList.remove("hidden");

    const isAdvanced = isAdvancedRAGSettingsOpen;
    const activeSetting = isAdvanced
      ? activeAdvancedRAGSetting
      : activeSuperSecretSetting;
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
  } else if (editingMessageIndex !== null) {
    saveBtn.classList.remove("hidden");
    cancelBtn.classList.remove("hidden");
    area.disabled = false;

    const chat = chats.find((c) => c.id === currentChatId);
    const isFile = chat && chat.messages[editingMessageIndex]?.role === "file";
    const isEmbed =
      isFile && chat.messages[editingMessageIndex]?.mode === "embed";

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

function renderFileList() {
  const list = $("#file-list");

  const maxVisible = parseInt(config.maxVisibleFiles, 10);
  if (!isNaN(maxVisible) && maxVisible > 0) {
    list.style.maxHeight = `calc(${maxVisible} * (1.6em + 17px))`;
    list.style.overflowY = "auto";
  } else {
    list.style.maxHeight = "";
    list.style.overflowY = "";
  }

  if (!files.length)
    return (list.innerHTML =
      '<p style="font-size:0.8em; color:#666;">No files uploaded.</p>');

  const embeddingsEnabled = !!(
    config.embeddingsModel && config.embeddingsModel.trim() !== ""
  );

  list.innerHTML = files
    .map((f) => {
      let embedBtn = "";
      let progressBar = "";

      if (embeddingsEnabled) {
        progressBar = `<div class="file-progress-bar" style="width: ${f.progress}%"></div>`;
        if (f.progress >= 100) {
          embedBtn = `<button data-action="embed" title="Insert Embedding">e</button>`;
        }
      }

      return `
    <div class="chat-item" data-id="${f.id}" data-type="file" title="Ctrl+Click for Advanced RAG Settings">
      <div class="chat-item-title" data-action="load" title="Click to insert full contents into chat\nAlt+Click to overwrite contents">${escapeHTML(f.name)}</div>
      <div class="chat-item-actions">
        ${embedBtn}
        <button data-action="delete" title="Delete File">d</button>
      </div>
      ${progressBar}
    </div>
  `;
    })
    .join("");
}

function renderChatList() {
  const list = $("#chat-list");

  const maxVisible = parseInt(config.maxVisibleChats, 10);
  if (!isNaN(maxVisible) && maxVisible > 0) {
    list.style.maxHeight = `calc(${maxVisible} * (1.6em + 17px))`;
    list.style.overflowY = "auto";
  } else {
    list.style.maxHeight = "";
    list.style.overflowY = "";
  }

  if (!chats.length)
    return (list.innerHTML =
      '<p style="font-size:0.8em; color:#666;">No chats. Start a new one.</p>');

  list.innerHTML = chats
    .map(
      (chat) => `
    <div class="chat-item ${chat.id === currentChatId ? "active" : ""}" data-id="${chat.id}" data-type="chat">
      <div class="chat-item-title" data-action="load" title="Export: Alt+Click">${escapeHTML(chat.title)}</div>
      <div class="chat-item-actions">
        <button data-action="rename" title="Rename">r</button>
        <button data-action="delete" title="Delete">d</button>
      </div>
    </div>
  `,
    )
    .join("");
}

function generateMessageHTML(msg, i, isEditing = false) {
  let displayContent = msg.content || "";
  let configHtml = "";

  if (msg.role === "assistant") {
    displayContent = displayContent.replace(
      /<run>([\s\S]*?)<\/run>/g,
      (match, code) =>
        `**Executing Code:**\n\`\`\`javascript\n${code.trim()}\n\`\`\``,
    );
  } else if (msg.role === "file") {
    if (msg.mode === "embed") {
      displayContent = `*Estimated file size: ~${msg.approxTokens || 0} tokens*<br>*(<= ${msg.maxTokens || 5000} tokens with embeddings enabled)*`;
      if (msg.prompt) displayContent += `\n\n**Search Prompt:** ${msg.prompt}`;

      if (isEditing) {
        configHtml = `
<div style="display:flex; gap:15px; flex-wrap:wrap; margin-top:10px; align-items:center; background: #eee; padding: 10px; border: 1px solid #ccc; border-radius: 4px;">
<label style="display:flex; flex-direction:column; font-size:0.85em; font-weight:bold;">Max Tokens <input type="number" class="embed-cfg-tokens" value="${msg.maxTokens || 5000}" style="width:100px; margin:4px 0 0 0; padding:4px; font-weight:normal;"></label>
<label style="display:flex; flex-direction:column; font-size:0.85em; font-weight:bold;">Match Threshold <input type="number" step="0.1" class="embed-cfg-threshold" value="${msg.ragThreshold || 0.0}" style="width:100px; margin:4px 0 0 0; padding:4px; font-weight:normal;"></label>
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
      <button data-action="toggle-wrap">Toggle Wrap</button>
    `;
  } else {
    let editBtn = `<button data-action="edit">Edit</button>`;
    if (msg.role === "file" && msg.mode === "embed") {
      editBtn = `<button data-action="edit">Config</button>`;
    }
    actionsHtml = `
      ${editBtn}
      <button data-action="fork">Fork</button>
      ${msg.role === "user" || msg.role === "file" ? `<button data-action="retry">Retry</button>` : ""}
      <button data-action="delete">Delete</button>
    `;
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
      <div class="msg-content">${marked.parse(displayContent)}${configHtml}</div>
    </div>
  `;
}

function appendMessageToDOM(msg, index) {
  const container = $("#chat-container");

  const emptyMsg = container.querySelector(".empty-chat-msg");
  if (emptyMsg) emptyMsg.remove();

  const wrapper = document.createElement("div");
  wrapper.innerHTML = generateMessageHTML(msg, index, false);

  const msgEl = wrapper.firstElementChild;
  container.appendChild(msgEl);

  renderMathInElement(msgEl, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
    ],
    output: "htmlAndMathml",
    throwOnError: false,
  });
  Prism.highlightAllUnder(msgEl);
  container.scrollTop = container.scrollHeight;
}

function updateMessageInDOM(index) {
  const chat = chats.find((c) => c.id === currentChatId);
  const msg = chat.messages[index];
  const existingEl = document.querySelector(`.msg[data-index="${index}"]`);

  if (!existingEl) return renderCurrentChat();

  const wrapper = document.createElement("div");
  wrapper.innerHTML = generateMessageHTML(
    msg,
    index,
    editingMessageIndex === index,
  );
  const newEl = wrapper.firstElementChild;

  existingEl.replaceWith(newEl);
  renderMathInElement(newEl, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
    ],
    output: "htmlAndMathml",
    throwOnError: false,
  });
  Prism.highlightAllUnder(newEl);
}

function updateMessageContentInDOM(
  index,
  content,
  isFinal = true,
  alignMode = "none",
) {
  const el = document.querySelector(`.msg[data-index="${index}"] .msg-content`);
  if (!el) return;

  let displayContent = content;
  displayContent = displayContent.replace(
    /<run>([\s\S]*?)<\/run>/g,
    (match, code) =>
      `**Executing Code:**\n\`\`\`javascript\n${code.trim()}\n\`\`\``,
  );

  el.innerHTML = marked.parse(displayContent);
  if (isFinal) {
    renderMathInElement(el, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      output: "htmlAndMathml",
      throwOnError: false,
    });
    Prism.highlightAllUnder(el);

    const container = $("#chat-container");
    if (alignMode === "top") {
      const msgEl = el.closest(".msg");
      if (msgEl) {
        container.scrollTop = msgEl.offsetTop - 15;
      }
    } else if (alignMode === "bottom") {
      container.scrollTop = container.scrollHeight;
    }
  }
}

function renderCurrentChat(preserveScroll = false) {
  const container = $("#chat-container");
  const prevScroll = container.scrollTop;

  if (isSuperSecretSettingsOpen || isAdvancedRAGSettingsOpen) {
    const isAdvanced = isAdvancedRAGSettingsOpen;
    const settingsDefaults = isAdvanced
      ? FILE_SETTING_DEFAULTS
      : SETTING_DEFAULTS;
    const activeSetting = isAdvanced
      ? activeAdvancedRAGSetting
      : activeSuperSecretSetting;
    let targetConfig = config;
    if (isAdvanced) {
      targetConfig = files.find((f) => f.id === activeAdvancedRAGFileId) || {};
    }

    const getSettingDisplay = (k) => {
      const val = targetConfig[k];
      const isDefault =
        val === undefined || val === "" || val === settingsDefaults[k].default;

      if (isAdvanced) {
        if (k === "fileText") return "Custom";
        return isDefault ? "Default" : "Custom";
      }

      if (k === "godModePrompt") return isDefault ? "Default" : "Custom";
      if (k === "embeddingsKey") return val ? "Custom" : "API Default";
      if (k === "embeddingsModel")
        return val === "" || val === undefined ? "Disabled" : escapeHTML(val);
      if (k === "maxVisibleChats" || k === "maxVisibleFiles")
        return val === "" || val === undefined
          ? "Unlimited"
          : escapeHTML(String(val));

      let displayVal = val === "" || val === undefined ? "API Default" : val;
      return escapeHTML(String(displayVal));
    };

    const settingNames = {
      godModePrompt: "God Mode Prompt",
      temperature: "Temperature",
      top_p: "Top P",
      max_tokens: "Max Tokens",
      frequency_penalty: "Frequency Penalty",
      presence_penalty: "Presence Penalty",
      streamResponse: "Stream Response",
      embeddingsUrl: "Embeddings Base URL",
      embeddingsKey: "Embeddings API Key",
      embeddingsModel: "Embeddings Model",
      maxRagTokens: "Max RAG Tokens",
      ragThreshold: "RAG Match Threshold",
      chunkBatchSize: "Chunk Batch Size",
      maxVisibleChats: "Max Visible Chats",
      maxVisibleFiles: "Max Visible Files",

      fileText: "File Content Text",
      customChunks: "Custom Chunks (JSON)",
      customChunker: "Custom Chunking Function (JS)",
      captureFunc: "1. Capture Function (JS)",
      retrievalFunc: "2. Retrieval Function (JS)",
      dedupFunc: "3. Deduplication Function (JS)",
      mergeChunksFunc: "4. Merge Chunks Function (JS)",
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

      sectionsHTML += keys
        .map((k) => {
          const isActive = activeSetting === k;
          const tooltip = settingsDefaults[k].tooltip;
          const onclickFn = isAdvanced
            ? `selectAdvancedRAGSetting('${k}')`
            : `selectSuperSecretSetting('${k}')`;
          return `<button 
          class="${isActive ? "active-setting" : ""}" 
          onclick="${onclickFn}" 
          title="${escapeHTML(tooltip)}"
          style="width:100%; margin-bottom:5px; text-align:left; font-family: monospace; display: flex; justify-content: space-between;">
            <span>${settingNames[k] || k}</span>
            <span style="opacity: 0.7;">${getSettingDisplay(k)}</span>
        </button>`;
        })
        .join("");

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
        </div>
      `;
    }

    const resetFn = isAdvanced
      ? `resetAllAdvancedRAGSettings()`
      : `resetAllSuperSecretSettings()`;
    const title = isAdvanced
      ? `Advanced RAG Settings`
      : `Super Secret Settings`;
    const subtitle = isAdvanced
      ? `Configure specific embedding and retrieval logic for this file. (${escapeHTML(targetConfig.name || "File")})`
      : `Advanced engine parameters. Hover over a setting to see its description.`;

    container.innerHTML = `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0;">${title}</h2>
          <button onclick="${resetFn}">Reset All</button>
        </div>
        <p style="margin-top: 5px; font-size: 0.85em; color: #555;">
          ${subtitle}
        </p>
        ${buttonsHTML}
        ${sectionsHTML}
      </div>
    `;
    return;
  }

  if (!currentChatId)
    return (container.innerHTML =
      '<h3 style="margin:0;">No chat selected.</h3>');
  const chat = chats.find((c) => c.id === currentChatId);

  let html = "";

  if (config.godMode) {
    html += `
      <div class="msg system">
        <div class="msg-meta">
          <span>System</span>
          <div class="msg-actions"><span style="font-size: 0.8em; color: #888;">[Read-Only]</span></div>
        </div>
        <div class="msg-content">${marked.parse("**JS Execution Enabled**. Proceed with caution.")}</div>
      </div>
    `;
  }

  if (!chat.messages.length && !config.godMode) {
    html +=
      '<p class="empty-chat-msg" style="margin:0; padding-top: 15px;">It is empty in here. Send a prompt.</p>';
  } else {
    html += chat.messages
      .map((msg, i) => generateMessageHTML(msg, i, editingMessageIndex === i))
      .join("");
  }

  container.innerHTML = html;

  renderMathInElement(container, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
    ],
    output: "htmlAndMathml",
    throwOnError: false,
  });
  Prism.highlightAllUnder(container);

  if (preserveScroll) container.scrollTop = prevScroll;
  else {
    const lastMsg = container.lastElementChild;
    if (lastMsg && lastMsg.classList.contains("msg")) {
      container.scrollTop =
        lastMsg.classList.contains("user") || lastMsg.classList.contains("file")
          ? container.scrollHeight
          : lastMsg.offsetTop - 15;
    }
  }

  updateTokenCount();
}
