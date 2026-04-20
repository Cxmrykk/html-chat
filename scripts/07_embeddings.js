// --- EMBEDDINGS & RAG ---
async function fetchEmbeddings(texts) {
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
      const fn = new Function("fileContents", chunkerCode);
      const res = fn(text, config);
      if (Array.isArray(res)) chunks = res;
    } catch (e) {
      console.error("Error executing customChunker:", e);
    }
  }

  if (!Array.isArray(chunks) || chunks.length === 0) {
    chunks = [text];
  }

  // Filter out any null chunks returned by the chunker
  chunks = chunks.filter((c) => c !== null && c !== undefined);

  let changed = false;
  let newChunks = [];
  let chunkIndex = 0;

  for (const c of chunks) {
    // Stringify for embedding/indexing purposes if it's an object
    const stringified = typeof c === "string" ? c : JSON.stringify(c);

    let existing = data.chunks
      ? data.chunks.find((old) => old.text === stringified && old.vector)
      : null;
    if (!existing) changed = true;

    newChunks.push({
      index: chunkIndex++,
      text: stringified,
      raw: c, // Preserve the raw object for passing to captureFunc
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
    meta.progress =
      meta.chunkCount > 0
        ? Math.round((meta.embeddedCount / meta.chunkCount) * 100)
        : 0;
    if (meta.progress >= 100) meta.isEmbedding = false;
    await dbSet(`mf_filedata_${id}`, data);
    saveState();
  }
}

async function startEmbeddingLoop(id) {
  if (!config.embeddingsModel || config.embeddingsModel.trim() === "") return;

  const initialMeta = files.find((f) => f.id === id);
  if (!initialMeta || !initialMeta.isEmbedding) return;
  const initialData = await dbGet(`mf_filedata_${id}`);
  if (!initialData) return;

  if (!initialData.chunks) {
    await refreshFileChunks(id);
    const m = files.find((f) => f.id === id);
    if (!m || !m.isEmbedding) return;
  }

  const MAX_BATCH = parseInt(config.chunkBatchSize) || 100;

  while (true) {
    const currentMeta = files.find((f) => f.id === id);
    if (!currentMeta || !currentMeta.isEmbedding) break;

    const currentData = await dbGet(`mf_filedata_${id}`);
    if (!currentData || !currentData.chunks) break;

    const batch = currentData.chunks
      .filter((c) => !c.vector)
      .slice(0, MAX_BATCH);
    if (batch.length === 0) {
      currentMeta.progress = 100;
      currentMeta.isEmbedding = false;
      renderFileList();
      if (isAdvancedRAGSettingsOpen && activeAdvancedRAGFileId === id)
        renderApp(true);
      break;
    }

    try {
      const batchTexts = batch.map((c) => c.text);
      const embs = await fetchEmbeddings(batchTexts);

      batch.forEach((c, i) => {
        c.vector = embs[i];
      });

      currentMeta.embeddedCount = currentData.chunks.filter(
        (c) => c.vector,
      ).length;
      currentMeta.chunkCount = currentData.chunks.length;
      currentMeta.progress = Math.round(
        (currentMeta.embeddedCount / currentMeta.chunkCount) * 100,
      );

      await dbSet(`mf_filedata_${id}`, currentData);
      saveState();
      renderFileList();
      await new Promise((r) => setTimeout(r, 100)); // Yield to UI
    } catch (err) {
      console.error("Embedding error:", err);
      currentMeta.isEmbedding = false;
      saveState();
      renderFileList();
      if (isAdvancedRAGSettingsOpen && activeAdvancedRAGFileId === id)
        renderApp(true);
      alert(`Embedding failed for ${currentMeta.name}: ${err.message}`);
      break;
    }
  }

  saveState();
  renderFileList();
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
            const extMatch = (meta.name || "").match(/\.([^.]+)$/);
            const ext = extMatch ? extMatch[1] : "txt";
            const blockTicks = data.text.includes("```") ? "````" : "```";
            fileContent = `\`${meta.name}\`:\n\n${blockTicks}${ext}\n${data.text}\n${blockTicks}`;
          }
        }
        resolved.push({
          role: "user",
          content: fileContent || "*File not found.*",
        });
      } else {
        let fileContent = "*File not found.*";

        if (meta) {
          const data = await dbGet(`mf_filedata_${meta.id}`);
          if (data) {
            let actualPrompt = msg.prompt ? msg.prompt.trim() : "";
            let implicitSearchUsed = false;

            if (!actualPrompt) {
              let lookaheadText = [];
              for (let j = i + 1; j < messages.length; j++) {
                const nextMsg = messages[j];
                if (nextMsg.role === "assistant") break;
                if (nextMsg.role === "user" && nextMsg.content) {
                  lookaheadText.push(nextMsg.content);
                }
              }
              actualPrompt = lookaheadText.join("\n").trim();
              if (actualPrompt) implicitSearchUsed = true;
            }

            if (data.chunks) {
              const validChunks = data.chunks.filter((c) => c.vector);
              if (validChunks.length > 0) {
                let queryEmb = null;

                if (actualPrompt) {
                  if (btnEl) btnEl.textContent = "Embedding files...";
                  queryEmb = (await fetchEmbeddings([actualPrompt]))[0];
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

                let captureFnCode =
                  meta.captureFunc && meta.captureFunc.trim() !== ""
                    ? meta.captureFunc
                    : FILE_SETTING_DEFAULTS.captureFunc.default;
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

                let captureFn, retrievalFn, dedupFn, mergeFn;

                try {
                  captureFn = new Function("chunk", captureFnCode);
                } catch (e) {
                  console.error("Capture Fn Syntax Error:", e);
                  captureFn = (t) => t;
                }
                try {
                  retrievalFn = new Function(
                    "capturedData",
                    "fileContents",
                    retrievalFnCode,
                  );
                } catch (e) {
                  console.error("Retrieval Fn Syntax Error:", e);
                  retrievalFn = (d, t) => d;
                }
                try {
                  dedupFn = new Function(
                    "currentData",
                    "existingData",
                    dedupFnCode,
                  );
                } catch (e) {
                  console.error("Dedup Fn Syntax Error:", e);
                  dedupFn = (a, b) => a === b;
                }
                try {
                  mergeFn = new Function("finalChunks", mergeFnCode);
                } catch (e) {
                  console.error("Merge Fn Syntax Error:", e);
                  mergeFn = (c, t) =>
                    c
                      .map((x) =>
                        typeof x === "string" ? x : JSON.stringify(x),
                      )
                      .join("...");
                }

                for (let j = 0; j < topChunks.length; j++) {
                  const curr = topChunks[j];
                  let finalData = null;

                  try {
                    // Provide the original chunk object if preserved, else fallback to text
                    const chunkArg =
                      curr.raw !== undefined ? curr.raw : curr.text;
                    const capturedData = captureFn(chunkArg);
                    if (capturedData !== null && capturedData !== undefined) {
                      const retrievedData = retrievalFn(
                        capturedData,
                        data.text,
                      );
                      if (
                        retrievedData !== null &&
                        retrievedData !== undefined
                      ) {
                        finalData = retrievedData;
                      }
                    }
                  } catch (e) {
                    console.error("Post-processing error:", e);
                    finalData = curr.raw !== undefined ? curr.raw : curr.text;
                  }

                  if (finalData !== null && finalData !== undefined) {
                    let isDup = false;
                    try {
                      for (const d of finalChunksInternal) {
                        if (dedupFn(finalData, d.data)) {
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
                  mergedContent = mergeFn(finalChunks);
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

        const extMatch = (msg.fileName || "").match(/\.([^.]+)$/);
        const ext = extMatch ? extMatch[1] : "txt";
        const blockTicks = fileContent.includes("```") ? "````" : "```";
        const formatted = `\`${msg.fileName}\`:\n\n${blockTicks}${ext}\n${fileContent}\n${blockTicks}`;

        resolved.push({
          role: "user",
          content: formatted,
        });
      }
    } else {
      resolved.push(msg);
    }
  }

  return resolved;
}

async function resetAllFileEmbeddings() {
  for (const meta of files) {
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
  renderApp();
}
