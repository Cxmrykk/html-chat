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
  if (isAdvancedRAGSettingsOpen) return saveAdvancedRAGSetting();

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
  if (isAdvancedRAGSettingsOpen) return resetAdvancedRAGSetting();

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
  if (isAdvancedRAGSettingsOpen) return cancelAdvancedRAGSetting();

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

// --- ADVANCED RAG SPECIFIC FUNCTIONS ---
function selectAdvancedRAGSetting(key) {
  activeAdvancedRAGSetting = key;
  uncommittedAdvancedRAGValue = null;
  const area = $("#chat-input");
  const meta = files.find((f) => f.id === activeAdvancedRAGFileId);
  if (meta) {
    area.value =
      meta[key] !== undefined && meta[key] !== ""
        ? meta[key]
        : FILE_SETTING_DEFAULTS[key].default;
  }
  renderApp(true);
  area.focus();
}

async function saveAdvancedRAGSetting() {
  if (!activeAdvancedRAGSetting || !activeAdvancedRAGFileId) return;
  let val = $("#chat-input").value;
  const key = activeAdvancedRAGSetting;
  const meta = files.find((f) => f.id === activeAdvancedRAGFileId);
  if (!meta) return;

  const requiresReembed = ["customChunks", "customChunker"].includes(key);
  const oldVal = meta[key];

  if (
    [
      "customChunks",
      "customChunker",
      "captureFunc",
      "retrievalFunc",
      "dedupFunc",
      "chunkSeparator",
    ].includes(key)
  ) {
    meta[key] = val;
  } else {
    if (val.trim() === "") {
      meta[key] = "";
    } else {
      const parsed = parseFloat(val);
      meta[key] = isNaN(parsed) ? "" : parsed;
    }
  }

  if (requiresReembed && oldVal !== meta[key]) {
    meta.progress = 0;
    meta.embeddedCount = 0;
    meta.chunkCount = 0;
    meta.isEmbedding = false;
    const data = await dbGet(`mf_filedata_${meta.id}`);
    if (data) {
      data.chunks = null;
      await dbSet(`mf_filedata_${meta.id}`, data);
    }
  }

  saveState();
  activeAdvancedRAGSetting = null;
  uncommittedAdvancedRAGValue = null;
  renderApp(true);
  updateTokenCount();
}

async function resetAdvancedRAGSetting() {
  if (!activeAdvancedRAGSetting || !activeAdvancedRAGFileId) return;
  const key = activeAdvancedRAGSetting;
  const meta = files.find((f) => f.id === activeAdvancedRAGFileId);
  if (!meta) return;

  const requiresReembed = ["customChunks", "customChunker"].includes(key);
  const oldVal = meta[key];

  meta[key] = FILE_SETTING_DEFAULTS[key].default;

  if (requiresReembed && oldVal !== meta[key]) {
    meta.progress = 0;
    meta.embeddedCount = 0;
    meta.chunkCount = 0;
    meta.isEmbedding = false;
    const data = await dbGet(`mf_filedata_${meta.id}`);
    if (data) {
      data.chunks = null;
      await dbSet(`mf_filedata_${meta.id}`, data);
    }
  }

  saveState();
  activeAdvancedRAGSetting = null;
  uncommittedAdvancedRAGValue = null;
  renderApp(true);
  updateTokenCount();
}

function cancelAdvancedRAGSetting() {
  activeAdvancedRAGSetting = null;
  uncommittedAdvancedRAGValue = null;
  renderApp(true);
}

async function resetAllAdvancedRAGSettings() {
  if (!activeAdvancedRAGFileId) return;
  if (confirm("Reset ALL Advanced RAG parameters to default for this file?")) {
    const meta = files.find((f) => f.id === activeAdvancedRAGFileId);
    if (!meta) return;

    let requiresReembed = false;
    for (let key in FILE_SETTING_DEFAULTS) {
      if (
        ["customChunks", "customChunker"].includes(key) &&
        meta[key] !== undefined &&
        meta[key] !== "" &&
        meta[key] !== FILE_SETTING_DEFAULTS[key].default
      ) {
        requiresReembed = true;
      }
      meta[key] = FILE_SETTING_DEFAULTS[key].default;
    }

    if (requiresReembed) {
      meta.progress = 0;
      meta.embeddedCount = 0;
      meta.chunkCount = 0;
      meta.isEmbedding = false;
      const data = await dbGet(`mf_filedata_${meta.id}`);
      if (data) {
        data.chunks = null;
        await dbSet(`mf_filedata_${meta.id}`, data);
      }
    }

    saveState();
    if (activeAdvancedRAGSetting) {
      uncommittedAdvancedRAGValue = null;
      $("#chat-input").value =
        meta[activeAdvancedRAGSetting] !== undefined
          ? meta[activeAdvancedRAGSetting]
          : FILE_SETTING_DEFAULTS[activeAdvancedRAGSetting].default;
    }
    renderApp(true);
    updateTokenCount();
  }
}
