// --- EMBEDDINGS & RAG ---
async function fetchEmbeddings(texts, signal = null) {
  let base =
    config.embeddingsUrl && config.embeddingsUrl.trim() !== ""
      ? config.embeddingsUrl.trim().replace(/\/+$/, "")
      : config.url.replace(/\/+$/, "");

  if (base.endsWith("/chat/completions"))
    base = base.replace("/chat/completions", "");
  const endpoint = base + "/embeddings";

  const apiKey =
    config.embeddingsKey && config.embeddingsKey.trim() !== ""
      ? config.embeddingsKey.trim()
      : config.key;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.embeddingsModel || "text-embedding-3-small",
      input: texts,
    }),
    signal: signal || undefined,
  });

  if (!res.ok) {
    const errText = await res.text();
    let errMsg = errText;
    try {
      errMsg = JSON.parse(errText).error.message;
    } catch (e) {}
    throw new Error(`API Error: ${res.status} ${res.statusText}\n${errMsg}`);
  }
  const data = await res.json();
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

// Helper function to fetch all individual chunk records for a file
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

  if (!Array.isArray(chunks) || chunks.length === 0) {
    chunks = [text];
  }

  chunks = chunks.filter((c) => c !== null && c !== undefined);

  const oldChunks = await getFileChunks(id);
  let changed = false;
  let newChunks = [];
  let chunkIndex = 0;

  // Use a map to convert an O(N^2) operation to O(N) when evaluating chunks
  const oldChunksMap = new Map();
  for (const old of oldChunks) {
    if (old.vector && !oldChunksMap.has(old.text)) {
      oldChunksMap.set(old.text, old);
    }
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

    // Yield to the UI event loop to prevent blocking on massive files
    if (i % 500 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  if (oldChunks.length !== newChunks.length) changed = true;
  else if (oldChunks.some((old, i) => old.text !== newChunks[i].text))
    changed = true;

  if (changed) {
    // Purge the old chunks from IndexedDB
    await dbDeleteByPrefix(`mf_chunk_${id}_`);

    // Use multiple sets to quickly write out the separated chunk records
    const entries = newChunks.map((c) => [
      `mf_chunk_${id}_${String(c.index).padStart(6, "0")}`,
      c,
    ]);
    await dbSetMultiple(entries);

    meta.chunkCount = newChunks.length;
    meta.embeddedCount = newChunks.filter((c) => c.vector).length;

    // Calculate ignored count so the progress bar is accurate even before the loop starts
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
        if (chunkTokens > CHUNK_LIMIT || chunkTokens > MAX_TOKENS) {
          ignoredCount++;
        }
      }
      if (i % 1000 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    const processedCount = meta.embeddedCount + ignoredCount;
    meta.exactProgress =
      meta.chunkCount > 0 ? (processedCount / meta.chunkCount) * 100 : 0;
    meta.progress = Math.round(meta.exactProgress);

    if (meta.progress >= 100) meta.isEmbedding = false;

    // Save metadata without chunks attached
    await dbSet(`mf_filedata_${id}`, data);
    saveState();
  }
}

async function getNextChunkBatch(id, maxBatch, maxTokens, chunkLimit) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const prefix = `mf_chunk_${id}_`;
    const range = IDBKeyRange.bound(prefix, prefix + "\uffff");
    const request = store.openCursor(range);

    const batch = [];
    let currentTokens = 0;
    let ignoredCount = 0;
    let embeddedCount = 0;
    let chunkCount = 0;

    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        chunkCount++;
        const c = cursor.value;
        if (c.vector) {
          embeddedCount++;
        } else {
          const chunkStr =
            typeof c.text === "string" ? c.text : JSON.stringify(c.text) || "";
          const chunkTokens = Math.ceil(chunkStr.length / 4);

          if (chunkTokens > chunkLimit || chunkTokens > maxTokens) {
            ignoredCount++;
          } else {
            if (
              batch.length < maxBatch &&
              currentTokens + chunkTokens <= maxTokens
            ) {
              batch.push(c);
              currentTokens += chunkTokens;
            }
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

  if (currentMeta._embeddingLoopActive) return; // Concurrency block
  currentMeta._embeddingLoopActive = true;

  if (embeddingAbortControllers[id]) {
    embeddingAbortControllers[id].abort();
  }
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

      // Always load chunks FRESH in the while loop to prevent race conditions
      // Using cursor-based stream to bypass IPC limits and reduce massive RAM spikes
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
        // If batch is 0, we either finished or the remaining chunks are permanently ignored
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
          // Convert array to Float32Array to compress Vector by 50-70% in memory
          c.vector = new Float32Array(embs[i]);
          updateEntries.push([
            `mf_chunk_${id}_${String(c.index).padStart(6, "0")}`,
            c,
          ]);
        });

        // Save ONLY the freshly processed chunk batches back to the DB to prevent massive rewrites
        await dbSetMultiple(updateEntries);

        meta.embeddedCount = batchData.embeddedCount + batch.length;
        meta.chunkCount = batchData.chunkCount;

        // Progress is computed as (Successfully Embedded + Ignored) / Total Chunks
        const processedCount = meta.embeddedCount + ignoredCount;
        meta.exactProgress =
          meta.chunkCount > 0
            ? (processedCount / meta.chunkCount) * 100
            : 100.0;
        meta.progress = Math.round(meta.exactProgress);

        if (loopStartEmbeddedCount === null) {
          loopStartEmbeddedCount = meta.embeddedCount - batch.length;
        }

        const elapsedSec = (Date.now() - loopStartTime) / 1000;
        const chunksDone = meta.embeddedCount - loopStartEmbeddedCount;
        if (elapsedSec > 0 && chunksDone > 0) {
          meta.embeddingSpeed = chunksDone / elapsedSec;
          meta.embeddingEta =
            (meta.chunkCount - processedCount) / meta.embeddingSpeed;
        }

        await dbSet(`mf_filedata_${id}`, data);
        await dbSet("mf_files", files); // Avoid global saveState() chunk dump spam
        updateFileProgressDOM(id); // Visually update progress without tearing down the DOM

        await new Promise((r) => setTimeout(r, 100)); // Yield to UI
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
    const m = files.find((f) => f.id === id);
    if (m) m.isEmbedding = false;
  } finally {
    const finalMeta = files.find((f) => f.id === id);
    if (finalMeta) {
      finalMeta._embeddingLoopActive = false;
      finalMeta.embeddingSpeed = null;
      finalMeta.embeddingEta = null;
    }

    if (embeddingAbortControllers[id]) {
      delete embeddingAbortControllers[id];
    }
    saveState();
    renderFileList();
    if (isAdvancedRAGSettingsOpen && activeAdvancedRAGFileId === id)
      renderApp(true);
  }
}

