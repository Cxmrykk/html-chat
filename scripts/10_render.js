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

  if (isSuperSecretSettingsOpen) {
    secSaveBtn.classList.remove("hidden");
    secResetBtn.classList.remove("hidden");
    secCancelBtn.classList.remove("hidden");

    if (!activeSuperSecretSetting) {
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
      area.placeholder = SETTING_DEFAULTS[activeSuperSecretSetting].tooltip;
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
      ? "Default behavior: Uses subsequent user messages for search."
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
        if (f.progress < 100) {
          embedBtn = `<button data-action="embed" title="${f.isEmbedding ? "Pause Embedding" : "Start Embedding"}">${f.isEmbedding ? "⏸" : "e"}</button>`;
        } else {
          embedBtn = `<button data-action="embed" title="Insert Embedding">e</button>`;
        }
      }

      return `
    <div class="chat-item" data-id="${f.id}" data-type="file">
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

function renderCurrentChat(preserveScroll = false) {
  const container = $("#chat-container");
  const prevScroll = container.scrollTop;

  if (isSuperSecretSettingsOpen) {
    const getSettingDisplay = (k) => {
      const val = config[k];
      const isDefault =
        val === undefined || val === "" || val === SETTING_DEFAULTS[k].default;

      if (k === "godModePrompt") return isDefault ? "Default" : "Custom";
      if (k === "embeddingsKey") return val ? "Custom" : "API Default";
      if (k === "embeddingsModel")
        return val === "" || val === undefined ? "Disabled" : escapeHTML(val);

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
      embeddingsUrl: "Embeddings Base URL",
      embeddingsKey: "Embeddings API Key",
      embeddingsModel: "Embeddings Model",
      chunkSize: "Chunk Size",
      chunkOverlap: "Chunk Overlap",
      maxRagTokens: "Max RAG Tokens",
      ragThreshold: "RAG Match Threshold",
      chunkBatchSize: "Chunk Batch Size",
      chunkSeparator: "Chunk Separator",
    };

    const categories = {};
    Object.keys(SETTING_DEFAULTS).forEach((key) => {
      const cat = SETTING_DEFAULTS[key].category || "Other";
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
          const isActive = activeSuperSecretSetting === k;
          const tooltip = SETTING_DEFAULTS[k].tooltip;
          return `<button 
          class="${isActive ? "active-setting" : ""}" 
          onclick="selectSuperSecretSetting('${k}')" 
          title="${escapeHTML(tooltip)}"
          style="width:100%; margin-bottom:5px; text-align:left; font-family: monospace; display: flex; justify-content: space-between;">
            <span>Edit ${settingNames[k]}</span>
            <span style="opacity: 0.7;">${getSettingDisplay(k)}</span>
        </button>`;
        })
        .join("");

      sectionsHTML += `</div>`;
    }

    container.innerHTML = `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0;">Super Secret Settings</h2>
          <button onclick="resetAllSuperSecretSettings()">Reset All</button>
        </div>
        <p style="margin-top: 5px; font-size: 0.85em; color: #555;">
          Advanced engine parameters. Hover over a setting to see its description.
        </p>
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
      '<p style="margin:0; padding-top: 15px;">It is empty in here. Send a prompt.</p>';
  } else {
    html += chat.messages
      .map((msg, i) => {
        let isEditing = editingMessageIndex === i;
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
            if (msg.prompt)
              displayContent += `\n\n**Search Prompt:** ${msg.prompt}`;

            if (isEditing) {
              configHtml = `
<div style="display:flex; gap:15px; flex-wrap:wrap; margin-top:10px; align-items:center; background: #eee; padding: 10px; border: 1px solid #ccc; border-radius: 4px;">
  <label style="display:flex; flex-direction:column; font-size:0.85em; font-weight:bold;">Max Tokens <input type="number" class="embed-cfg-tokens" value="${msg.maxTokens || 5000}" style="width:100px; margin:4px 0 0 0; padding:4px; font-weight:normal;"></label>
  <label style="display:flex; flex-direction:column; font-size:0.85em; font-weight:bold;">Match Threshold <input type="number" step="0.1" class="embed-cfg-threshold" value="${msg.ragThreshold || 0.0}" style="width:100px; margin:4px 0 0 0; padding:4px; font-weight:normal;"></label>
  <label style="display:flex; flex-direction:column; font-size:0.85em; font-weight:bold;">Chunk Separator <input type="text" class="embed-cfg-separator" value="${escapeHTML(msg.chunkSeparator !== undefined ? msg.chunkSeparator : "...")}" style="width:120px; margin:4px 0 0 0; padding:4px; font-weight:normal;"></label>
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
      })
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
