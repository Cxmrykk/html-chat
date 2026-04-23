// --- SETTINGS LOGIC & TOGGLES ---
function saveConfig() {
  const oldRAG = config.embeddingsModel;

  config = {
    ...config,
    url: $("#cfg-url").value.trim(),
    key: $("#cfg-key").value.trim(),
    models: $("#cfg-models").value.trim(),
    godMode: $("#cfg-godmode").checked,
  };

  const newRAG = config.embeddingsModel;
  if (oldRAG !== newRAG) {
    resetAllFileEmbeddings();
  }

  saveState();
  updateModelDropdown();
  renderApp(true);
  updateTokenCount();
  alert("Settings saved.");
}

function suspendSuperSecretSettings() {
  if (isSuperSecretSettingsOpen) {
    if (activeSuperSecretSetting)
      uncommittedSuperSecretValue = $("#chat-input").value;
    isSuperSecretSettingsOpen = false;
  }
  if (isAdvancedRAGSettingsOpen) {
    if (activeAdvancedRAGSetting)
      uncommittedAdvancedRAGValue = $("#chat-input").value;
    isAdvancedRAGSettingsOpen = false;
  }
}

function toggleSuperSecretSettings() {
  if (isAdvancedRAGSettingsOpen) {
    if (activeAdvancedRAGSetting)
      uncommittedAdvancedRAGValue = $("#chat-input").value;
    isAdvancedRAGSettingsOpen = false;
    activeAdvancedRAGSetting = null;
    activeAdvancedRAGFileId = null;
  }

  isSuperSecretSettingsOpen = !isSuperSecretSettingsOpen;
  if (!isSuperSecretSettingsOpen) {
    activeSuperSecretSetting = null;
    uncommittedSuperSecretValue = null;
    $("#chat-input").value = "";
  } else {
    if (activeSuperSecretSetting) {
      const area = $("#chat-input");
      if (uncommittedSuperSecretValue !== null) {
        area.value = uncommittedSuperSecretValue;
      } else {
        area.value =
          config[activeSuperSecretSetting] !== "" &&
          config[activeSuperSecretSetting] !== undefined
            ? config[activeSuperSecretSetting]
            : SETTING_DEFAULTS[activeSuperSecretSetting].default;
      }
    }
  }
  renderCurrentChat();
  applyInputAreaState();
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
  const oldRAG = config.embeddingsModel;

  if (
    [
      "godModePrompt",
      "embeddingsModel",
      "embeddingsUrl",
      "embeddingsKey",
      "streamResponse",
      "fileWrapperFunc",
    ].includes(key)
  ) {
    config[key] = val;
  } else {
    if (val.trim() === "") config[key] = "";
    else {
      const parsed = parseFloat(val);
      config[key] = isNaN(parsed) ? "" : parsed;
    }
  }

  if (oldRAG !== config.embeddingsModel) resetAllFileEmbeddings();

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
  const oldRAG = config.embeddingsModel;
  config[key] = SETTING_DEFAULTS[key].default;

  if (oldRAG !== config.embeddingsModel) resetAllFileEmbeddings();

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
  if (!confirm("Reset ALL Advanced parameters to default?")) return;
  const oldRAG = config.embeddingsModel;

  for (let key in SETTING_DEFAULTS) {
    config[key] = SETTING_DEFAULTS[key].default;
  }

  if (oldRAG !== config.embeddingsModel) resetAllFileEmbeddings();

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

async function toggleAdvancedRAGSettings(id = null) {
  if (isSuperSecretSettingsOpen) toggleSuperSecretSettings();

  if (id === null && isAdvancedRAGSettingsOpen) {
    if (activeAdvancedRAGSetting)
      uncommittedAdvancedRAGValue = $("#chat-input").value;
    isAdvancedRAGSettingsOpen = false;
    $("#chat-input").value = "";
    renderCurrentChat();
    applyInputAreaState();
    return;
  }

  if (id !== null) {
    if (isAdvancedRAGSettingsOpen && activeAdvancedRAGFileId === id) {
      if (activeAdvancedRAGSetting)
        uncommittedAdvancedRAGValue = $("#chat-input").value;
      isAdvancedRAGSettingsOpen = false;
      $("#chat-input").value = "";
    } else {
      if (isAdvancedRAGSettingsOpen && activeAdvancedRAGSetting)
        uncommittedAdvancedRAGValue = $("#chat-input").value;

      const isReopeningSame = activeAdvancedRAGFileId === id;
      isAdvancedRAGSettingsOpen = true;
      activeAdvancedRAGFileId = id;

      if (!isReopeningSame) {
        activeAdvancedRAGSetting = null;
        uncommittedAdvancedRAGValue = null;
        $("#chat-input").value = "";
      } else if (activeAdvancedRAGSetting) {
        const area = $("#chat-input");
        if (uncommittedAdvancedRAGValue !== null)
          area.value = uncommittedAdvancedRAGValue;
        else {
          if (activeAdvancedRAGSetting === "fileText") {
            const data = await dbGet(`mf_filedata_${id}`);
            area.value = data ? data.text : "";
          } else {
            const meta = files.find((f) => f.id === id);
            area.value =
              meta &&
              meta[activeAdvancedRAGSetting] !== undefined &&
              meta[activeAdvancedRAGSetting] !== ""
                ? meta[activeAdvancedRAGSetting]
                : FILE_SETTING_DEFAULTS[activeAdvancedRAGSetting].default;
          }
        }
      }
    }
  }
  renderCurrentChat();
  applyInputAreaState();
}

async function selectAdvancedRAGSetting(key) {
  activeAdvancedRAGSetting = key;
  uncommittedAdvancedRAGValue = null;
  const area = $("#chat-input");

  if (key === "fileText") {
    const data = await dbGet(`mf_filedata_${activeAdvancedRAGFileId}`);
    area.value = data ? data.text : "";
  } else {
    const meta = files.find((f) => f.id === activeAdvancedRAGFileId);
    if (meta)
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

  if (key === "fileText") {
    const data = await dbGet(`mf_filedata_${activeAdvancedRAGFileId}`);
    if (data) {
      data.text = val;
      meta.textLength = val.length;
      await dbSet(`mf_filedata_${activeAdvancedRAGFileId}`, data);
      await refreshFileChunks(meta.id);
    }
  } else {
    const requiresReembed = ["customChunks", "customChunker"].includes(key);
    const oldVal = meta[key];

    if (
      [
        "customChunks",
        "customChunker",
        "retrievalFunc",
        "dedupFunc",
        "mergeChunksFunc",
        "fileWrapperFunc",
      ].includes(key)
    ) {
      meta[key] = val;
    } else {
      if (val.trim() === "") meta[key] = "";
      else {
        const parsed = parseFloat(val);
        meta[key] = isNaN(parsed) ? "" : parsed;
      }
    }

    if (requiresReembed && oldVal !== meta[key])
      await refreshFileChunks(meta.id);
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
  if (key === "fileText") return;

  const meta = files.find((f) => f.id === activeAdvancedRAGFileId);
  if (!meta) return;

  const requiresReembed = ["customChunks", "customChunker"].includes(key);
  const oldVal = meta[key];
  meta[key] = FILE_SETTING_DEFAULTS[key].default;

  if (requiresReembed && oldVal !== meta[key]) await refreshFileChunks(meta.id);

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
  if (!confirm("Reset ALL Advanced RAG parameters to default for this file?"))
    return;

  const meta = files.find((f) => f.id === activeAdvancedRAGFileId);
  if (!meta) return;

  let requiresReembed = false;
  for (let key in FILE_SETTING_DEFAULTS) {
    if (key === "fileText") continue;
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

  if (requiresReembed) await refreshFileChunks(meta.id);

  saveState();
  if (activeAdvancedRAGSetting) {
    uncommittedAdvancedRAGValue = null;
    if (activeAdvancedRAGSetting === "fileText") {
      const data = await dbGet(`mf_filedata_${meta.id}`);
      $("#chat-input").value = data ? data.text : "";
    } else {
      $("#chat-input").value =
        meta[activeAdvancedRAGSetting] !== undefined
          ? meta[activeAdvancedRAGSetting]
          : FILE_SETTING_DEFAULTS[activeAdvancedRAGSetting].default;
    }
  }
  renderApp(true);
  updateTokenCount();
}
