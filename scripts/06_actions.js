// --- CHAT & FILE ACTIONS (CRUD) ---
function suspendSuperSecretSettings() {
  if (isSuperSecretSettingsOpen) {
    if (activeSuperSecretSetting) {
      uncommittedSuperSecretValue = $("#chat-input").value;
    }
    isSuperSecretSettingsOpen = false;
  }
  if (isAdvancedRAGSettingsOpen) {
    if (activeAdvancedRAGSetting) {
      uncommittedAdvancedRAGValue = $("#chat-input").value;
    }
    isAdvancedRAGSettingsOpen = false;
  }
}

function handleNewChatClick(e) {
  if (e.altKey) {
    e.preventDefault();
    importChats();
  } else {
    newChat();
  }
}

function newChat() {
  suspendSuperSecretSettings();
  resetEditState();
  const id = Date.now().toString();
  chats.unshift({ id, title: "New Chat", messages: [] });
  currentChatId = id;
  if (window.innerWidth <= 768) {
    isSidebarHidden = true;
    applySidebarState();
  }
  invalidateTokenCache();
  saveState();
  renderApp();
  updateTokenCount();
}

function loadChat(id) {
  suspendSuperSecretSettings();
  resetEditState();
  currentChatId = id;
  if (window.innerWidth <= 768) {
    isSidebarHidden = true;
    applySidebarState();
  }
  invalidateTokenCache();
  saveState();
  renderApp();
}

function deleteChat(id) {
  suspendSuperSecretSettings();
  resetEditState();
  chats = chats.filter((c) => c.id !== id);
  if (currentChatId === id) currentChatId = chats.length ? chats[0].id : null;
  invalidateTokenCache();
  saveState();
  renderApp();
}

function renameChat(id) {
  const chat = chats.find((c) => c.id === id);
  const newTitle = prompt("Rename chat:", chat.title);
  if (newTitle) {
    chat.title = newTitle.trim();
    saveState();
    renderChatList();
  }
}

function forkChat(msgIndex) {
  suspendSuperSecretSettings();
  resetEditState();
  const chat = chats.find((c) => c.id === currentChatId);
  const newId = Date.now().toString();
  chats.unshift({
    id: newId,
    title: chat.title + " (Forked)",
    messages: JSON.parse(JSON.stringify(chat.messages.slice(0, msgIndex + 1))),
  });
  currentChatId = newId;
  invalidateTokenCache();
  saveState();
  renderApp();
}

function retryMessage(msgIndex) {
  resetEditState();
  const chat = chats.find((c) => c.id === currentChatId);
  const msg = chat.messages[msgIndex];

  const container = $("#chat-container");
  const msgs = container.querySelectorAll(".msg");

  if (msg.role === "file") {
    chat.messages = chat.messages.slice(0, msgIndex + 1);
    invalidateTokenCache();
    saveState();

    // Soft DOM removal (prevents full thread-blocking render)
    for (let i = 0; i < msgs.length; i++) {
      const idx = parseInt(msgs[i].dataset.index, 10);
      if (idx > msgIndex) msgs[i].remove();
    }
    sendMessage();
  } else {
    $("#chat-input").value = msg.content;
    chat.messages = chat.messages.slice(0, msgIndex);
    invalidateTokenCache();
    saveState();

    // Soft DOM removal
    for (let i = 0; i < msgs.length; i++) {
      const idx = parseInt(msgs[i].dataset.index, 10);
      if (idx >= msgIndex) msgs[i].remove();
    }
    sendMessage();
  }
}

function deleteMessage(msgIndex) {
  if (editingMessageIndex === msgIndex) cancelGlobalEdit();
  else if (editingMessageIndex !== null && editingMessageIndex > msgIndex) {
    editingMessageIndex--;
  }
  chats.find((c) => c.id === currentChatId).messages.splice(msgIndex, 1);
  invalidateTokenCache();
  saveState();

  // Soft DOM update to prevent lag and maintain text selection
  const container = $("#chat-container");
  const msgEl = container.querySelector(`.msg[data-index="${msgIndex}"]`);
  if (msgEl) msgEl.remove();

  const msgs = container.querySelectorAll(".msg");
  msgs.forEach((el) => {
    const idx = parseInt(el.dataset.index, 10);
    if (idx > msgIndex) {
      el.dataset.index = idx - 1;
    }
  });
}

async function handleUploadClick() {
  const picked = await pickFiles(true);
  if (!picked || !picked.length) return;
  for (const f of picked) {
    const text = await readFileText(f);
    await uploadFile(f.name, text);
  }
}

