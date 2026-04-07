// --- ZERO-STORAGE RAG UTILITIES ---
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
  let base = config.url.replace(/\/+$/, "");
  if (base.endsWith("/chat/completions"))
    base = base.replace("/chat/completions", "");
  const endpoint = base + "/embeddings";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.key}`,
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

async function processRAG(promptText, requiredFiles, fileContents, btnEl) {
  const queryText = promptText.replace(/\[file:\s*(.*?)\]/g, "").trim();
  let queryEmb = null;
  if (queryText) {
    if (btnEl) btnEl.textContent = "Embedding query...";
    queryEmb = (await fetchEmbeddings([queryText]))[0];
  }

  const chunkSize = parseInt(config.chunkSize) || 1000;
  const chunkOverlap = parseInt(config.chunkOverlap) || 200;
  const topK = parseInt(config.topK) || 5;

  let expandedPrompt = promptText;

  for (const filename of requiredFiles) {
    const text = fileContents[filename];
    if (!text) continue;

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
      });
      if (end >= text.length) break;
      start = end - chunkOverlap;
    }

    if (chunks.length === 0) continue;

    const MAX_BATCH = parseInt(config.chunkBatchSize) || 100;
    let fileEmbs = [];

    for (let i = 0; i < chunks.length; i += MAX_BATCH) {
      if (btnEl) {
        const currentChunk = Math.min(i + MAX_BATCH, chunks.length);
        const percent = Math.round((currentChunk / chunks.length) * 100);
        btnEl.textContent = `Embedding ${filename} (${percent}%)`;
      }

      const batchTexts = chunks.slice(i, i + MAX_BATCH).map((c) => c.text);
      const batchEmbs = await fetchEmbeddings(batchTexts);
      fileEmbs.push(...batchEmbs);
    }

    chunks.forEach((c, i) => {
      c.score = queryEmb ? cosSim(queryEmb, fileEmbs[i]) : -c.index;
    });

    chunks.sort((a, b) => b.score - a.score);
    const topChunks = chunks.slice(0, topK);
    topChunks.sort((a, b) => a.index - b.index);

    let mergedContent = "";
    for (let i = 0; i < topChunks.length; i++) {
      const curr = topChunks[i];
      if (i === 0) {
        mergedContent += curr.text;
      } else {
        const prev = topChunks[i - 1];
        if (curr.index === prev.index + 1) {
          mergedContent += text.substring(prev.end, curr.end);
        } else {
          mergedContent += `\n...\n${curr.text}`;
        }
      }
    }

    const fileBlock = `<file name="${filename}">\n${mergedContent}\n</file>`;
    expandedPrompt = expandedPrompt
      .split(`[file: ${filename}]`)
      .join(fileBlock);
  }

  return expandedPrompt;
}

async function resolveAllMessages(cleanMessages, btnEl, preSelectedFiles = []) {
  const requiredFiles = new Set();

  cleanMessages.forEach((msg) => {
    const matches = [...msg.content.matchAll(/\[file:\s*(.*?)\]/g)];
    for (const m of matches) {
      requiredFiles.add(m[1]);
    }
  });

  const reqArray = Array.from(requiredFiles);
  if (reqArray.length === 0) return cleanMessages;

  let allFiles = [...preSelectedFiles];
  let providedNames = allFiles.map((f) => f.name);
  let missingFiles = reqArray.filter((name) => !providedNames.includes(name));

  if (missingFiles.length > 0) {
    btnEl.textContent = "Awaiting required files...";
    await new Promise((r) => setTimeout(r, 50));
    alert(
      `Please select the following files to continue:\n${missingFiles.join("\n")}`,
    );
    const newFiles = await pickFiles(true);

    if (!newFiles || newFiles.length === 0) {
      throw new Error("File selection cancelled.");
    }

    allFiles.push(...newFiles);
    providedNames = allFiles.map((f) => f.name);
    missingFiles = reqArray.filter((name) => !providedNames.includes(name));

    if (missingFiles.length > 0) {
      throw new Error(`Missing required files:\n${missingFiles.join("\n")}`);
    }
  }

  btnEl.textContent = "Reading files...";
  let fileContents = {};
  for (const f of allFiles) {
    if (reqArray.includes(f.name) && !fileContents[f.name]) {
      fileContents[f.name] = await readFileText(f);
    }
  }

  for (let i = 0; i < cleanMessages.length; i++) {
    const msg = cleanMessages[i];
    if (/\[file:\s*(.*?)\]/.test(msg.content)) {
      msg.content = await processRAG(
        msg.content,
        reqArray,
        fileContents,
        btnEl,
      );
    }
  }

  return cleanMessages;
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
  let preSelectedFiles = [];

  if (!isAutoLoop) {
    if (!text) return;
    if (!config.key && !skipApi)
      return alert("Please enter your API key in the settings first.");
    if (!currentChatId) newChat();

    // RAG Phase 1: Creation (\embed to placeholders)
    if (text.includes("\\embed")) {
      btn.textContent = "Selecting files...";
      const files = await pickFiles(true);
      if (files && files.length > 0) {
        const fileTags = files.map((f) => `[file: ${f.name}]`).join(" ");
        text = text.replace(/\\embed/g, fileTags);
        inputEl.value = text;
        preSelectedFiles = files; // Store files to avoid Phase 2 prompt
      } else {
        btn.textContent = "Send";
        return;
      }
    }

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

    // Push clean UI text to history BEFORE resolving placeholders for the API
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
      .map((m) => ({
        role: m.role,
        content: m.content || "",
      }));

    if (config.godMode) {
      cleanMessages.unshift({
        role: "system",
        content: config.godModePrompt || DEFAULT_GOD_MODE_PROMPT,
      });
    }

    // RAG Phase 2: Execution (Inject Context into payload array ONLY)
    cleanMessages = await resolveAllMessages(
      cleanMessages,
      btn,
      preSelectedFiles,
    );

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
    renameChat(currentChatId);
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
