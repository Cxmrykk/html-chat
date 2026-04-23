// --- EMBEDDINGS RAG & RESOLUTION ---
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
          if (nextMsg.role === "user" && nextMsg.content)
            lookaheadText.push(nextMsg.content);
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
            return alert("Error fetching embeddings: " + err.message);
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

        let retrievalFn = async (c, t) => c,
          dedupFn = async (a, b) => a === b,
          mergeFn = async (c) =>
            c
              .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
              .join("...");
        try {
          retrievalFn = new AsyncFunction(
            "chunk",
            "fileContents",
            retrievalFnCode,
          );
        } catch (e) {
          console.error("Retrieval Fn Syntax Error:", e);
        }
        try {
          dedupFn = new AsyncFunction(
            "currentData",
            "existingData",
            dedupFnCode,
          );
        } catch (e) {
          console.error("Dedup Fn Syntax Error:", e);
        }
        try {
          mergeFn = new AsyncFunction("finalChunks", mergeFnCode);
        } catch (e) {
          console.error("Merge Fn Syntax Error:", e);
        }

        for (let j = 0; j < topChunks.length; j++) {
          const curr = topChunks[j];
          let finalData = null;

          try {
            const chunkArg = curr.raw !== undefined ? curr.raw : curr.text;
            const retrievedData = await retrievalFn(chunkArg, data.text);
            if (retrievedData !== null && retrievedData !== undefined)
              finalData = retrievedData;
          } catch (e) {
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
              )
                break;
              currentTokens += chunkTokens;
              finalChunksInternal.push({ index: curr.index, data: finalData });
            }
          }
          if (j % 50 === 0) await new Promise((r) => setTimeout(r, 0));
        }

        finalChunksInternal.sort((a, b) => a.index - b.index);
        const finalChunks = finalChunksInternal.map((x) => x.data);

        try {
          fileContent = await mergeFn(finalChunks);
        } catch (e) {
          fileContent = finalChunks
            .map((c) => (typeof c === "string" ? c : JSON.stringify(c)))
            .join("...");
        }
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
  let wrapperFn = async (c, n) => `\`${n}\`:\n\n\`\`\`\n${c}\n\`\`\``;
  try {
    wrapperFn = new AsyncFunction("fileContent", "fileName", wrapperFnCode);
  } catch (e) {
    console.error("Wrapper Fn Syntax Error:", e);
  }

  const formatted = await wrapperFn(fileContent, msg.fileName);
  if (btnEl) btnEl.textContent = origText;

  chat.messages.push({ role: "user", content: formatted });
  invalidateTokenCache();
  saveState();
  appendMessageToDOM(
    chat.messages[chat.messages.length - 1],
    chat.messages.length - 1,
  );
  updateTokenCount();
}
