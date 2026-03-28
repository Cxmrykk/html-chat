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
function handleNewChatClick(e) {
  if (e.altKey) {
    e.preventDefault();
    importChats();
  } else {
    newChat();
  }
}

function newChat() {
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
  $("#chat-input").value = chat.messages[msgIndex].content;
  chat.messages = chat.messages.slice(0, msgIndex);
  saveState();
  sendMessage();
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
  const sendBtn = $("#send-btn");
  const saveBtn = $("#save-edit-btn");
  const cancelBtn = $("#cancel-edit-btn");
  const area = $("#chat-input");

  if (sendBtn) sendBtn.classList.remove("hidden");
  if (saveBtn) saveBtn.classList.add("hidden");
  if (cancelBtn) cancelBtn.classList.add("hidden");

  if (area) {
    area.style.whiteSpace = "";
    area.style.overflowX = "";
    area.value = "";
    area.style.height = promptHeight;
  }
}

function startGlobalEdit(index) {
  editingMessageIndex = index;
  const chat = chats.find((c) => c.id === currentChatId);
  const area = $("#chat-input");
  area.value = chat.messages[index].content;
  area.style.height = editHeight;

  $("#send-btn").classList.add("hidden");
  $("#save-edit-btn").classList.remove("hidden");
  $("#cancel-edit-btn").classList.remove("hidden");

  renderApp(true);
  area.focus();
}

function saveGlobalEdit() {
  if (editingMessageIndex === null) return;
  const chat = chats.find((c) => c.id === currentChatId);
  chat.messages[editingMessageIndex].content = $("#chat-input").value;
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
