import { state, dbGet, dbSet, dbSetMultiple, dbDeleteByPrefix, dbGetByPrefix, saveState, getDB, STORE_NAME, FILE_SETTING_DEFAULTS, AsyncFunction } from '../state.js';
import { renderApp } from '../ui/render.js';
import { updateFileProgressDOM, renderFileList } from '../ui/components.js';

export async function fetchEmbeddings(texts, signal = null) {
  let base = state.config.embeddingsUrl && state.config.embeddingsUrl.trim() !== ""
      ? state.config.embeddingsUrl.trim().replace(/\/+$/, "")
      : state.config.url.replace(/\/+$/, "");
  
  if (base.endsWith("/chat/completions")) {
    base = base.replace("/chat/completions", "");
  }
  const endpoint = base + "/embeddings";

  const apiKey = state.config.embeddingsKey && state.config.embeddingsKey.trim() !== ""
      ? state.config.embeddingsKey.trim() : state.config.key;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: state.config.embeddingsModel || "text-embedding-3-small",
      input: texts,
    }),
    signal: signal || undefined,
  });

  if (!res.ok) {
    const errText = await res.text();
    let errMsg = errText;
    try { errMsg = JSON.parse(errText).error.message; } catch (e) {}
    throw new Error(`API Error: ${res.status} ${res.statusText}\n${errMsg}`);
  }

  const data = await res.json();
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function resetAllFileEmbeddings() {
  for (const meta of state.files) {
    meta.progress = 0;
    meta.exactProgress = 0;
    meta.embeddedCount = 0;
    meta.chunkCount = 0;
    meta.isEmbedding = false;
    meta.embeddingSpeed = null;
    meta.embeddingEta = null;
    if (state.embeddingAbortControllers[meta.id]) {
      state.embeddingAbortControllers[meta.id].abort();
      delete state.embeddingAbortControllers[meta.id];
    }
    await dbDeleteByPrefix(`mf_chunk_${meta.id}_`);
  }
  saveState();
  renderApp();
}

export async function getFileChunks(id) {
  const chunks = await dbGetByPrefix(`mf_chunk_${id}_`);
  return chunks.sort((a, b) => a.index - b.index);
}

