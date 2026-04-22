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

  let changed = false;
  let newChunks = [];
  let chunkIndex = 0;

  for (const c of chunks) {
    const stringified = typeof c === "string" ? c : JSON.stringify(c);

    let existing = data.chunks
      ? data.chunks.find((old) => old.text === stringified && old.vector)
      : null;
    if (!existing) changed = true;

    newChunks.push({
      index: chunkIndex++,
      text: stringified,
      raw: c,
      vector: existing ? existing.vector : null,
    });
  }

  if (!data.chunks || data.chunks.length !== newChunks.length) changed = true;
  else if (data.chunks.some((old, i) => old.text !== newChunks[i].text))
    changed = true;

  if (changed) {
    data.chunks = newChunks;
    meta.chunkCount = newChunks.length;
    meta.embeddedCount = newChunks.filter((c) => c.vector).length;
    meta.exactProgress =
      meta.chunkCount > 0 ? (meta.embeddedCount / meta.chunkCount) * 100 : 0;
    meta.progress = Math.round(meta.exactProgress);
    if (meta.progress >= 100) meta.isEmbedding = false;
    await dbSet(`mf_filedata_${id}`, data);
    saveState();
  }
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
  let loopStartTime = Date.now();
  let loopStartEmbeddedCount = null;

  try {
    while (true) {
      const meta = files.find((f) => f.id === id);
      if (!meta || !meta.isEmbedding) break;

      const currentData = await dbGet(`mf_filedata_${id}`);
      if (!currentData || !currentData.chunks) {
        await refreshFileChunks(id);
        const m = files.find((f) => f.id === id);
        if (!m || !m.isEmbedding) break;
      }

      const data = await dbGet(`mf_filedata_${id}`);
      if (!data || !data.chunks) break;

      const batch = data.chunks.filter((c) => !c.vector).slice(0, MAX_BATCH);

      if (batch.length === 0) {
        meta.exactProgress = 100.0;
        meta.progress = 100;
        meta.isEmbedding = false;
        meta.embeddingSpeed = null;
        meta.embeddingEta = null;
        renderFileList();
        if (isAdvancedRAGSettingsOpen && activeAdvancedRAGFileId === id)
          renderApp(true);
        break;
      }

      try {
        const batchTexts = batch.map((c) => c.text);
        const signal = embeddingAbortControllers[id].signal;
        const embs = await fetchEmbeddings(batchTexts, signal);

        batch.forEach((c, i) => {
          c.vector = embs[i];
        });

        meta.embeddedCount = data.chunks.filter((c) => c.vector).length;
        meta.chunkCount = data.chunks.length;
        meta.exactProgress = (meta.embeddedCount / meta.chunkCount) * 100;
        meta.progress = Math.round(meta.exactProgress);

        if (loopStartEmbeddedCount === null) {
          loopStartEmbeddedCount = meta.embeddedCount - batch.length;
        }

        const elapsedSec = (Date.now() - loopStartTime) / 1000;
        const chunksDone = meta.embeddedCount - loopStartEmbeddedCount;
        if (elapsedSec > 0 && chunksDone > 0) {
          meta.embeddingSpeed = chunksDone / elapsedSec;
          meta.embeddingEta =
            (meta.chunkCount - meta.embeddedCount) / meta.embeddingSpeed;
        }

        await dbSet(`mf_filedata_${id}`, data);
        saveState();
        renderFileList();
        if (isAdvancedRAGSettingsOpen && activeAdvancedRAGFileId === id)
          renderApp(true);

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

      if (data.chunks) {
        const validChunks = data.chunks.filter((c) => c.vector);
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

          validChunks.forEach((c) => {
            c.score = queryEmb ? cosSim(queryEmb, c.vector) : -c.index;
          });

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
      } else {
        fileContent = "*File unindexed.*";
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
    const data = await dbGet(`mf_filedata_${meta.id}`);
    if (data) {
      data.chunks = null;
      await dbSet(`mf_filedata_${meta.id}`, data);
    }
  }
  saveState();
  renderApp();
}
