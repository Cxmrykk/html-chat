// --- MESSAGE RENDERING ---
function generateMessageHTML(msg, i, isEditing = false) {
  let displayContent = msg.content || "";
  let configHtml = "";

  if (msg.role === "assistant") {
    displayContent = displayContent.replace(
      /<run>([\s\S]*?)<\/run>/g,
      (match, code) =>
        `**Executing Code:**\n\`\`\`javascript\n${code.trim()}\n\`\`\``,
    );
  } else if (msg.role === "file") {
    if (msg.mode === "embed") {
      displayContent = `*Estimated file size: ~${msg.approxTokens || 0} tokens*<br>*(<= ${msg.maxTokens || 5000} tokens with embeddings enabled)*`;
      if (msg.prompt) displayContent += `\n\n**Search Prompt:** ${msg.prompt}`;
      if (isEditing) {
        configHtml = `
          <div style="display:flex; gap:15px; flex-wrap:wrap; margin-top:10px; align-items:center; background: #eee; padding: 10px; border: 1px solid #ccc; border-radius: 4px;">
          <label style="display:flex; flex-direction:column; font-size:0.85em; font-weight:bold;">Max Tokens <input type="number" class="embed-cfg-tokens" value="${msg.maxTokens || 5000}" style="width:100px; margin:4px 0 0 0; padding:4px; font-weight:normal;"></label>
          <label style="display:flex; flex-direction:column; font-size:0.85em; font-weight:bold;">Match Threshold <input type="number" step="0.1" class="embed-cfg-threshold" value="${msg.ragThreshold || 0.0}" style="width:100px; margin:4px 0 0 0; padding:4px; font-weight:normal;"></label>
          </div>`;
      }
    } else
      displayContent = `*Estimated file size: ~${msg.approxTokens || 0} tokens*`;
  }

  let actionsHtml = "";
  if (isEditing) {
    actionsHtml = `<button data-action="save-edit">Save</button><button data-action="cancel-edit">Cancel</button><button data-action="toggle-wrap">Toggle Wrap</button>`;
  } else {
    let editBtn = `<button data-action="edit">${msg.role === "file" && msg.mode === "embed" ? "Config" : "Edit"}</button>`;
    if (msg.role === "file" && msg.mode === "embed") {
      actionsHtml = `${editBtn}<button data-action="run-embed">Embed</button><button data-action="fork">Fork</button><button data-action="delete">Delete</button>`;
    } else {
      actionsHtml = `${editBtn}<button data-action="fork">Fork</button>${msg.role === "user" || (msg.role === "file" && msg.mode === "full") ? `<button data-action="retry">Retry</button>` : ""}<button data-action="delete">Delete</button>`;
    }
  }

  return `
    <div class="msg ${msg.role} ${isEditing ? "editing" : ""}" data-index="${i}">
      <div class="msg-meta">
        ${
          msg.role === "file"
            ? `<span>FILE: ${escapeHTML(msg.fileName)}</span>`
            : `<select class="role-select">
            <option value="user" ${msg.role === "user" ? "selected" : ""}>user</option>
            <option value="assistant" ${msg.role === "assistant" ? "selected" : ""}>assistant</option>
            <option value="system" ${msg.role === "system" ? "selected" : ""}>system</option>
            ${msg.role === "error" ? `<option value="error" selected>error</option>` : ""}
          </select>`
        }
        <div class="msg-actions">${actionsHtml}</div>
      </div>
      <div class="msg-content">${marked.parse(displayContent)}${configHtml}</div>
    </div>`;
}

function appendMessageToDOM(msg, index) {
  const container = $("#chat-container");
  const emptyMsg = container.querySelector(".empty-chat-msg");
  if (emptyMsg) emptyMsg.remove();

  const wrapper = document.createElement("div");
  wrapper.innerHTML = generateMessageHTML(msg, index, false);
  const msgEl = wrapper.firstElementChild;
  container.appendChild(msgEl);

  renderMathInElement(msgEl, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
    ],
    output: "htmlAndMathml",
    throwOnError: false,
  });
  Prism.highlightAllUnder(msgEl);
  container.scrollTop = container.scrollHeight;
}

function updateMessageInDOM(index) {
  const chat = chats.find((c) => c.id === currentChatId);
  const msg = chat.messages[index];
  const existingEl = document.querySelector(`.msg[data-index="${index}"]`);
  if (!existingEl) return renderCurrentChat();

  const wrapper = document.createElement("div");
  wrapper.innerHTML = generateMessageHTML(
    msg,
    index,
    editingMessageIndex === index,
  );
  const newEl = wrapper.firstElementChild;

  existingEl.replaceWith(newEl);
  renderMathInElement(newEl, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
    ],
    output: "htmlAndMathml",
    throwOnError: false,
  });
  Prism.highlightAllUnder(newEl);
}

function updateMessageContentInDOM(
  index,
  content,
  isFinal = true,
  alignMode = "none",
) {
  const el = document.querySelector(`.msg[data-index="${index}"] .msg-content`);
  if (!el) return;

  let displayContent = content.replace(
    /<run>([\s\S]*?)<\/run>/g,
    (match, code) =>
      `**Executing Code:**\n\`\`\`javascript\n${code.trim()}\n\`\`\``,
  );
  el.innerHTML = marked.parse(displayContent);

  if (isFinal) {
    renderMathInElement(el, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      output: "htmlAndMathml",
      throwOnError: false,
    });
    Prism.highlightAllUnder(el);
    const container = $("#chat-container");
    if (alignMode === "top") {
      const msgEl = el.closest(".msg");
      if (msgEl) container.scrollTop = msgEl.offsetTop - 15;
    } else if (alignMode === "bottom")
      container.scrollTop = container.scrollHeight;
  }
}
