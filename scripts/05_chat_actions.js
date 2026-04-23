// --- CHAT ACTIONS (CRUD) ---
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