async function resolveAllMessages(messages, btnEl) {
  let resolved = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === "file") {
      const meta = files.find((f) => f.id === msg.fileId);
      const mode = msg.mode || "embed";

      if (mode === "full") {
        let fileContent = msg.content;
        if (!fileContent && meta) {
          const data = await dbGet(`mf_filedata_${meta.id}`);
          if (data) {
            let wrapperFnCode =
              meta.fileWrapperFunc && meta.fileWrapperFunc.trim() !== ""
                ? meta.fileWrapperFunc
                : config.fileWrapperFunc && config.fileWrapperFunc.trim() !== ""
                  ? config.fileWrapperFunc
                  : SETTING_DEFAULTS.fileWrapperFunc.default;

            let wrapperFn;
            try {
              wrapperFn = new AsyncFunction(
                "fileContent",
                "fileName",
                wrapperFnCode,
              );
            } catch (e) {
              console.error("Wrapper Fn Syntax Error:", e);
              wrapperFn = async (c, n) => `\`${n}\`:\n\n\`\`\`\n${c}\n\`\`\``;
            }

            fileContent = await wrapperFn(data.text, meta.name);
          }
        }
        resolved.push({
          role: "user",
          content: fileContent || "*File not found.*",
        });
      }
      // If mode === "embed", we simply do not add it to the resolved array.
      // This keeps embed messages local and skips sending them to the API entirely.
    } else {
      resolved.push(msg);
    }
  }

  return resolved;
}

