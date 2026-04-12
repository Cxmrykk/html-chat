// --- DOM EVENT DELEGATION ---
$("#settings-heading").addEventListener("click", (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    isSuperSecretSettingsOpen = !isSuperSecretSettingsOpen;
    if (!isSuperSecretSettingsOpen) {
      activeSuperSecretSetting = null;
      uncommittedSuperSecretValue = null;
      $("#chat-input").value = "";
    } else {
      if (activeSuperSecretSetting) {
        const area = $("#chat-input");
        if (uncommittedSuperSecretValue !== null) {
          area.value = uncommittedSuperSecretValue;
        } else {
          area.value =
            config[activeSuperSecretSetting] !== "" &&
            config[activeSuperSecretSetting] !== undefined
              ? config[activeSuperSecretSetting]
              : SETTING_DEFAULTS[activeSuperSecretSetting].default;
        }
      }
    }
    renderApp();
  }
});

$("#sidebar").addEventListener("click", (e) => {
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
        const chat = chats.find((c) => c.id === id);
        const text =
          `# ${chat.title}\n\n` +
          chat.messages
            .map(
              (m) =>
                `## ${m.role.toUpperCase()}\n${m.content || m.prompt || ""}\n\n`,
            )
            .join("");
        navigator.clipboard.writeText(text.trim()).then(() => {
          item.style.background = "#ccc";
          setTimeout(() => (item.style.background = ""), 150);
        });
      } else loadChat(id);
    }
  } else if (type === "file") {
    if (action === "delete") deleteFile(id);
    else if (action === "embed") {
      const meta = files.find((f) => f.id === id);
      if (meta && meta.progress >= 100) {
        appendFileMessage(id, "embed");
      } else {
        toggleEmbedding(id);
      }
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

$("#chat-container").addEventListener("click", (e) => {
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
});

$("#chat-container").addEventListener("change", (e) => {
  if (e.target.classList.contains("role-select")) {
    const msgDiv = e.target.closest(".msg");
    if (!msgDiv || !msgDiv.hasAttribute("data-index")) return;
    const index = parseInt(msgDiv.dataset.index, 10);
    if (isNaN(index)) return;

    const chat = chats.find((c) => c.id === currentChatId);

    chat.messages[index].role = e.target.value;
    saveState();
    renderApp(true);
  }
});
