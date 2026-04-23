// --- FILE ACTIONS (CRUD) ---
async function handleUploadClick() {
  const picked = await pickFiles(true);
  if (!picked || !picked.length) return;
  for (const f of picked) {
    const text = await readFileText(f);
    await uploadFile(f.name, text);
  }
}

async function reuploadFile(id) {
  const picked = await pickFiles(false);
  if (!picked || !picked.length) return;
  const text = await readFileText(picked[0]);
  const meta = files.find((f) => f.id === id);
  await uploadFile(meta ? meta.name : picked[0].name, text, id);
}

async function uploadFile(name, text, existingId = null) {
  let id =
    existingId || Date.now().toString() + Math.floor(Math.random() * 1000);
  let meta = files.find((f) => f.id === id);

  if (!meta) {
    let baseName = name;
    let counter = 1;
    while (files.some((f) => f.name === name))
      name = `${baseName} (${counter++})`;
    meta = {
      id,
      name,
      progress: 0,
      exactProgress: 0,
      isEmbedding: false,
      chunkCount: 0,
      embeddedCount: 0,
      textLength: text.length,
    };
    files.unshift(meta);
    await dbSet(`mf_filedata_${id}`, { id, name, text });
  } else {
    meta.textLength = text.length;
    const data = await dbGet(`mf_filedata_${id}`);
    data.text = text;
    await dbSet(`mf_filedata_${id}`, data);
    await refreshFileChunks(id);
  }

  saveState();
  renderFileList();
}

async function deleteFile(id) {
  if (isAdvancedRAGSettingsOpen && activeAdvancedRAGFileId === id)
    toggleAdvancedRAGSettings(null);
  files = files.filter((f) => f.id !== id);
  await dbDelete(`mf_filedata_${id}`);
  await dbDeleteByPrefix(`mf_chunk_${id}_`);
  saveState();
  renderFileList();
}

async function appendFileMessage(fileId, mode = "full") {
  const meta = files.find((f) => f.id === fileId);
  if (!meta) return;
  suspendSuperSecretSettings();
  resetEditState();

  if (!currentChatId) newChat();
  const chat = chats.find((c) => c.id === currentChatId);

  let approxTokens = Math.ceil((meta.textLength || 0) / 4);
  let content = "";

  if (mode === "full") {
    const data = await dbGet(`mf_filedata_${meta.id}`);
    const fileText = data ? data.text : "";

    let wrapperFnCode =
      meta.fileWrapperFunc && meta.fileWrapperFunc.trim() !== ""
        ? meta.fileWrapperFunc
        : config.fileWrapperFunc && config.fileWrapperFunc.trim() !== ""
          ? config.fileWrapperFunc
          : SETTING_DEFAULTS.fileWrapperFunc.default;

    let wrapperFn;
    try {
      wrapperFn = new AsyncFunction("fileContent", "fileName", wrapperFnCode);
    } catch (e) {
      wrapperFn = async (c, n) => `\`${n}\`:\n\n\`\`\`\n${c}\n\`\`\``;
    }

    content = await wrapperFn(fileText, meta.name);
    approxTokens = Math.ceil(content.length / 4);
  }

  chat.messages.push({
    role: "file",
    fileId: meta.id,
    fileName: meta.name,
    prompt: "",
    mode: mode,
    approxTokens: approxTokens,
    content: content,
    maxTokens: parseInt(config.maxRagTokens, 10) || 5000,
    ragThreshold: parseFloat(config.ragThreshold) || 0.0,
  });

  if (window.innerWidth <= 768) {
    isSidebarHidden = true;
    applySidebarState();
  }

  invalidateTokenCache();
  saveState();
  appendMessageToDOM(
    chat.messages[chat.messages.length - 1],
    chat.messages.length - 1,
  );
  updateTokenCount();
}
