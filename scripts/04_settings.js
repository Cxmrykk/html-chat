// --- CONFIGURATION & SUPER SECRET SETTINGS ---
function saveConfig() {
  const oldRAG =
    config.embeddingsModel + config.chunkSize + config.chunkOverlap;

  config = {
    ...config,
    url: $("#cfg-url").value.trim(),
    key: $("#cfg-key").value.trim(),
    models: $("#cfg-models").value.trim(),
    godMode: $("#cfg-godmode").checked,
  };

  const newRAG =
    config.embeddingsModel + config.chunkSize + config.chunkOverlap;
  if (oldRAG !== newRAG) {
    resetAllFileEmbeddings();
  }

  saveState();
  updateModelDropdown();
  renderApp(true);
  updateTokenCount();
  alert("Settings saved, don't fuck them up.");
}

function selectSuperSecretSetting(key) {
  activeSuperSecretSetting = key;
  uncommittedSuperSecretValue = null;
  const area = $("#chat-input");
  area.value =
    config[key] !== undefined && config[key] !== ""
      ? config[key]
      : SETTING_DEFAULTS[key].default;
  renderApp(true);
  area.focus();
}

function saveSuperSecretSetting() {
  if (!activeSuperSecretSetting) return;
  let val = $("#chat-input").value;
  const key = activeSuperSecretSetting;
  const oldRAG =
    config.embeddingsModel + config.chunkSize + config.chunkOverlap;

  if (
    key === "godModePrompt" ||
    key === "embeddingsModel" ||
    key === "embeddingsUrl" ||
    key === "embeddingsKey" ||
    key === "chunkSeparator" ||
    key === "streamResponse"
  ) {
    config[key] = val;
  } else {
    if (val.trim() === "") {
      config[key] = "";
    } else {
      const parsed = parseFloat(val);
      config[key] = isNaN(parsed) ? "" : parsed;
    }
  }

  const newRAG =
    config.embeddingsModel + config.chunkSize + config.chunkOverlap;
  if (oldRAG !== newRAG) {
    resetAllFileEmbeddings();
  }

  saveState();
  activeSuperSecretSetting = null;
  uncommittedSuperSecretValue = null;
  renderApp(true);
  updateTokenCount();
}

function resetSuperSecretSetting() {
  if (!activeSuperSecretSetting) return;
  const key = activeSuperSecretSetting;
  const oldRAG =
    config.embeddingsModel + config.chunkSize + config.chunkOverlap;
  config[key] = SETTING_DEFAULTS[key].default;

  const newRAG =
    config.embeddingsModel + config.chunkSize + config.chunkOverlap;
  if (oldRAG !== newRAG) resetAllFileEmbeddings();

  saveState();
  activeSuperSecretSetting = null;
  uncommittedSuperSecretValue = null;
  renderApp(true);
  updateTokenCount();
}

function cancelSuperSecretSetting() {
  activeSuperSecretSetting = null;
  uncommittedSuperSecretValue = null;
  renderApp(true);
}

function resetAllSuperSecretSettings() {
  if (confirm("Reset ALL Advanced parameters to default?")) {
    const oldRAG =
      config.embeddingsModel + config.chunkSize + config.chunkOverlap;

    for (let key in SETTING_DEFAULTS) {
      config[key] = SETTING_DEFAULTS[key].default;
    }

    const newRAG =
      config.embeddingsModel + config.chunkSize + config.chunkOverlap;
    if (oldRAG !== newRAG) resetAllFileEmbeddings();

    saveState();
    if (activeSuperSecretSetting) {
      uncommittedSuperSecretValue = null;
      $("#chat-input").value =
        config[activeSuperSecretSetting] !== undefined
          ? config[activeSuperSecretSetting]
          : SETTING_DEFAULTS[activeSuperSecretSetting].default;
    }
    renderApp(true);
    updateTokenCount();
  }
}
