// --- EMBEDDINGS INDEXING LOOP ---
async function getNextChunkBatch(id, maxBatch, maxTokens, chunkLimit) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const prefix = `mf_chunk_${id}_`;
    const range = IDBKeyRange.bound(prefix, prefix + "\uffff");
    const request = store.openCursor(range);

    const batch = [];
    let currentTokens = 0,
      ignoredCount = 0,
      embeddedCount = 0,
      chunkCount = 0;

    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        chunkCount++;
        const c = cursor.value;
        if (c.vector) embeddedCount++;
        else {
          const chunkStr =
            typeof c.text === "string" ? c.text : JSON.stringify(c.text) || "";
          const chunkTokens = Math.ceil(chunkStr.length / 4);

          if (chunkTokens > chunkLimit || chunkTokens > maxTokens)
            ignoredCount++;
          else if (
            batch.length < maxBatch &&
            currentTokens + chunkTokens <= maxTokens
          ) {
            batch.push(c);
            currentTokens += chunkTokens;
          }
        }
        cursor.continue();
      } else {
        resolve({ batch, ignoredCount, embeddedCount, chunkCount });
      }
    };
    request.onerror = () => reject(request.error);
  });
}

async function startEmbeddingLoop(id) {
  if (!config.embeddingsModel || config.embeddingsModel.trim() === "") return;

  const currentMeta = files.find((f) => f.id === id);
  if (!currentMeta || !currentMeta.isEmbedding) return;

  if (currentMeta._embeddingLoopActive) return;
  currentMeta._embeddingLoopActive = true;

  if (embeddingAbortControllers[id]) embeddingAbortControllers[id].abort();
  embeddingAbortControllers[id] = new AbortController();

  const MAX_BATCH = parseInt(config.chunkBatchSize) || 100;
  const MAX_TOKENS = parseInt(config.chunkBatchMaxTokens) || 8192;
  const CHUNK_LIMIT =
    currentMeta.chunkMaxTokens !== undefined &&
    currentMeta.chunkMaxTokens !== ""
      ? parseInt(currentMeta.chunkMaxTokens, 10)
      : parseInt(config.chunkMaxTokens, 10) || 1024;

  let loopStartTime = Date.now();
  let loopStartEmbeddedCount = null;

  try {
    while (true) {
      const meta = files.find((f) => f.id === id);
      if (!meta || !meta.isEmbedding) break;

      const data = await dbGet(`mf_filedata_${id}`);
      if (!data) break;

      let batchData = await getNextChunkBatch(
        id,
        MAX_BATCH,
        MAX_TOKENS,
        CHUNK_LIMIT,
      );

      if (batchData.chunkCount === 0) {
        await refreshFileChunks(id);
        batchData = await getNextChunkBatch(
          id,
          MAX_BATCH,
          MAX_TOKENS,
          CHUNK_LIMIT,
        );
        const m = files.find((f) => f.id === id);
        if (!m || !m.isEmbedding) break;
      }

      const { batch, ignoredCount } = batchData;

      if (batch.length === 0) {
        meta.exactProgress = 100.0;
        meta.progress = 100;
        meta.isEmbedding = false;
        meta.embeddingSpeed = null;
        meta.embeddingEta = null;
        updateFileProgressDOM(id);
        break;
      }

      try {
        const batchTexts = batch.map((c) => c.text);
        const signal = embeddingAbortControllers[id].signal;
        const embs = await fetchEmbeddings(batchTexts, signal);

        const updateEntries = [];
        batch.forEach((c, i) => {
          c.vector = new Float32Array(embs[i]);
          updateEntries.push([
            `mf_chunk_${id}_${String(c.index).padStart(6, "0")}`,
            c,
          ]);
        });

        await dbSetMultiple(updateEntries);

        meta.embeddedCount = batchData.embeddedCount + batch.length;
        meta.chunkCount = batchData.chunkCount;

        const processedCount = meta.embeddedCount + ignoredCount;
        meta.exactProgress =
          meta.chunkCount > 0
            ? (processedCount / meta.chunkCount) * 100
            : 100.0;
        meta.progress = Math.round(meta.exactProgress);

        if (loopStartEmbeddedCount === null)
          loopStartEmbeddedCount = meta.embeddedCount - batch.length;

        const elapsedSec = (Date.now() - loopStartTime) / 1000;
        const chunksDone = meta.embeddedCount - loopStartEmbeddedCount;
        if (elapsedSec > 0 && chunksDone > 0) {
          meta.embeddingSpeed = chunksDone / elapsedSec;
          meta.embeddingEta =
            (meta.chunkCount - processedCount) / meta.embeddingSpeed;
        }

        await dbSet(`mf_filedata_${id}`, data);
        await dbSet("mf_files", files);
        updateFileProgressDOM(id);

        await new Promise((r) => setTimeout(r, 100));
      } catch (err) {
        if (err.name === "AbortError")
          console.log(`Embedding paused for ${meta.name}`);
        else {
          console.error("Embedding error:", err);
          meta.isEmbedding = false;
          alert(`Embedding failed for ${meta.name}: ${err.message}`);
        }
        break;
      }
    }
  } catch (outerErr) {
    console.error("Unexpected error in embedding loop:", outerErr);
    const m = files.find((f) => f.id === id);
    if (m) m.isEmbedding = false;
  } finally {
    const finalMeta = files.find((f) => f.id === id);
    if (finalMeta) {
      finalMeta._embeddingLoopActive = false;
      finalMeta.embeddingSpeed = null;
      finalMeta.embeddingEta = null;
    }
    if (embeddingAbortControllers[id]) delete embeddingAbortControllers[id];
    saveState();
    renderFileList();
    if (isAdvancedRAGSettingsOpen && activeAdvancedRAGFileId === id)
      renderApp(true);
  }
}

async function toggleEmbedding(id) {
  const meta = files.find((f) => f.id === id);
  if (!meta) return;
  if (!config.embeddingsModel || config.embeddingsModel.trim() === "") {
    return alert("Please configure an embeddings model in Settings first.");
  }

  meta.isEmbedding = !meta.isEmbedding;

  if (!meta.isEmbedding) {
    if (embeddingAbortControllers[id]) {
      embeddingAbortControllers[id].abort();
      delete embeddingAbortControllers[id];
    }
    meta.embeddingSpeed = null;
    meta.embeddingEta = null;
  }

  saveState();
  renderFileList();
  renderApp(true);

  if (meta.isEmbedding) {
    while (meta._embeddingLoopActive)
      await new Promise((r) => setTimeout(r, 50));
    if (meta.isEmbedding) startEmbeddingLoop(id);
  }
}

function toggleAdvancedEmbedding() {
  if (activeAdvancedRAGFileId) toggleEmbedding(activeAdvancedRAGFileId);
}
