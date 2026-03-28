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
