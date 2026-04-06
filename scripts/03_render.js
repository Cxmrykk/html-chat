// --- RENDERING (Template Literals > DOM Building) ---
function renderApp(preserveScroll = false) {
  renderChatList();
  renderCurrentChat(preserveScroll);
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
    container.innerHTML = `
      <div style="height: 100%; display: flex; flex-direction: column; box-sizing: border-box;">
        <h2 style="margin-top: 0; flex-shrink: 0;">Super Secret Settings</h2>
        <p style="flex-shrink: 0; margin-top: 0; font-size: 0.9em; color: #555;">Warning: Changing these modifies core API behaviors and JavaScript execution context.</p>
        
        <div style="flex-grow: 1; overflow-y: auto; margin: 10px 0;">
          <button onclick="editSetting('godModePrompt')" style="width:100%; margin-bottom:5px; text-align:left; font-family: monospace;">Edit God Mode Prompt (Currently: ${config.godModePrompt === DEFAULT_GOD_MODE_PROMPT ? "Default" : "Custom"})</button>
          <button onclick="editSetting('temperature')" style="width:100%; margin-bottom:5px; text-align:left; font-family: monospace;">Edit Temperature (Current: ${config.temperature})</button>
          <button onclick="editSetting('top_p')" style="width:100%; margin-bottom:5px; text-align:left; font-family: monospace;">Edit Top P (Current: ${config.top_p})</button>
          <button onclick="editSetting('max_tokens')" style="width:100%; margin-bottom:5px; text-align:left; font-family: monospace;">Edit Max Tokens (Current: ${config.max_tokens || "API Default"})</button>
          <button onclick="editSetting('frequency_penalty')" style="width:100%; margin-bottom:5px; text-align:left; font-family: monospace;">Edit Frequency Penalty (Current: ${config.frequency_penalty})</button>
          <button onclick="editSetting('presence_penalty')" style="width:100%; margin-bottom:5px; text-align:left; font-family: monospace;">Edit Presence Penalty (Current: ${config.presence_penalty})</button>
        </div>

        <div style="display: flex; gap: 10px; flex-shrink: 0;">
          <button onclick="resetSuperSecretSettings()" style="flex-grow: 1;">Reset to Default</button>
          <button onclick="isSuperSecretSettingsOpen = false; renderApp();" style="flex-grow: 1;">Close Settings</button>
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
