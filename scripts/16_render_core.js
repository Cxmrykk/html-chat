// --- CORE RENDERING ---
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
  const modelSel = $("#model-select"),
    sendBtn = $("#send-btn"),
    saveBtn = $("#save-edit-btn");
  const cancelBtn = $("#cancel-edit-btn"),
    secSaveBtn = $("#secret-save-btn");
  const secResetBtn = $("#secret-reset-btn"),
    secCancelBtn = $("#secret-cancel-btn");

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