async function executeEmbedMessage(msgIndex) {
  const chat = chats.find((c) => c.id === currentChatId);
  const msg = chat.messages[msgIndex];
  if (!msg || msg.role !== "file" || msg.mode !== "embed") return;

  const meta = files.find((f) => f.id === msg.fileId);
  let fileContent = "*File not found.*";

  const btnEl = document.querySelector(
    `.msg[data-index="${msgIndex}"] button[data-action="run-embed"]`,
  );
  const origText = btnEl ? btnEl.textContent : "Embed";
  if (btnEl) btnEl.textContent = "Embedding...";

  if (meta) {
    const data = await dbGet(`mf_filedata_${meta.id}`);
    if (data) {
      let actualPrompt = msg.prompt ? msg.prompt.trim() : "";

      if (!actualPrompt) {
        let lookaheadText = [];
        for (let j = msgIndex + 1; j < chat.messages.length; j++) {
          const nextMsg = chat.messages[j];
          if (nextMsg.role === "assistant") break;
          if (nextMsg.role === "user" && nextMsg.content) {
            lookaheadText.push(nextMsg.content);
          }
        }
        actualPrompt = lookaheadText.join("\n").trim();
      }

      const chunks = await getFileChunks(meta.id);
      const validChunks = chunks.filter((c) => c.vector);

      if (validChunks.length > 0) {
        let queryEmb = null;

        if (actualPrompt) {
          try {
            queryEmb = (await fetchEmbeddings([actualPrompt]))[0];
          } catch (err) {
            if (btnEl) btnEl.textContent = origText;
            alert("Error fetching embeddings: " + err.message);
            return;
          }
        }

        const fileMaxTokens =
          meta.maxRagTokens !== undefined && meta.maxRagTokens !== ""
            ? parseInt(meta.maxRagTokens, 10)
            : undefined;
        const maxTokens =
          fileMaxTokens !== undefined && !isNaN(fileMaxTokens)
            ? fileMaxTokens
            : msg.maxTokens || 5000;

        const fileThreshold =
          meta.ragThreshold !== undefined && meta.ragThreshold !== ""
            ? parseFloat(meta.ragThreshold)
            : undefined;
        const threshold =
          fileThreshold !== undefined && !isNaN(fileThreshold)
            ? fileThreshold
            : msg.ragThreshold || 0.0;

        for (let i = 0; i < validChunks.length; i++) {
          const c = validChunks[i];
          c.score = queryEmb ? cosSim(queryEmb, c.vector) : -c.index;
          if (i % 500 === 0) await new Promise((r) => setTimeout(r, 0));
        }

        let topChunks = validChunks.filter(
          (c) => !queryEmb || c.score >= threshold,
        );
        topChunks.sort((a, b) => b.score - a.score);

        let currentTokens = 0;
        let finalChunksInternal = [];

        let retrievalFnCode =
          meta.retrievalFunc && meta.retrievalFunc.trim() !== ""
            ? meta.retrievalFunc
            : FILE_SETTING_DEFAULTS.retrievalFunc.default;
        let dedupFnCode =
          meta.dedupFunc && meta.dedupFunc.trim() !== ""
            ? meta.dedupFunc
            : FILE_SETTING_DEFAULTS.dedupFunc.default;
        let mergeFnCode =
          meta.mergeChunksFunc && meta.mergeChunksFunc.trim() !== ""
            ? meta.mergeChunksFunc
            : FILE_SETTING_DEFAULTS.mergeChunksFunc.default;

        let retrievalFn, dedupFn, mergeFn;

        try {
          retrievalFn = new AsyncFunction(
            "chunk",
            "fileContents",
            retrievalFnCode,
          );
        } catch (e) {
          console.error("Retrieval Fn Syntax Error:", e);
          retrievalFn = async (c, t) => c;
        }
        try {
          dedupFn = new AsyncFunction(
            "currentData",
            "existingData",
            dedupFnCode,
          );
        } catch (e) {
          console.error("Dedup Fn Syntax Error:", e);
          dedupFn = async (a, b) => a === b;
        }
        try {
          mergeFn = new AsyncFunction("finalChunks", mergeFnCode);
        } catch (e) {
          console.error("Merge Fn Syntax Error:", e);
          mergeFn = async (c) =>
            c
              .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
              .join("...");
        }

        for (let j = 0; j < topChunks.length; j++) {
          const curr = topChunks[j];
          let finalData = null;

          try {
            const chunkArg = curr.raw !== undefined ? curr.raw : curr.text;
            const retrievedData = await retrievalFn(chunkArg, data.text);
            if (retrievedData !== null && retrievedData !== undefined) {
              finalData = retrievedData;
            }
          } catch (e) {
            console.error("Post-processing error:", e);
            finalData = curr.raw !== undefined ? curr.raw : curr.text;
          }

          if (finalData !== null && finalData !== undefined) {
            let isDup = false;
            try {
              for (const d of finalChunksInternal) {
                if (await dedupFn(finalData, d.data)) {
                  isDup = true;
                  break;
                }
              }
            } catch (e) {
              console.error("Deduplication error:", e);
            }

            if (!isDup) {
              const strForTokens =
                typeof finalData === "string"
                  ? finalData
                  : JSON.stringify(finalData) || "";
              const chunkTokens = Math.ceil(strForTokens.length / 4);

              if (
                finalChunksInternal.length > 0 &&
                currentTokens + chunkTokens > maxTokens
              ) {
                break;
              }

              currentTokens += chunkTokens;
              finalChunksInternal.push({
                index: curr.index,
                data: finalData,
              });
            }
          }

          // Yield if processing high counts of custom logic to prevent locking UI
          if (j % 50 === 0) await new Promise((r) => setTimeout(r, 0));
        }

        finalChunksInternal.sort((a, b) => a.index - b.index);
        const finalChunks = finalChunksInternal.map((x) => x.data);

        let mergedContent = "";
        try {
          mergedContent = await mergeFn(finalChunks);
        } catch (e) {
          console.error("Merge function error:", e);
          mergedContent = finalChunks
            .map((c) => (typeof c === "string" ? c : JSON.stringify(c)))
            .join("...");
        }

        fileContent = mergedContent;
      } else {
        fileContent = "*File unindexed or no valid chunks.*";
      }
    }
  }

  let wrapperFnCode =
    meta && meta.fileWrapperFunc && meta.fileWrapperFunc.trim() !== ""
      ? meta.fileWrapperFunc
      : config.fileWrapperFunc && config.fileWrapperFunc.trim() !== ""
        ? config.fileWrapperFunc
        : SETTING_DEFAULTS.fileWrapperFunc.default;

  let wrapperFn;
  try {
    wrapperFn = new AsyncFunction("fileContent", "fileName", wrapperFnCode);
  } catch (e) {
    console.error("Wrapper Fn Syntax Error:", e);
    wrapperFn = async (c, n) => `\`${n}\`:\n\n\`\`\`\n${c}\n\`\`\``;
  }

  const formatted = await wrapperFn(fileContent, msg.fileName);

  if (btnEl) btnEl.textContent = origText;

  chat.messages.push({
    role: "user",
    content: formatted,
  });

  invalidateTokenCache();
  saveState();
  appendMessageToDOM(
    chat.messages[chat.messages.length - 1],
    chat.messages.length - 1,
  );
  updateTokenCount();
}

