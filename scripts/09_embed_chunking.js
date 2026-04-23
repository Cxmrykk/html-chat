// --- EMBEDDINGS CHUNKING ---
async function getFileChunks(id) {
  const chunks = await dbGetByPrefix(`mf_chunk_${id}_`);
  return chunks.sort((a, b) => a.index - b.index);
}

async function refreshFileChunks(id) {
  const meta = files.find((f) => f.id === id);
  if (!meta) return;
  const data = await dbGet(`mf_filedata_${id}`);
  if (!data) return;

  const text = data.text || "";
  let chunks = [];

  const chunkerCode =
    meta.customChunker && meta.customChunker.trim() !== ""
      ? meta.customChunker
      : FILE_SETTING_DEFAULTS.customChunker.default;

  if (meta.customChunks && meta.customChunks.trim() !== "") {
    try {
      const parsed = JSON.parse(meta.customChunks);
      if (Array.isArray(parsed)) chunks = parsed;
    } catch (e) {
      console.error("Error parsing customChunks:", e);
    }
  } else {
    try {
      const fn = new AsyncFunction("fileContents", "config", chunkerCode);
      const res = await fn(text, config);
      if (Array.isArray(res)) chunks = res;
    } catch (e) {
      console.error("Error executing customChunker:", e);
    }
  }

  if (!Array.isArray(chunks) || chunks.length === 0) chunks = [text];
  chunks = chunks.filter((c) => c !== null && c !== undefined);

  const oldChunks = await getFileChunks(id);
  let changed = false;
  let newChunks = [];
  let chunkIndex = 0;

  const oldChunksMap = new Map();
  for (const old of oldChunks) {
    if (old.vector && !oldChunksMap.has(old.text))
      oldChunksMap.set(old.text, old);
  }

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const stringified = typeof c === "string" ? c : JSON.stringify(c);

    let existing = oldChunksMap.get(stringified);
    if (!existing) changed = true;

    newChunks.push({
      index: chunkIndex++,
      text: stringified,
      raw: c,
      vector: existing ? existing.vector : null,
    });
    if (i % 500 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  if (oldChunks.length !== newChunks.length) changed = true;
  else if (oldChunks.some((old, i) => old.text !== newChunks[i].text))
    changed = true;

  if (changed) {
    await dbDeleteByPrefix(`mf_chunk_${id}_`);
    const entries = newChunks.map((c) => [
      `mf_chunk_${id}_${String(c.index).padStart(6, "0")}`,
      c,
    ]);
    await dbSetMultiple(entries);

    meta.chunkCount = newChunks.length;
    meta.embeddedCount = newChunks.filter((c) => c.vector).length;

    const CHUNK_LIMIT =
      meta.chunkMaxTokens !== undefined && meta.chunkMaxTokens !== ""
        ? parseInt(meta.chunkMaxTokens, 10)
        : parseInt(config.chunkMaxTokens, 10) || 1024;
    const MAX_TOKENS = parseInt(config.chunkBatchMaxTokens) || 8192;

    let ignoredCount = 0;
    for (let i = 0; i < newChunks.length; i++) {
      const c = newChunks[i];
      if (!c.vector) {
        const chunkStr =
          typeof c.text === "string" ? c.text : JSON.stringify(c.text) || "";
        const chunkTokens = Math.ceil(chunkStr.length / 4);
        if (chunkTokens > CHUNK_LIMIT || chunkTokens > MAX_TOKENS)
          ignoredCount++;
      }
      if (i % 1000 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    const processedCount = meta.embeddedCount + ignoredCount;
    meta.exactProgress =
      meta.chunkCount > 0 ? (processedCount / meta.chunkCount) * 100 : 0;
    meta.progress = Math.round(meta.exactProgress);
    if (meta.progress >= 100) meta.isEmbedding = false;

    await dbSet(`mf_filedata_${id}`, data);
    saveState();
  }
}

async function attemptChunking() {
  if (!activeAdvancedRAGFileId) return;
  const meta = files.find((f) => f.id === activeAdvancedRAGFileId);
  const data = await dbGet(`mf_filedata_${activeAdvancedRAGFileId}`);
  if (!meta || !data) return;

  const text = data.text || "";
  let chunks = [];

  const chunkerCode =
    meta.customChunker && meta.customChunker.trim() !== ""
      ? meta.customChunker
      : FILE_SETTING_DEFAULTS.customChunker.default;

  try {
    const fn = new AsyncFunction("fileContents", "config", chunkerCode);
    const res = await fn(text, config);
    if (Array.isArray(res))
      chunks = res.filter((c) => c !== null && c !== undefined);
  } catch (e) {
    alert("Error executing customChunker: " + e.message);
    return;
  }

  meta.customChunks = JSON.stringify(chunks, null, 2);
  saveState();
  await refreshFileChunks(meta.id);

  if (activeAdvancedRAGSetting === "customChunks")
    await selectAdvancedRAGSetting("customChunks");
  else renderApp(true);
}
