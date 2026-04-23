// --- MESSAGE EDITING & ACTIONS ---
function retryMessage(msgIndex) {
  resetEditState();
  const chat = chats.find((c) => c.id === currentChatId);
  const msg = chat.messages[msgIndex];

  if (msg.role === "file") {
    chat.messages = chat.messages.slice(0, msgIndex + 1);
    invalidateTokenCache();
    saveState();
    renderCurrentChat();
    sendMessage();
  } else {
    $("#chat-input").value = msg.content;
    chat.messages = chat.messages.slice(0, msgIndex);
    invalidateTokenCache();
    saveState();
    renderCurrentChat();
    sendMessage();
  }
}

function deleteMessage(msgIndex) {
  if (editingMessageIndex === msgIndex) cancelGlobalEdit();
  else if (editingMessageIndex !== null && editingMessageIndex > msgIndex)
    editingMessageIndex--;

  chats.find((c) => c.id === currentChatId).messages.splice(msgIndex, 1);
  invalidateTokenCache();
  saveState();
  renderCurrentChat();
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
