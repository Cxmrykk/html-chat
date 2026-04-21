// --- UI TOGGLES & UPDATES ---
function updateModelDropdown() {
  const select = $("#model-select");
  const models = config.models
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  select.innerHTML = models
    .map((m) => `<option value="${m}">${m}</option>`)
    .join("");
  if (config.lastModel && models.includes(config.lastModel))
    select.value = config.lastModel;
  else if (models.length > 0) {
    config.lastModel = models[0];
    saveState();
  }
}

function saveLastModel() {
  config.lastModel = $("#model-select").value;
  saveState();
}

function toggleSidebar() {
  isSidebarHidden = !isSidebarHidden;
  saveState();
  applySidebarState();
}

function applySidebarState() {
  $("#sidebar").classList.toggle("hidden", isSidebarHidden);
  $("#toggle-sidebar-btn").textContent = isSidebarHidden
    ? "[show sidebar]"
    : "[hide sidebar]";
}

function toggleTitle() {
  isTitleHidden = !isTitleHidden;
  saveState();
  applyTitleState();
}

function applyTitleState() {
  $("#header").classList.toggle("hidden", isTitleHidden);
  $("#toggle-title-btn").textContent = isTitleHidden
    ? "[show title]"
    : "[hide title]";
}

function updateTokenCount() {
  const btn = $("#send-btn");
  if (!btn) return;

  if (
    btn.textContent.includes("Thinking") ||
    btn.textContent.includes("Generating") ||
    btn.textContent.includes("Embedding") ||
    btn.classList.contains("hidden")
  )
    return;

  if (cachedContextChars === -1) {
    let contextChars = 0;
    if (currentChatId) {
      const chat = chats.find((c) => c.id === currentChatId);
      if (chat && chat.messages) {
        contextChars = chat.messages.reduce((acc, m) => {
          if (m.role === "file") {
            if (m.mode === "full") return acc + (m.content || "").length;
            // Config message logic (embed) is no longer sent to the API!
            return acc;
          }
          return acc + (m.content || "").length;
        }, 0);
      }
    }

    if (config.godMode) {
      contextChars += (config.godModePrompt || DEFAULT_GOD_MODE_PROMPT).length;
    }
    cachedContextChars = contextChars;
  }

  const inputVal = $("#chat-input").value || "";
  const totalChars = inputVal.length + cachedContextChars;
  const tokens = Math.ceil(totalChars / 4);

  if (tokens < 1000) {
    btn.textContent = "Send";
  } else {
    let label;
    if (tokens >= 1000000) {
      label = (tokens / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    } else {
      label = (tokens / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    }
    btn.textContent = `Send (${label} tokens)`;
  }
}