async function reuploadFile(id) {
  const picked = await pickFiles(false);
  if (!picked || !picked.length) return;
  const text = await readFileText(picked[0]);
  const meta = files.find((f) => f.id === id);
  await uploadFile(meta ? meta.name : picked[0].name, text, id);
}

async function uploadFile(name, text, existingId = null) {
  let id =
    existingId || Date.now().toString() + Math.floor(Math.random() * 1000);
  let meta = files.find((f) => f.id === id);

  if (!meta) {
    let baseName = name;
    let counter = 1;
    while (files.some((f) => f.name === name)) {
      name = `${baseName} (${counter++})`;
    }
    meta = {
      id,
      name,
      progress: 0,
      exactProgress: 0,
      isEmbedding: false,
      chunkCount: 0,
      embeddedCount: 0,
      textLength: text.length,
    };
    files.unshift(meta);
    await dbSet(`mf_filedata_${id}`, { id, name, text });
  } else {
    meta.textLength = text.length;
    const data = await dbGet(`mf_filedata_${id}`);
    data.text = text;
    await dbSet(`mf_filedata_${id}`, data);
    await refreshFileChunks(id);
  }

  saveState();
  renderFileList();
}

async function deleteFile(id) {
  if (isAdvancedRAGSettingsOpen && activeAdvancedRAGFileId === id) {
    toggleAdvancedRAGSettings(null);
  }
  files = files.filter((f) => f.id !== id);

  // Clean up normalized records
  await dbDelete(`mf_filedata_${id}`);
  await dbDeleteByPrefix(`mf_chunk_${id}_`);

  saveState();
  renderFileList();
}

async function toggleEmbedding(id) {
  const meta = files.find((f) => f.id === id);
  if (!meta) return;
  if (!config.embeddingsModel || config.embeddingsModel.trim() === "") {
    alert("Please configure an embeddings model in Settings first.");
    return;
  }

  meta.isEmbedding = !meta.isEmbedding;

  if (!meta.isEmbedding) {
    // Abort active fetch requests cleanly when pausing
    if (embeddingAbortControllers[id]) {
      embeddingAbortControllers[id].abort();
      delete embeddingAbortControllers[id];
    }
    meta.embeddingSpeed = null;
    meta.embeddingEta = null;
  }

  saveState();
  renderFileList();

  // Re-render ONLY if looking at the settings for this specific file
  if (isAdvancedRAGSettingsOpen && activeAdvancedRAGFileId === id) {
    renderCurrentChat(true);
  }

  if (meta.isEmbedding) {
    // Wait for any previous loop to finish cleaning up if spam-clicked
    while (meta._embeddingLoopActive) {
      await new Promise((r) => setTimeout(r, 50));
    }
    // Verify it wasn't paused again while waiting
    if (meta.isEmbedding) {
      startEmbeddingLoop(id);
    }
  }
}

async function attemptChunking() {
  if (!activeAdvancedRAGFileId) return;
  const meta = files.find((f) => f.id === activeAdvancedRAGFileId);
  const data = await dbGet(`mf_filedata_${activeAdvancedRAGFileId}`);
  if (!meta || !data) return;

  const text = data.text || "";
  let chunks = [];

  const chunkerCode =
    meta.customChunker && meta.customChunker.trim() !== ""
      ? meta.customChunker
      : FILE_SETTING_DEFAULTS.customChunker.default;

  try {
    const fn = new AsyncFunction("fileContents", "config", chunkerCode);
    const res = await fn(text, config);
    if (Array.isArray(res))
      chunks = res.filter((c) => c !== null && c !== undefined);
  } catch (e) {
    alert("Error executing customChunker: " + e.message);
    return;
  }

  meta.customChunks = JSON.stringify(chunks, null, 2);
  saveState();
  await refreshFileChunks(meta.id);

  if (activeAdvancedRAGSetting === "customChunks") {
    await selectAdvancedRAGSetting("customChunks");
  } else {
    renderApp(true);
  }
}

function toggleAdvancedEmbedding() {
  if (!activeAdvancedRAGFileId) return;
  toggleEmbedding(activeAdvancedRAGFileId);
}

function resetEditState() {
  editingMessageIndex = null;
  const area = $("#chat-input");
  if (area) {
    area.style.whiteSpace = "";
    area.style.overflowX = "";
    if (!isSuperSecretSettingsOpen && !isAdvancedRAGSettingsOpen) {
      area.value = "";
      area.style.height = promptHeight;
    }
  }
}

