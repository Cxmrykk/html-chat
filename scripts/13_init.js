// --- INITIALIZATION ---
async function init() {
  config = (await dbGet("mf_config")) || {
    url: "https://api.openai.com/v1",
    key: "",
    models: "gpt-4o, gpt-4-turbo, gpt-3.5-turbo",
    godMode: false,
    lastModel: "",
  };

  for (const key in SETTING_DEFAULTS) {
    if (config[key] === undefined) {
      config[key] = SETTING_DEFAULTS[key].default;
    }
  }

  chats = (await dbGet("mf_chats")) || [];
  files = (await dbGet("mf_files")) || [];
  currentChatId = (await dbGet("mf_current_chat_id")) || null;
  isSidebarHidden = (await dbGet("mf_sidebar_hidden")) === true;
  isTitleHidden = (await dbGet("mf_title_hidden")) === true;
  promptHeight = (await dbGet("mf_prompt_height")) || "";

  $("#cfg-url").value = config.url;
  $("#cfg-key").value = config.key;
  $("#cfg-models").value = config.models;
  $("#cfg-godmode").checked = config.godMode || false;

  updateModelDropdown();
  applySidebarState();
  applyTitleState();

  $("#chat-input").style.height = promptHeight;
  $("#chat-input").addEventListener("input", updateTokenCount);

  const textareaObserver = new ResizeObserver((entries) => {
    for (let entry of entries) {
      const h = entry.target.style.height;
      if (!h) continue;
      promptHeight = h;
      saveState();
    }
  });
  textareaObserver.observe($("#chat-input"));

  chats.sort((a, b) => Number(b.id) - Number(a.id));

  if (!currentChatId && chats.length > 0) currentChatId = chats[0].id;

  for (const f of files) {
    if (f.isEmbedding && f.progress < 100) {
      startEmbeddingLoop(f.id);
    } else if (f.progress >= 100) {
      f.isEmbedding = false;
    }
  }

  renderApp();
}

init();
