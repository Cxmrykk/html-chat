// --- RENDERING (Template Literals > DOM Building) ---
function renderApp(preserveScroll = false) {
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

  // Reset visibilities
  modelSel.classList.add("hidden");
  sendBtn.classList.add("hidden");
  saveBtn.classList.add("hidden");
  cancelBtn.classList.add("hidden");
  secSaveBtn.classList.add("hidden");
  secResetBtn.classList.add("hidden");
  secCancelBtn.classList.add("hidden");

  if (isSuperSecretSettingsOpen) {
    secSaveBtn.classList.remove("hidden");
    secResetBtn.classList.remove("hidden");
    secCancelBtn.classList.remove("hidden");
    area.style.height = promptHeight;

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
    area.placeholder = "";
    area.style.height = editHeight;
  } else {
    modelSel.classList.remove("hidden");
    sendBtn.classList.remove("hidden");
    area.disabled = false;
    area.placeholder = "Type your prompt here...";
    area.style.height = promptHeight;
  }
}

function renderChatList() {
  const list = $("#chat-list");
  if (!chats.length)
    return (list.innerHTML =
      '<p style="font-size:0.8em; color:#666;">No chats. Start a new one, asshole.</p>');

  list.innerHTML = chats
    .map(
      (chat) => `
    <div class="chat-item ${chat.id === currentChatId ? "active" : ""}" data-id="${chat.id}">
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
      if (k === "godModePrompt" || k === "embeddingsModel")
        return config[k] === SETTING_DEFAULTS[k].default ? "Default" : "Custom";
      return config[k] === "" || config[k] === undefined
        ? "API Default"
        : config[k];
    };

    const settingNames = {
      godModePrompt: "God Mode Prompt",
      temperature: "Temperature",
      top_p: "Top P",
      max_tokens: "Max Tokens",
      frequency_penalty: "Frequency Penalty",
      presence_penalty: "Presence Penalty",
      embeddingsModel: "Embeddings Model",
      chunkSize: "Chunk Size",
      chunkOverlap: "Chunk Overlap",
      topK: "Top K Chunks",
      chunkBatchSize: "Chunk Batch Size",
    };

    const buttonsHTML = Object.keys(SETTING_DEFAULTS)
      .map((k) => {
        return `<button class="${activeSuperSecretSetting === k ? "active-setting" : ""}" onclick="selectSuperSecretSetting('${k}')" style="width:100%; margin-bottom:5px; text-align:left; font-family: monospace;">Edit ${settingNames[k]} (Current: ${getSettingDisplay(k)})</button>`;
      })
      .join("");

    container.innerHTML = `
      <div style="height: 100%; display: flex; flex-direction: column; box-sizing: border-box;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
          <h2 style="margin: 0;">Super Secret Settings</h2>
          <button onclick="resetAllSuperSecretSettings()">Reset All to Default</button>
        </div>
        <p style="flex-shrink: 0; margin-top: 5px; font-size: 0.9em; color: #555;">Warning: Changes may vary based on LLM provider (i.e. LiteLLM users). Settings are not guaranteed to work for every provider.</p>
        
        <div style="flex-grow: 1; overflow-y: auto; margin: 10px 0;">
          ${buttonsHTML}
        </div>
      </div>
    `;
    return;
  }

  if (!currentChatId)
    return (container.innerHTML =
      '<h3 style="margin:0;">No chat selected.</h3>');
  const chat = chats.find((c) => c.id === currentChatId);

  let html = "";

  // Inject the visual-only read-only system prompt when God Mode is enabled
  if (config.godMode) {
    html += `
      <div class="msg system">
        <div class="msg-meta">
          <span>System</span>
          <div class="msg-actions">
            <span style="font-size: 0.8em; color: #888;">[Read-Only]</span>
          </div>
        </div>
        <div class="msg-content">${marked.parse("**JS Execution Enabled**. Proceed with caution.")}</div>
      </div>
    `;
  }

  if (!chat.messages.length && !config.godMode) {
    html +=
      '<p style="margin:0; padding-top: 15px;">It is fucking empty in here. Send a prompt.</p>';
  } else {
    html += chat.messages
      .map((msg, i) => {
        // Dynamically format <run> blocks for the UI without altering the saved state
        let displayContent = msg.content || "";
        if (msg.role === "assistant") {
          displayContent = displayContent.replace(
            /<run>([\s\S]*?)<\/run>/g,
            (match, code) =>
              `**Executing Code:**\n\`\`\`javascript\n${code.trim()}\n\`\`\``,
          );
        }

        return `
      <div class="msg ${msg.role} ${editingMessageIndex === i ? "editing" : ""}" data-index="${i}">
        <div class="msg-meta">
          <select class="role-select">
            <option value="user" ${msg.role === "user" ? "selected" : ""}>user</option>
            <option value="assistant" ${msg.role === "assistant" ? "selected" : ""}>assistant</option>
            <option value="system" ${msg.role === "system" ? "selected" : ""}>system</option>
            ${msg.role === "error" ? `<option value="error" selected>error</option>` : ""}
          </select>
          <div class="msg-actions">
            ${
              editingMessageIndex === i
                ? `<button data-action="save-edit">Save</button>
                   <button data-action="cancel-edit">Cancel</button>
                   <button data-action="toggle-wrap">Toggle Wrap</button>`
                : `<button data-action="edit">Edit</button>
                   <button data-action="fork">Fork</button>
                   ${msg.role === "user" ? `<button data-action="retry">Retry</button>` : ""}
                   <button data-action="delete">Delete</button>`
            }
          </div>
        </div>
        <div class="msg-content">${marked.parse(displayContent)}</div>
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
      container.scrollTop = lastMsg.classList.contains("user")
        ? container.scrollHeight
        : lastMsg.offsetTop - 15;
    }
  }

  updateTokenCount();
}
