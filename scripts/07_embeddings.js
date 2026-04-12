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

async function startEmbeddingLoop(id) {
  if (!config.embeddingsModel || config.embeddingsModel.trim() === "") return;

  const meta = files.find((f) => f.id === id);
  if (!meta || !meta.isEmbedding) return;
  const data = await dbGet(`mf_filedata_${id}`);
  if (!data) return;

  if (!data.chunks) {
    const chunkSize = parseInt(config.chunkSize) || 1000;
    const chunkOverlap = parseInt(config.chunkOverlap) || 200;
    const text = data.text;
    const chunks = [];
    let start = 0;
    let chunkIndex = 0;

    while (start < text.length) {
      let end = start + chunkSize;
      if (end > text.length) end = text.length;
      chunks.push({
        index: chunkIndex++,
        start: start,
        end: end,
        text: text.substring(start, end),
        vector: null,
      });
      if (end >= text.length) break;
      start = end - chunkOverlap;
    }

    data.chunks = chunks;
    meta.chunkCount = chunks.length;
    meta.embeddedCount = 0;
    await dbSet(`mf_filedata_${id}`, data);
  }

  const MAX_BATCH = parseInt(config.chunkBatchSize) || 100;

  while (true) {
    const currentMeta = files.find((f) => f.id === id);
    if (!currentMeta || !currentMeta.isEmbedding) break;

    const batch = data.chunks.filter((c) => !c.vector).slice(0, MAX_BATCH);
    if (batch.length === 0) {
      currentMeta.progress = 100;
      currentMeta.isEmbedding = false;
      break;
    }

    try {
      const batchTexts = batch.map((c) => c.text);
      const embs = await fetchEmbeddings(batchTexts);

      batch.forEach((c, i) => {
        c.vector = embs[i];
      });

      currentMeta.embeddedCount += batch.length;
      currentMeta.progress = Math.round(
        (currentMeta.embeddedCount / currentMeta.chunkCount) * 100,
      );

      await dbSet(`mf_filedata_${id}`, data);
      saveState();
      renderFileList();
      await new Promise((r) => setTimeout(r, 100)); // Yield to UI
    } catch (err) {
      console.error("Embedding error:", err);
      currentMeta.isEmbedding = false;
      saveState();
      renderFileList();
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
                  if (btnEl)
                    btnEl.textContent = `Embedding prompt for ${meta.name}...`;
                  queryEmb = (await fetchEmbeddings([actualPrompt]))[0];
                }

                validChunks.forEach((c) => {
                  c.score = queryEmb ? cosSim(queryEmb, c.vector) : -c.index;
                });

                const threshold = msg.ragThreshold || 0.0;
                let topChunks = validChunks.filter(
                  (c) => !queryEmb || c.score >= threshold,
                );
                topChunks.sort((a, b) => b.score - a.score);

                const maxTokens = msg.maxTokens || 5000;
                let currentTokens = 0;
                let selectedChunks = [];

                for (const c of topChunks) {
                  const chunkTokens = Math.ceil(c.text.length / 4);
                  if (
                    selectedChunks.length > 0 &&
                    currentTokens + chunkTokens > maxTokens
                  )
                    break;
                  selectedChunks.push(c);
                  currentTokens += chunkTokens;
                }

                selectedChunks.sort((a, b) => a.index - b.index);

                let mergedContent = "";
                let sep =
                  msg.chunkSeparator !== undefined ? msg.chunkSeparator : "...";
                sep = sep.replace(/\\n/g, "\n").replace(/\\t/g, "\t");

                for (let j = 0; j < selectedChunks.length; j++) {
                  const curr = selectedChunks[j];
                  if (j === 0) {
                    mergedContent += curr.text;
                  } else {
                    const prev = selectedChunks[j - 1];
                    if (curr.index === prev.index + 1) {
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
