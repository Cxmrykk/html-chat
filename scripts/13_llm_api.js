// --- LLM API & GOD MODE ---
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
    const chat = chats.find((c) => c.id === currentChatId);
    chat.messages.push({
      role: "error",
      content: `**System Error:** Maximum execution loop depth (${MAX_LOOPS}) reached.`,
    });
    invalidateTokenCache();
    saveState();
    appendMessageToDOM(
      chat.messages[chat.messages.length - 1],
      chat.messages.length - 1,
    );
    return;
  }

  const isAutoLoop = autoLoopDepth > 0;
  if (currentAbortController && !isAutoLoop) {
    currentAbortController.abort();
    currentAbortController = null;
    btn.textContent = "Send";
    updateTokenCount();
    return;
  }

  const inputEl = $("#chat-input");
  let text = inputEl.value.trim();

  if (!isAutoLoop) {
    if (!text) return;
    if (!config.key && !skipApi)
      return alert("Please enter your API key in the settings first.");

    if (!currentChatId) {
      newChat();
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
      renderChatList();
    }

    chat.messages.push({ role: "user", content: text });
    inputEl.value = "";
    invalidateTokenCache();
    saveState();
    appendMessageToDOM(
      chat.messages[chat.messages.length - 1],
      chat.messages.length - 1,
    );
    updateTokenCount();
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
        return { role: m.role, content: m.content || "" };
      });

    if (config.godMode) {
      cleanMessages.unshift({
        role: "system",
        content: config.godModePrompt || DEFAULT_GOD_MODE_PROMPT,
      });
    }

    cleanMessages = await resolveAllMessages(cleanMessages, btn);

    // After resolving file embeddings, we wait on the API. Set state to Thinking...
    btn.textContent = isAutoLoop
      ? `Thinking (Loop ${autoLoopDepth}/${MAX_LOOPS})...`
      : "Thinking...";

    const isStream = config.streamResponse !== "false";

    const payload = {
      model: $("#model-select").value,
      messages: cleanMessages,
      stream: isStream,
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

    // Target API Responded. Generating text...
    btn.textContent = isAutoLoop
      ? `Generating (Loop ${autoLoopDepth}/${MAX_LOOPS})...`
      : "Generating...";

    chat.messages.push({ role: "assistant", content: "" });
    const msgIndex = chat.messages.length - 1;
    appendMessageToDOM(chat.messages[msgIndex], msgIndex);
    invalidateTokenCache();

    let reply = "";

    if (!isStream) {
      const data = await response.json();
      reply = data.choices[0]?.message?.content || "";
      chat.messages[msgIndex].content = reply;
      updateMessageContentInDOM(msgIndex, reply, true, "top");
    } else {
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let lastRenderTime = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let lines = buffer.split("\n");
          buffer = lines.pop();

          for (let line of lines) {
            line = line.trim();
            if (line.startsWith("data: ")) {
              if (line === "data: [DONE]") continue;
              try {
                const data = JSON.parse(line.slice(6));
                const chunk = data.choices[0]?.delta?.content;
                if (chunk) reply += chunk;
              } catch (e) {}
            }
          }

          chat.messages[msgIndex].content = reply;

          const now = Date.now();
          // Throttle UI rendering to ~10fps to avoid blocking thread
          if (now - lastRenderTime > 100) {
            updateMessageContentInDOM(msgIndex, reply, false);
            lastRenderTime = now;
          }
        }
      } catch (err) {
        if (err.name === "AbortError") {
          reply += "\n\n*[Stopped by user]*";
          chat.messages[msgIndex].content = reply;
        } else {
          throw err;
        }
      }

      chat.messages[msgIndex].content = reply;
      updateMessageContentInDOM(msgIndex, reply, true, "none");
    }

    saveState();

    if (config.godMode && reply) {
      const runMatches = [...reply.matchAll(/<run>([\s\S]*?)<\/run>/g)];
      if (runMatches.length > 0) {
        for (const match of runMatches) {
          const code = match[1].trim();
          const result = await executeGodMode(code);
          chat.messages.push({ role: "user", content: result });
          invalidateTokenCache();
          saveState();
          appendMessageToDOM(
            chat.messages[chat.messages.length - 1],
            chat.messages.length - 1,
          );
        }
        return sendMessage(autoLoopDepth + 1);
      }
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      const chat = chats.find((c) => c.id === currentChatId);
      chat.messages.push({
        role: "error",
        content: `**Error:**\n\n${error.message}`,
      });
      invalidateTokenCache();
      saveState();
      appendMessageToDOM(
        chat.messages[chat.messages.length - 1],
        chat.messages.length - 1,
      );
    }
  }

  currentAbortController = null;
  btn.textContent = "Send";
  saveState();
  updateTokenCount();
}
