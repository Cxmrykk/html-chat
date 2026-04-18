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
  const isCustomChunker =
    meta.customChunker &&
    meta.customChunker.trim() !== "" &&
    meta.customChunker !== FILE_SETTING_DEFAULTS.customChunker.default;

  if (meta.customChunks && meta.customChunks.trim() !== "") {
    try {
      const parsed = JSON.parse(meta.customChunks);
      if (Array.isArray(parsed)) chunks = parsed;
    } catch (e) {
      console.error("Error parsing customChunks:", e);
    }
  } else if (isCustomChunker) {
    try {
      const fn = new Function("text", "config", meta.customChunker);
      const res = fn(text, config);
      if (Array.isArray(res)) chunks = res;
    } catch (e) {
      console.error("Error executing customChunker:", e);
    }
  }

  if (chunks.length === 0 || typeof chunks[0] !== "string") {
    const chunkSize = parseInt(config.chunkSize) || 1000;
    const chunkOverlap = parseInt(config.chunkOverlap) || 200;
    let start = 0;
    while (start < text.length) {
      let end = start + chunkSize;
      if (end > text.length) end = text.length;
      chunks.push(text.substring(start, end));
      if (end >= text.length) break;
      start = end - chunkOverlap;
    }
  }

  let changed = false;
  let newChunks = [];
  let chunkIndex = 0;
  let start = 0;

  for (const c of chunks) {
    let end = start + c.length;
    let existing = data.chunks
      ? data.chunks.find((old) => old.text === c && old.vector)
      : null;
    if (!existing) changed = true;

    newChunks.push({
      index: chunkIndex++,
      start: start,
      end: end,
      text: c,
      vector: existing ? existing.vector : null,
    });
    start = end;
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

                // File specific RAG Overrides
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

                const fileSep =
                  meta.chunkSeparator !== undefined &&
                  meta.chunkSeparator !== ""
                    ? meta.chunkSeparator
                    : undefined;
                let sep =
                  fileSep !== undefined
                    ? fileSep
                    : msg.chunkSeparator !== undefined
                      ? msg.chunkSeparator
                      : "...";
                sep = sep.replace(/\\n/g, "\n").replace(/\\t/g, "\t");

                validChunks.forEach((c) => {
                  c.score = queryEmb ? cosSim(queryEmb, c.vector) : -c.index;
                });

                let topChunks = validChunks.filter(
                  (c) => !queryEmb || c.score >= threshold,
                );
                topChunks.sort((a, b) => b.score - a.score);

                let currentTokens = 0;
                let processedChunks = [];

                let hasCapture =
                  meta.captureFunc && meta.captureFunc.trim() !== "";
                let hasRetrieval =
                  meta.retrievalFunc && meta.retrievalFunc.trim() !== "";
                let hasDedup = meta.dedupFunc && meta.dedupFunc.trim() !== "";

                let captureFn = null;
                let retrievalFn = null;
                let dedupFn = null;

                if (hasCapture) {
                  try {
                    captureFn = new Function("chunk", meta.captureFunc);
                  } catch (e) {
                    console.error("Capture function error:", e);
                    hasCapture = false;
                  }
                }
                if (hasRetrieval) {
                  try {
                    retrievalFn = new Function(
                      "matches",
                      "text",
                      meta.retrievalFunc,
                    );
                  } catch (e) {
                    console.error("Retrieval function error:", e);
                    hasRetrieval = false;
                  }
                }
                if (hasDedup) {
                  try {
                    dedupFn = new Function("chunkA", "chunkB", meta.dedupFunc);
                  } catch (e) {
                    console.error("Dedup function error:", e);
                    hasDedup = false;
                  }
                }

                for (let j = 0; j < topChunks.length; j++) {
                  const curr = topChunks[j];
                  let finalStr = curr.text;

                  if (hasCapture) {
                    try {
                      const m = captureFn(curr.text);
                      if (hasRetrieval) {
                        const retrieved = retrievalFn(m, data.text);
                        finalStr =
                          typeof retrieved === "string" ? retrieved : "";
                      } else {
                        finalStr = Array.isArray(m)
                          ? m.join("")
                          : String(m || "");
                      }
                    } catch (e) {
                      console.error("Post-processing error:", e);
                    }
                  }

                  if (finalStr !== "") {
                    let isDup = false;
                    if (hasDedup) {
                      try {
                        for (const d of processedChunks) {
                          if (dedupFn(finalStr, d.text)) {
                            isDup = true;
                            break;
                          }
                        }
                      } catch (e) {
                        console.error("Deduplication error:", e);
                      }
                    }

                    if (!isDup) {
                      const chunkTokens = Math.ceil(finalStr.length / 4);
                      if (
                        processedChunks.length > 0 &&
                        currentTokens + chunkTokens > maxTokens
                      ) {
                        break;
                      }

                      currentTokens += chunkTokens;
                      processedChunks.push({
                        index: curr.index,
                        start: curr.start,
                        end: curr.end,
                        text: finalStr,
                      });
                    }
                  }
                }

                processedChunks.sort((a, b) => a.index - b.index);

                let mergedContent = "";
                let usesCustomChunking =
                  (meta.customChunks && meta.customChunks.trim() !== "") ||
                  (meta.customChunker &&
                    meta.customChunker.trim() !== "" &&
                    meta.customChunker !==
                      FILE_SETTING_DEFAULTS.customChunker.default);
                let usesPostProcessing =
                  hasCapture || hasRetrieval || usesCustomChunking;

                for (let j = 0; j < processedChunks.length; j++) {
                  const curr = processedChunks[j];
                  if (j === 0) {
                    mergedContent += curr.text;
                  } else {
                    const prev = processedChunks[j - 1];
                    if (!usesPostProcessing && curr.index === prev.index + 1) {
                      mergedContent += data.text.substring(prev.end, curr.end);
                    } else {
                      mergedContent += sep + curr.text;
                    }
                  }
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
