// --- FILE RAG & EMBEDDING UTILITIES ---
function pickFiles(multiple = true) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.addEventListener("change", (e) =>
      resolve(Array.from(e.target.files)),
    );
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file);
  });
}

function cosSim(a, b) {
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

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

// --- BACKGROUND EMBEDDING ENGINE ---
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
                  ) {
                    break;
                  }
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

// --- API & GOD MODE ---
async function executeGodMode(code) {
  let logs = [];
  const safeStr = (obj) => {
    try {
      return typeof obj === "object"
        ? JSON.stringify(obj, null, 2)
        : String(obj);
    } catch {
      return Object.prototype.toString.call(obj);
    }
  };
  const proxyConsole = {
    log: (...args) => logs.push(args.map(safeStr).join(" ")),
    error: (...args) => logs.push("ERROR: " + args.map(safeStr).join(" ")),
  };
  let result,
    errorStr = "";
  try {
    const execFn = new (Object.getPrototypeOf(
      async function () {},
    ).constructor)("console", code);
    result = await execFn(proxyConsole);
  } catch (err) {
    errorStr = err.toString();
  }

  let out = "**Execution Result:**\n```text\n";
  if (logs.length) out += logs.join("\n") + "\n";
  if (result !== undefined) out += "Return: " + safeStr(result) + "\n";
  if (errorStr) out += "Error: " + errorStr + "\n";
  if (!logs.length && result === undefined && !errorStr)
    out += "Code executed successfully with no output.\n";
  return out + "```";
}

async function sendMessage(autoLoopDepth = 0, skipApi = false) {
  const btn = $("#send-btn");
  const MAX_LOOPS = 5;

  if (autoLoopDepth >= MAX_LOOPS) {
    chats
      .find((c) => c.id === currentChatId)
      .messages.push({
        role: "error",
        content: `**System Error:** Maximum execution loop depth (${MAX_LOOPS}) reached.`,
      });
    updateTokenCount();
    saveState();
    renderApp();
    return;
  }

  const isAutoLoop = autoLoopDepth > 0;
  if (currentAbortController && !isAutoLoop) {
    currentAbortController.abort();
    currentAbortController = null;
    btn.textContent = "Send";
    return;
  }

  const inputEl = $("#chat-input");
  let text = inputEl.value.trim();

  if (!isAutoLoop) {
    if (!text) return;
    if (!config.key && !skipApi)
      return alert("Please enter your API key in the settings first.");

    if (!currentChatId) newChat();

    const chat = chats.find((c) => c.id === currentChatId);

    if (!chat.messages.length) {
      const lastDoubleNewline = text.lastIndexOf("\n\n");
      const titleSource =
        lastDoubleNewline !== -1
          ? text.substring(lastDoubleNewline + 2).trim()
          : text;
      chat.title =
        titleSource.substring(0, 30) + (titleSource.length > 30 ? "..." : "");
    }

    chat.messages.push({ role: "user", content: text });
    inputEl.value = "";
    saveState();
    renderApp();
  }

  if (skipApi) return;

  currentAbortController = new AbortController();
  btn.textContent = isAutoLoop
    ? `Thinking (Loop ${autoLoopDepth}/${MAX_LOOPS})...`
    : "Thinking...";

  try {
    const chat = chats.find((c) => c.id === currentChatId);
    let cleanMessages = chat.messages
      .filter((m) => m.role !== "error")
      .map((m) => {
        if (m.role === "file") return { ...m };
        return {
          role: m.role,
          content: m.content || "",
        };
      });

    if (config.godMode) {
      cleanMessages.unshift({
        role: "system",
        content: config.godModePrompt || DEFAULT_GOD_MODE_PROMPT,
      });
    }

    // Inject File Context from DB
    cleanMessages = await resolveAllMessages(cleanMessages, btn);

    const payload = {
      model: $("#model-select").value,
      messages: cleanMessages,
    };

    if (config.temperature !== "" && config.temperature !== undefined)
      payload.temperature = parseFloat(config.temperature);
    if (config.top_p !== "" && config.top_p !== undefined)
      payload.top_p = parseFloat(config.top_p);
    if (
      config.frequency_penalty !== "" &&
      config.frequency_penalty !== undefined
    )
      payload.frequency_penalty = parseFloat(config.frequency_penalty);
    if (config.presence_penalty !== "" && config.presence_penalty !== undefined)
      payload.presence_penalty = parseFloat(config.presence_penalty);
    if (config.max_tokens !== "" && config.max_tokens !== undefined)
      payload.max_tokens = parseInt(config.max_tokens, 10);

    const response = await fetch(`${config.url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.key}`,
      },
      body: JSON.stringify(payload),
      signal: currentAbortController.signal,
    });

    if (!response.ok)
      throw new Error(
        (await response.json().catch(() => ({}))).error?.message ||
          `HTTP ${response.status}`,
      );
    const reply = (await response.json()).choices[0].message.content || "";

    if (config.godMode && reply) {
      const runMatches = [...reply.matchAll(/<run>([\s\S]*?)<\/run>/g)];
      if (runMatches.length > 0) {
        chat.messages.push({
          role: "assistant",
          content: reply,
        });
        saveState();
        renderApp();

        for (const match of runMatches) {
          const code = match[1].trim();
          const result = await executeGodMode(code);
          chat.messages.push({ role: "user", content: result });
          saveState();
          renderApp(true);
        }
        return sendMessage(autoLoopDepth + 1);
      }
    }

    if (reply.trim() !== "" || isAutoLoop) {
      chat.messages.push({ role: "assistant", content: reply });
      saveState();
      renderApp();
    }
  } catch (error) {
    const chat = chats.find((c) => c.id === currentChatId);
    chat.messages.push({
      role: "error",
      content:
        error.name === "AbortError"
          ? "**System:** Request cancelled by user."
          : `**Error:**\n\n${error.message}`,
    });
  }

  currentAbortController = null;
  btn.textContent = "Send";
  saveState();
  renderApp();
}

