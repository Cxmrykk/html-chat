// --- FILE UPLOAD & MANAGEMENT ---
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
    };
    files.unshift(meta);
  } else {
    meta.progress = 0;
    meta.isEmbedding = false;
    meta.chunkCount = 0;
    meta.embeddedCount = 0;
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
  meta.isEmbedding = !meta.isEmbedding;
  saveState();
  renderFileList();
  if (meta.isEmbedding) {
    startEmbeddingLoop(id);
  }
}

function appendFileMessage(fileId) {
  const meta = files.find((f) => f.id === fileId);
  if (!meta) return;
  suspendSuperSecretSettings();
  resetEditState();

  if (!currentChatId) newChat();
  const chat = chats.find((c) => c.id === currentChatId);

  const approxTokens = meta.chunkCount
    ? Math.ceil((meta.chunkCount * (parseInt(config.chunkSize) || 1000)) / 4)
    : 0;

  chat.messages.push({
    role: "file",
    fileId: meta.id,
    fileName: meta.name,
    prompt: "",
    maxTokens: parseInt(config.maxRagTokens) || 5000,
    approxTokens: approxTokens,
  });

  if (window.innerWidth <= 768) {
    isSidebarHidden = true;
    applySidebarState();
  }

  saveState();
  renderApp();
  updateTokenCount();
}

// --- IMPORT / EXPORT ---
function exportChats() {
  const dataStr = JSON.stringify(chats, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `html-chat-export-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportSingleChat(id) {
  const chat = chats.find((c) => c.id === id);
  if (!chat) return;

  const dataStr = JSON.stringify([chat], null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;

  a.download = `chat-timestamp-${chat.id}.json`;

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importChats() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedChats = JSON.parse(event.target.result);
        if (!Array.isArray(importedChats))
          throw new Error("Invalid format: expected an array of chats.");

        let addedCount = 0;
        const existingIds = new Set(chats.map((c) => c.id));

        for (const chat of importedChats) {
          if (!chat.id || !chat.messages) continue;
          if (!existingIds.has(chat.id)) {
            chats.push(chat);
            existingIds.add(chat.id);
            addedCount++;
          }
        }

        // Sort chats by date (id is Unix epoch), newest first
        chats.sort((a, b) => Number(b.id) - Number(a.id));

        if (!currentChatId && chats.length > 0) currentChatId = chats[0].id;

        saveState();
        renderApp();
        alert(`Successfully imported ${addedCount} new chat(s).`);
      } catch (err) {
        alert("Failed to import chats: " + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// --- CHAT ACTIONS ---
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

// --- EDITING ACTIONS ---
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

  area.value = msg.role === "file" ? msg.prompt || "" : msg.content;

  renderApp(true);
  area.focus();
}

function saveGlobalEdit() {
  if (editingMessageIndex === null) return;
  const chat = chats.find((c) => c.id === currentChatId);
  const msg = chat.messages[editingMessageIndex];

  if (msg.role === "file") {
    msg.prompt = $("#chat-input").value;
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