export async function refreshFileChunks(id) {
  const meta = state.files.find((f) => f.id === id);
  if (!meta) return;
  const data = await dbGet(`mf_filedata_${id}`);
  if (!data) return;

  const text = data.text || "";
  let chunks = [];

  const chunkerCode = meta.customChunker && meta.customChunker.trim() !== ""
      ? meta.customChunker : FILE_SETTING_DEFAULTS.customChunker.default;

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
      const res = await fn(text, state.config);
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
    if (old.vector && !oldChunksMap.has(old.text)) oldChunksMap.set(old.text, old);
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

  if (oldChunks.length !== newChunks.length) {
    changed = true;
  } else if (oldChunks.some((old, i) => old.text !== newChunks[i].text)) {
    changed = true;
  }

  if (changed) {
    await dbDeleteByPrefix(`mf_chunk_${id}_`);
    const entries = newChunks.map((c) => [`mf_chunk_${id}_${String(c.index).padStart(6, "0")}`, c]);
    await dbSetMultiple(entries);

    meta.chunkCount = newChunks.length;
    meta.embeddedCount = newChunks.filter((c) => c.vector).length;

    const CHUNK_LIMIT = meta.chunkMaxTokens !== undefined && meta.chunkMaxTokens !== ""
        ? parseInt(meta.chunkMaxTokens, 10) : parseInt(state.config.chunkMaxTokens, 10) || 1024;
    const MAX_TOKENS = parseInt(state.config.chunkBatchMaxTokens) || 8192;

    let ignoredCount = 0;
    for (let i = 0; i < newChunks.length; i++) {
      const c = newChunks[i];
      if (!c.vector) {
        const chunkStr = typeof c.text === "string" ? c.text : JSON.stringify(c.text) || "";
        const chunkTokens = Math.ceil(chunkStr.length / 4);
        if (chunkTokens > CHUNK_LIMIT || chunkTokens > MAX_TOKENS) ignoredCount++;
      }
      if (i % 1000 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    const processedCount = meta.embeddedCount + ignoredCount;
    meta.exactProgress = meta.chunkCount > 0 ? (processedCount / meta.chunkCount) * 100 : 0;
    meta.progress = Math.round(meta.exactProgress);
    if (meta.progress >= 100) meta.isEmbedding = false;

    await dbSet(`mf_filedata_${id}`, data);
    saveState();
  }
}

export async function getNextChunkBatch(id, maxBatch, maxTokens, chunkLimit) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const prefix = `mf_chunk_${id}_`;
    const range = IDBKeyRange.bound(prefix, prefix + "\uffff");
    const request = store.openCursor(range);

    const batch = [];
    let currentTokens = 0, ignoredCount = 0, embeddedCount = 0, chunkCount = 0;

    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        chunkCount++;
        const c = cursor.value;
        if (c.vector) {
          embeddedCount++;
        } else {
          const chunkStr = typeof c.text === "string" ? c.text : JSON.stringify(c.text) || "";
          const chunkTokens = Math.ceil(chunkStr.length / 4);
          if (chunkTokens > chunkLimit || chunkTokens > maxTokens) {
            ignoredCount++;
          } else if (batch.length < maxBatch && currentTokens + chunkTokens <= maxTokens) {
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

export async function startEmbeddingLoop(id) {
  if (!state.config.embeddingsModel || state.config.embeddingsModel.trim() === "") return;

  const currentMeta = state.files.find((f) => f.id === id);
  if (!currentMeta || !currentMeta.isEmbedding) return;

  if (currentMeta._embeddingLoopActive) return;
  currentMeta._embeddingLoopActive = true;

  if (state.embeddingAbortControllers[id]) state.embeddingAbortControllers[id].abort();
  state.embeddingAbortControllers[id] = new AbortController();

  const MAX_BATCH = parseInt(state.config.chunkBatchSize) || 100;
  const MAX_TOKENS = parseInt(state.config.chunkBatchMaxTokens) || 8192;
  const CHUNK_LIMIT = currentMeta.chunkMaxTokens !== undefined && currentMeta.chunkMaxTokens !== ""
      ? parseInt(currentMeta.chunkMaxTokens, 10) : parseInt(state.config.chunkMaxTokens, 10) || 1024;

  let loopStartTime = Date.now();
  let loopStartEmbeddedCount = null;

  try {
    while (true) {
      const meta = state.files.find((f) => f.id === id);
      if (!meta || !meta.isEmbedding) break;

      const data = await dbGet(`mf_filedata_${id}`);
      if (!data) break;

      let batchData = await getNextChunkBatch(id, MAX_BATCH, MAX_TOKENS, CHUNK_LIMIT);

      if (batchData.chunkCount === 0) {
        await refreshFileChunks(id);
        batchData = await getNextChunkBatch(id, MAX_BATCH, MAX_TOKENS, CHUNK_LIMIT);
        const m = state.files.find((f) => f.id === id);
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
        const signal = state.embeddingAbortControllers[id].signal;
        const embs = await fetchEmbeddings(batchTexts, signal);

        const updateEntries = [];
        batch.forEach((c, i) => {
          c.vector = new Float32Array(embs[i]);
          updateEntries.push([`mf_chunk_${id}_${String(c.index).padStart(6, "0")}`, c]);
        });

        await dbSetMultiple(updateEntries);

        meta.embeddedCount = batchData.embeddedCount + batch.length;
        meta.chunkCount = batchData.chunkCount;

        const processedCount = meta.embeddedCount + ignoredCount;
        meta.exactProgress = meta.chunkCount > 0 ? (processedCount / meta.chunkCount) * 100 : 100.0;
        meta.progress = Math.round(meta.exactProgress);

        if (loopStartEmbeddedCount === null) {
          loopStartEmbeddedCount = meta.embeddedCount - batch.length;
        }

        const elapsedSec = (Date.now() - loopStartTime) / 1000;
        const chunksDone = meta.embeddedCount - loopStartEmbeddedCount;
        if (elapsedSec > 0 && chunksDone > 0) {
          meta.embeddingSpeed = chunksDone / elapsedSec;
          meta.embeddingEta = (meta.chunkCount - processedCount) / meta.embeddingSpeed;
        }

        await dbSet(`mf_filedata_${id}`, data);
        await dbSet("mf_files", state.files);
        updateFileProgressDOM(id);

        await new Promise((r) => setTimeout(r, 100));
      } catch (err) {
        if (err.name === "AbortError") {
          console.log(`Embedding paused for ${meta.name}`);
        } else {
          console.error("Embedding error:", err);
          meta.isEmbedding = false;
          alert(`Embedding failed for ${meta.name}: ${err.message}`);
        }
        break;
      }
    }
  } catch (outerErr) {
    console.error("Unexpected error in embedding loop:", outerErr);
    const m = state.files.find((f) => f.id === id);
    if (m) m.isEmbedding = false;
  } finally {
    const finalMeta = state.files.find((f) => f.id === id);
    if (finalMeta) {
      finalMeta._embeddingLoopActive = false;
      finalMeta.embeddingSpeed = null;
      finalMeta.embeddingEta = null;
    }
    if (state.embeddingAbortControllers[id]) {
      delete state.embeddingAbortControllers[id];
    }
    saveState();
    renderFileList();
    if (state.isAdvancedRAGSettingsOpen && state.activeAdvancedRAGFileId === id) {
      renderApp(true);
    }
  }
}

export async function toggleEmbedding(id) {
  const meta = state.files.find((f) => f.id === id);
  if (!meta) return;
  if (!state.config.embeddingsModel || state.config.embeddingsModel.trim() === "") {
    alert("Please configure an embeddings model in Settings first.");
    return;
  }

  meta.isEmbedding = !meta.isEmbedding;

  if (!meta.isEmbedding) {
    if (state.embeddingAbortControllers[id]) {
      state.embeddingAbortControllers[id].abort();
      delete state.embeddingAbortControllers[id];
    }
    meta.embeddingSpeed = null;
    meta.embeddingEta = null;
  }

  saveState();
  renderFileList();
  renderApp(true);

  if (meta.isEmbedding) {
    while (meta._embeddingLoopActive) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (meta.isEmbedding) {
      startEmbeddingLoop(id);
    }
  }
}

export function toggleAdvancedEmbedding() {
  if (state.activeAdvancedRAGFileId) {
    toggleEmbedding(state.activeAdvancedRAGFileId);
  }
}