function startGlobalEdit(index) {
  const prevIdx = editingMessageIndex;
  editingMessageIndex = index;

  if (prevIdx !== null) updateMessageInDOM(prevIdx);
  updateMessageInDOM(index);

  const chat = chats.find((c) => c.id === currentChatId);
  const msg = chat.messages[index];
  const area = $("#chat-input");

  area.value =
    msg.role === "file" && msg.mode === "embed"
      ? msg.prompt || ""
      : msg.content;
  applyInputAreaState();
  area.focus();
}

function saveGlobalEdit() {
  if (editingMessageIndex === null) return;
  const chat = chats.find((c) => c.id === currentChatId);
  const msg = chat.messages[editingMessageIndex];

  if (msg.role === "file") {
    if (msg.mode === "embed") {
      msg.prompt = $("#chat-input").value;
      const tEl = document.querySelector(
        `.msg[data-index="${editingMessageIndex}"] .embed-cfg-tokens`,
      );
      if (tEl) msg.maxTokens = parseInt(tEl.value, 10) || 5000;

      const thEl = document.querySelector(
        `.msg[data-index="${editingMessageIndex}"] .embed-cfg-threshold`,
      );
      if (thEl) msg.ragThreshold = parseFloat(thEl.value) || 0.0;
    } else {
      msg.content = $("#chat-input").value;
      msg.approxTokens = Math.ceil(msg.content.length / 4);
    }
  } else {
    msg.content = $("#chat-input").value;
  }

  invalidateTokenCache();
  saveState();
  endGlobalEdit();
}

function cancelGlobalEdit() {
  endGlobalEdit();
}

function endGlobalEdit() {
  const idx = editingMessageIndex;
  resetEditState();
  if (idx !== null) updateMessageInDOM(idx);
  applyInputAreaState();
}

function toggleGlobalWrap() {
  const area = $("#chat-input");
  area.style.whiteSpace = area.style.whiteSpace === "pre" ? "pre-wrap" : "pre";
  area.style.overflowX = area.style.whiteSpace === "pre" ? "auto" : "hidden";
}

function toggleSuperSecretSettings() {
  if (isAdvancedRAGSettingsOpen) {
    if (activeAdvancedRAGSetting) {
      uncommittedAdvancedRAGValue = $("#chat-input").value;
    }
    isAdvancedRAGSettingsOpen = false;
    activeAdvancedRAGSetting = null;
    activeAdvancedRAGFileId = null;
  }

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
  renderCurrentChat();
  applyInputAreaState();
}

async function toggleAdvancedRAGSettings(id = null) {
  if (isSuperSecretSettingsOpen) toggleSuperSecretSettings();

  if (id === null && isAdvancedRAGSettingsOpen) {
    if (activeAdvancedRAGSetting) {
      uncommittedAdvancedRAGValue = $("#chat-input").value;
    }
    isAdvancedRAGSettingsOpen = false;
    $("#chat-input").value = "";
    renderCurrentChat();
    applyInputAreaState();
    return;
  }

  if (id !== null) {
    if (isAdvancedRAGSettingsOpen && activeAdvancedRAGFileId === id) {
      if (activeAdvancedRAGSetting) {
        uncommittedAdvancedRAGValue = $("#chat-input").value;
      }
      isAdvancedRAGSettingsOpen = false;
      $("#chat-input").value = "";
    } else {
      if (isAdvancedRAGSettingsOpen && activeAdvancedRAGSetting) {
        uncommittedAdvancedRAGValue = $("#chat-input").value;
      }
      const isReopeningSame = activeAdvancedRAGFileId === id;
      isAdvancedRAGSettingsOpen = true;
      activeAdvancedRAGFileId = id;

      if (!isReopeningSame) {
        activeAdvancedRAGSetting = null;
        uncommittedAdvancedRAGValue = null;
        $("#chat-input").value = "";
      } else {
        if (activeAdvancedRAGSetting) {
          const area = $("#chat-input");
          if (uncommittedAdvancedRAGValue !== null) {
            area.value = uncommittedAdvancedRAGValue;
          } else {
            if (activeAdvancedRAGSetting === "fileText") {
              const data = await dbGet(`mf_filedata_${id}`);
              area.value = data ? data.text : "";
            } else {
              const meta = files.find((f) => f.id === id);
              area.value =
                meta &&
                meta[activeAdvancedRAGSetting] !== undefined &&
                meta[activeAdvancedRAGSetting] !== ""
                  ? meta[activeAdvancedRAGSetting]
                  : FILE_SETTING_DEFAULTS[activeAdvancedRAGSetting].default;
            }
          }
        }
      }
    }
  }
  renderCurrentChat();
  applyInputAreaState();
}