async function exportChunksAndVectors() {
  if (!activeAdvancedRAGFileId) return;
  const chunks = await getFileChunks(activeAdvancedRAGFileId);
  if (!chunks || chunks.length === 0) return alert("No chunks found.");

  const payload = {
    model: config.embeddingsModel,
    chunks: chunks.map((c) => ({
      text: c.text,
      raw: c.raw !== undefined ? c.raw : c.text,
      vector_b64: encodeVectorToBase64(c.vector),
    })),
  };

  const dataStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `file-vectors-${activeAdvancedRAGFileId}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importChunksAndVectors() {
  if (!activeAdvancedRAGFileId) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (!imported.chunks || !Array.isArray(imported.chunks))
          throw new Error("Invalid format.");

        if (imported.model !== config.embeddingsModel) {
          alert(
            `Model mismatch!\n\nExported model: '${imported.model}'\nCurrent model: '${config.embeddingsModel}'\n\nImport cancelled. To bypass this, manually edit the 'model' field in the JSON file to match your current model.`,
          );
          return;
        }

        const data = await dbGet(`mf_filedata_${activeAdvancedRAGFileId}`);
        if (!data) return;

        const raws = imported.chunks.map((c) =>
          c.raw !== undefined ? c.raw : c.text,
        );
        const meta = files.find((f) => f.id === activeAdvancedRAGFileId);
        meta.customChunks = JSON.stringify(raws, null, 2);

        // Wipe old chunks
        await dbDeleteByPrefix(`mf_chunk_${activeAdvancedRAGFileId}_`);

        let chunkIndex = 0;
        const entries = [];
        const chunks = imported.chunks.map((c) => {
          let vec = c.vector_b64
            ? decodeBase64ToVector(c.vector_b64)
            : c.vector
              ? new Float32Array(c.vector)
              : null;
          let mapped = {
            index: chunkIndex++,
            text: c.text,
            raw: c.raw !== undefined ? c.raw : c.text,
            vector: vec,
          };
          entries.push([
            `mf_chunk_${activeAdvancedRAGFileId}_${String(mapped.index).padStart(6, "0")}`,
            mapped,
          ]);
          return mapped;
        });

        await dbSetMultiple(entries);

        meta.chunkCount = chunks.length;
        meta.embeddedCount = chunks.filter((c) => c.vector).length;
        meta.exactProgress =
          meta.chunkCount > 0
            ? (meta.embeddedCount / meta.chunkCount) * 100
            : 0;
        meta.progress = Math.round(meta.exactProgress);
        if (meta.progress >= 100) meta.isEmbedding = false;

        await dbSet(`mf_filedata_${activeAdvancedRAGFileId}`, data);
        saveState();
        if (activeAdvancedRAGSetting === "customChunks") {
          await selectAdvancedRAGSetting("customChunks");
        } else {
          renderApp(true);
        }
        alert("Imported chunks and vectors successfully.");
      } catch (err) {
        alert("Failed to import: " + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
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
      console.error("Wrapper Fn Syntax Error:", e);
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

async function resetAllFileEmbeddings() {
  for (const meta of files) {
    meta.progress = 0;
    meta.exactProgress = 0;
    meta.embeddedCount = 0;
    meta.chunkCount = 0;
    meta.isEmbedding = false;
    meta.embeddingSpeed = null;
    meta.embeddingEta = null;
    if (embeddingAbortControllers[meta.id]) {
      embeddingAbortControllers[meta.id].abort();
      delete embeddingAbortControllers[meta.id];
    }
    await dbDeleteByPrefix(`mf_chunk_${meta.id}_`);
  }
  saveState();
  renderApp();
}
