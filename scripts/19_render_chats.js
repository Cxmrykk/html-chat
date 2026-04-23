// --- MAIN CHAT RENDER (AND SETTINGS UIs) ---
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
    if (isAdvanced)
      targetConfig = files.find((f) => f.id === activeAdvancedRAGFileId) || {};

    const getSettingDisplay = (k) => {
      const val = targetConfig[k];
      const isDefault =
        val === undefined || val === "" || val === settingsDefaults[k].default;

      if (isAdvanced)
        return k === "fileText" ? "Custom" : isDefault ? "Default" : "Custom";
      if (k === "godModePrompt" || k === "fileWrapperFunc")
        return isDefault ? "Default" : "Custom";
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
      chunkMaxTokens: "Max Tokens Per Chunk",
      chunkBatchSize: "Chunk Batch Size",
      chunkBatchMaxTokens: "Chunk Batch Max Tokens",
      maxVisibleChats: "Max Visible Chats",
      maxVisibleFiles: "Max Visible Files",
      fileWrapperFunc: "File Wrapper Function (JS)",
      fileText: "File Content Text",
      customChunks: "Custom Chunks (JSON)",
      customChunker: "Custom Chunking Function (JS)",
      retrievalFunc: "1. Retrieval Function (JS)",
      dedupFunc: "2. Deduplication Function (JS)",
      mergeChunksFunc: "3. Merge Chunks Function (JS)",
    };

    const categories = {};
    Object.keys(settingsDefaults).forEach((key) => {
      const cat = settingsDefaults[key].category || "Other";
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(key);
    });

    let sectionsHTML = "";
    for (const [catName, keys] of Object.entries(categories)) {
      sectionsHTML += `<div style="margin-top: 20px; border-bottom: 1px solid #ccc; padding-bottom: 5px;"><h3 style="margin: 0; font-size: 0.9em; text-transform: uppercase; color: #666;">${catName}</h3></div><div style="padding: 10px 0;">`;
      sectionsHTML += keys
        .map(
          (k) =>
            `<button class="${activeSetting === k ? "active-setting" : ""}" onclick="${isAdvanced ? `selectAdvancedRAGSetting('${k}')` : `selectSuperSecretSetting('${k}')`}" title="${escapeHTML(settingsDefaults[k].tooltip)}" style="width:100%; margin-bottom:5px; text-align:left; font-family: monospace; display: flex; justify-content: space-between;"><span>${settingNames[k] || k}</span><span style="opacity: 0.7;">${getSettingDisplay(k)}</span></button>`,
        )
        .join("");
      sectionsHTML += `</div>`;
    }

    let buttonsHTML = "";
    if (isAdvanced) {
      buttonsHTML = `<div style="display:flex; gap:10px; margin-top: 15px; flex-wrap: wrap;">
        <button onclick="attemptChunking()" title="Generate chunks and overwrite Custom Chunks array">Attempt Chunking</button>
        <button onclick="toggleAdvancedEmbedding()" title="Start or pause embeddings for this file">${targetConfig.isEmbedding ? "⏸ Pause Embedding" : "▶ Start Embedding"}</button>
        <button onclick="exportChunksAndVectors()" title="Export JSON of Chunk & Vector pairs">Export Vectors</button>
        <button onclick="importChunksAndVectors()" title="Import JSON of Chunk & Vector pairs">Import Vectors</button>
      </div>`;
    }

    container.innerHTML = `<div><div style="display: flex; justify-content: space-between; align-items: center;"><h2 style="margin: 0;">${isAdvanced ? `Advanced RAG Settings` : `Super Secret Settings`}</h2><button onclick="${isAdvanced ? `resetAllAdvancedRAGSettings()` : `resetAllSuperSecretSettings()`}">Reset All</button></div><p style="margin-top: 5px; font-size: 0.85em; color: #555;">${isAdvanced ? `Configure specific embedding and retrieval logic for this file. (${escapeHTML(targetConfig.name || "File")})` : `Advanced engine parameters. Hover over a setting to see its description.`}</p>${buttonsHTML}${sectionsHTML}</div>`;
    return;
  }

  if (!currentChatId)
    return (container.innerHTML =
      '<h3 style="margin:0;">No chat selected.</h3>');
  const chat = chats.find((c) => c.id === currentChatId);

  let html = "";
  if (config.godMode)
    html += `<div class="msg system"><div class="msg-meta"><span>System</span><div class="msg-actions"><span style="font-size: 0.8em; color: #888;">[Read-Only]</span></div></div><div class="msg-content">${marked.parse("**JS Execution Enabled**. Proceed with caution.")}</div></div>`;
  if (!chat.messages.length && !config.godMode)
    html +=
      '<p class="empty-chat-msg" style="margin:0; padding-top: 15px;">It is empty in here. Send a prompt.</p>';
  else
    html += chat.messages
      .map((msg, i) => generateMessageHTML(msg, i, editingMessageIndex === i))
      .join("");

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