$("#chat-input").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    if (isSuperSecretSettingsOpen && activeSuperSecretSetting) {
      saveSuperSecretSetting();
    } else if (editingMessageIndex !== null) {
      saveGlobalEdit();
    } else {
      sendMessage(0, e.shiftKey);
    }
  }
});

// --- KEYBOARD & CLIPBOARD ---
document.addEventListener("keydown", (e) => {
  if (e.altKey && e.key.toLowerCase() === "t") {
    e.preventDefault();
    newChat();
    $("#chat-input").focus();
  }
  if (e.altKey && e.key.toLowerCase() === "w") {
    e.preventDefault();
    if (currentChatId) deleteChat(currentChatId);
  }
  if (e.altKey && e.key.toLowerCase() === "r") {
    e.preventDefault();
    if (currentChatId) renameChat(currentChatId);
  }
  if (e.altKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    toggleSidebar();
  }
  if (e.altKey && e.key.toLowerCase() === "o") {
    e.preventDefault();
    toggleTitle();
  }

  if (e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    if (document.activeElement?.tagName === "TEXTAREA") return;
    e.preventDefault();
    const container = $("#chat-container");
    const msgs = Array.from(container.querySelectorAll(".msg"));
    if (!msgs.length) return;

    if (e.key === "ArrowDown") {
      const next = msgs.find((m) => m.offsetTop - 15 > container.scrollTop + 5);
      container.scrollTop = next ? next.offsetTop - 15 : container.scrollHeight;
    } else {
      const prev = msgs
        .slice()
        .reverse()
        .find((m) => m.offsetTop - 15 < container.scrollTop - 5);
      container.scrollTop = prev ? prev.offsetTop - 15 : 0;
    }
  }

  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    if (!chats.length) return;
    let idx = Math.max(
      0,
      chats.findIndex((c) => c.id === currentChatId),
    );
    if (e.key === "ArrowUp" && idx > 0) loadChat(chats[idx - 1].id);
    if (e.key === "ArrowDown" && idx < chats.length - 1)
      loadChat(chats[idx + 1].id);
  }

  if (
    !e.shiftKey &&
    !e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    (e.key === "ArrowUp" || e.key === "ArrowDown")
  ) {
    const tag = document.activeElement?.tagName.toLowerCase();
    if (tag !== "input" && tag !== "textarea" && tag !== "select") {
      e.preventDefault();
      $("#chat-container").scrollBy({
        top: e.key === "ArrowDown" ? 150 : -150,
        behavior: "smooth",
      });
    }
  }
});

const toggleModifierMode = (e) => {
  if (e.key === "Control" || e.key === "Meta")
    document.body.classList.toggle("ctrl-down", e.type === "keydown");
  if (e.key === "Alt")
    document.body.classList.toggle("alt-down", e.type === "keydown");
};
window.addEventListener("keydown", toggleModifierMode);
window.addEventListener("keyup", toggleModifierMode);
window.addEventListener("blur", () => {
  document.body.classList.remove("ctrl-down");
  document.body.classList.remove("alt-down");
});

$("#chat-container").addEventListener("click", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const target =
    e.target.closest(".katex") ||
    e.target.closest("pre") ||
    e.target.closest("code");
  if (!target) return;

  let text = target.classList.contains("katex")
    ? target.querySelector("annotation")?.textContent ||
      target.querySelector(".katex-mathml math")?.getAttribute("alttext") ||
      ""
    : target.innerText;

  if (text) {
    e.preventDefault();
    navigator.clipboard.writeText(text).then(() => {
      const bg = target.style.backgroundColor;
      target.style.backgroundColor = "#ccc";
      setTimeout(() => (target.style.backgroundColor = bg), 100);
    });
  }
});

function updateTokenCount() {
  const btn = $("#send-btn");
  if (!btn) return;

  if (btn.textContent.includes("Thinking") || btn.classList.contains("hidden"))
    return;

  const inputVal = $("#chat-input").value || "";
  let contextChars = 0;

  if (currentChatId) {
    const chat = chats.find((c) => c.id === currentChatId);
    if (chat && chat.messages) {
      contextChars = chat.messages.reduce((acc, m) => {
        if (m.role === "file") {
          if (m.mode === "full") return acc + (m.content || "").length;
          return acc + (m.maxTokens || 5000) * 4;
        }
        return acc + (m.content || "").length;
      }, 0);
    }
  }

  if (config.godMode) {
    contextChars += (config.godModePrompt || DEFAULT_GOD_MODE_PROMPT).length;
  }

  const totalChars = inputVal.length + contextChars;
  const tokens = Math.ceil(totalChars / 4);

  if (tokens < 1000) {
    btn.textContent = "Send";
  } else {
    let label;
    if (tokens >= 1000000) {
      label = (tokens / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    } else {
      label = (tokens / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    }
    btn.textContent = `Send (${label} tokens)`;
  }
}
