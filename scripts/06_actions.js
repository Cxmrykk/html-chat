// --- CHAT & FILE ACTIONS (CRUD) ---
function suspendSuperSecretSettings() {
  if (isSuperSecretSettingsOpen) {
    if (activeSuperSecretSetting) {
      uncommittedSuperSecretValue = $("#chat-input").value;
    }
    isSuperSecretSettingsOpen = false;
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
  saveState();
  renderApp();
}

function deleteChat(id) {
  suspendSuperSecretSettings();
  resetEditState();
  chats = chats.filter((c) => c.id !== id);
  if (currentChatId === id) currentChatId = chats.length ? chats[0].id : null;
  saveState();
  renderApp();
}

function renameChat(id) {
  const chat = chats.find((c) => c.id === id);
  const newTitle = prompt("Rename chat:", chat.title);
  if (newTitle) {
    chat.title = newTitle.trim();
    saveState();
    renderApp(true);
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
  saveState();
  renderApp();
}

function retryMessage(msgIndex) {
  resetEditState();
  const chat = chats.find((c) => c.id === currentChatId);
  const msg = chat.messages[msgIndex];

  if (msg.role === "file") {
    chat.messages = chat.messages.slice(0, msgIndex + 1);
    saveState();
    sendMessage();
  } else {
    $("#chat-input").value = msg.content;
    chat.messages = chat.messages.slice(0, msgIndex);
    saveState();
    sendMessage();
  }
}

function deleteMessage(msgIndex) {
  if (editingMessageIndex === msgIndex) resetEditState();
  else if (editingMessageIndex !== null && editingMessageIndex > msgIndex) {
    editingMessageIndex--;
  }
  chats.find((c) => c.id === currentChatId).messages.splice(msgIndex, 1);
  saveState();
  renderApp(true);
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
      isEmbedding: false,
      chunkCount: 0,
      embeddedCount: 0,
      textLength: text.length,
    };
    files.unshift(meta);
  } else {
    meta.progress = 0;
    meta.isEmbedding = false;
    meta.chunkCount = 0;
    meta.embeddedCount = 0;
    meta.textLength = text.length;
  }

  await dbSet(`mf_filedata_${id}`, { id, name, text, chunks: null });
  saveState();
  renderApp();
}

async function deleteFile(id) {
  files = files.filter((f) => f.id !== id);
  await dbDelete(`mf_filedata_${id}`);
  saveState();
  renderApp();
}

async function toggleEmbedding(id) {
  const meta = files.find((f) => f.id === id);
  if (!meta) return;
  if (!config.embeddingsModel || config.embeddingsModel.trim() === "") return;

  meta.isEmbedding = !meta.isEmbedding;
  saveState();
  renderFileList();
  if (meta.isEmbedding) {
    startEmbeddingLoop(id);
  }
}

async function appendFileMessage(fileId, mode = "full") {
  const meta = files.find((f) => f.id === fileId);
  if (!meta) return;
  suspendSuperSecretSettings();
  resetEditState();

  if (!currentChatId) newChat();
  const chat = chats.find((c) => c.id === currentChatId);

  let approxTokens = Math.ceil((meta.textLength || 0) / 4);
  let content = "";

  if (mode === "full") {
    const data = await dbGet(`mf_filedata_${meta.id}`);
    const fileContent = data ? data.text : "";
    const extMatch = (meta.name || "").match(/\.([^.]+)$/);
    const ext = extMatch ? extMatch[1] : "txt";
    const blockTicks = fileContent.includes("```") ? "````" : "```";
    content = `\`${meta.name}\`:\n\n${blockTicks}${ext}\n${fileContent}\n${blockTicks}`;
    approxTokens = Math.ceil(content.length / 4);
  }

  chat.messages.push({
    role: "file",
    fileId: meta.id,
    fileName: meta.name,
    prompt: "",
    mode: mode,
    approxTokens: approxTokens,
    content: content,
    maxTokens: parseInt(config.maxRagTokens, 10) || 5000,
    ragThreshold: parseFloat(config.ragThreshold) || 0.0,
    chunkSeparator:
      config.chunkSeparator !== undefined ? config.chunkSeparator : "...",
  });

  if (window.innerWidth <= 768) {
    isSidebarHidden = true;
    applySidebarState();
  }

  saveState();
  renderApp();
  updateTokenCount();
}

function resetEditState() {
  editingMessageIndex = null;
  const area = $("#chat-input");
  if (area) {
    area.style.whiteSpace = "";
    area.style.overflowX = "";
    if (!isSuperSecretSettingsOpen) {
      area.value = "";
      area.style.height = promptHeight;
    }
  }
}

function startGlobalEdit(index) {
  editingMessageIndex = index;
  const chat = chats.find((c) => c.id === currentChatId);
  const msg = chat.messages[index];
  const area = $("#chat-input");

  area.value =
    msg.role === "file" && msg.mode === "embed"
      ? msg.prompt || ""
      : msg.content;

  renderApp(true);
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

      const sEl = document.querySelector(
        `.msg[data-index="${editingMessageIndex}"] .embed-cfg-separator`,
      );
      if (sEl) msg.chunkSeparator = sEl.value;
    } else {
      msg.content = $("#chat-input").value;
      msg.approxTokens = Math.ceil(msg.content.length / 4);
    }
  } else {
    msg.content = $("#chat-input").value;
  }

  saveState();
  endGlobalEdit();
}

function cancelGlobalEdit() {
  endGlobalEdit();
}

function endGlobalEdit() {
  resetEditState();
  renderApp(true);
}

function toggleGlobalWrap() {
  const area = $("#chat-input");
  area.style.whiteSpace = area.style.whiteSpace === "pre" ? "pre-wrap" : "pre";
  area.style.overflowX = area.style.whiteSpace === "pre" ? "auto" : "hidden";
}
