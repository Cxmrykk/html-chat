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
  const text = inputEl.value.trim();

  if (!isAutoLoop) {
    if (!text) return;
    if (!config.key && !skipApi)
      return alert("Please enter your API key in the settings first.");
    if (!currentChatId) newChat();
  }

  const chat = chats.find((c) => c.id === currentChatId);

  if (!isAutoLoop) {
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
    const cleanMessages = chat.messages
      .filter((m) => m.role !== "error")
      .map((m) => ({
        role: m.role,
        content: m.content || "",
      }));

    if (config.godMode) {
      cleanMessages.unshift({
        role: "system",
        content: GOD_MODE_PROMPT,
      });
    }

    const response = await fetch(`${config.url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.key}`,
      },
      body: JSON.stringify({
        model: $("#model-select").value,
        messages: cleanMessages,
      }),
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
    if (editingMessageIndex !== null) saveGlobalEdit();
    else sendMessage(0, e.shiftKey);
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

const toggleCopyMode = (e) => {
  if (e.key === "Control" || e.key === "Meta")
    document.body.classList.toggle("ctrl-down", e.type === "keydown");
};
window.addEventListener("keydown", toggleCopyMode);
window.addEventListener("keyup", toggleCopyMode);
window.addEventListener("blur", () =>
  document.body.classList.remove("ctrl-down"),
);

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
