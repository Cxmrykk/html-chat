import { state, invalidateTokenCache, saveState, $, DEFAULT_GOD_MODE_PROMPT } from './state.js';
import { newChat } from './files.js';
import { suspendSuperSecretSettings } from './settings.js';
import { appendMessageToDOM, updateMessageContentInDOM, renderCurrentChat, updateMessageInDOM } from './ui/render.js';
import { applyInputAreaState, updateTokenCount, renderChatList } from './ui/components.js';
import { resolveAllMessages } from './embeddings/rag.js';

export async function executeGodMode(code) {
  let logs = [];
  const safeStr = (obj) => {
    try { return typeof obj === "object" ? JSON.stringify(obj, null, 2) : String(obj); }
    catch { return Object.prototype.toString.call(obj); }
  };
  const proxyConsole = {
    log: (...args) => logs.push(args.map(safeStr).join(" ")),
    error: (...args) => logs.push("ERROR: " + args.map(safeStr).join(" ")),
  };
  let result, errorStr = "";
  try {
    const execFn = new (Object.getPrototypeOf(async function () {}).constructor)("console", code);
    result = await execFn(proxyConsole);
  } catch (err) { 
    errorStr = err.toString(); 
  }

  let out = "**Execution Result:**\n```text\n";
  if (logs.length) out += logs.join("\n") + "\n";
  if (result !== undefined) out += "Return: " + safeStr(result) + "\n";
  if (errorStr) out += "Error: " + errorStr + "\n";
  if (!logs.length && result === undefined && !errorStr) {
    out += "Code executed successfully with no output.\n";
  }
  return out + "```";
}

export async function sendMessage(autoLoopDepth = 0, skipApi = false) {
  const btn = $("#send-btn");
  const MAX_LOOPS = 5;

  if (autoLoopDepth >= MAX_LOOPS) {
    const chat = state.chats.find((c) => c.id === state.currentChatId);
    chat.messages.push({ role: "error", content: `**System Error:** Maximum execution loop depth (${MAX_LOOPS}) reached.` });
    invalidateTokenCache();
    saveState();
    appendMessageToDOM(chat.messages[chat.messages.length - 1], chat.messages.length - 1);
    return;
  }

  const isAutoLoop = autoLoopDepth > 0;
  if (state.currentAbortController && !isAutoLoop) {
    state.currentAbortController.abort();
    state.currentAbortController = null;
    btn.textContent = "Send";
    updateTokenCount();
    return;
  }

  const inputEl = $("#chat-input");
  let text = inputEl.value.trim();

  if (!isAutoLoop) {
    if (!text) return;
    if (!state.config.key && !skipApi) {
      alert("Please enter your API key in the settings first.");
      return;
    }

    if (!state.currentChatId) newChat();

    const chat = state.chats.find((c) => c.id === state.currentChatId);

    if (!chat.messages.length) {
      const lastDoubleNewline = text.lastIndexOf("\n\n");
      const titleSource = lastDoubleNewline !== -1 ? text.substring(lastDoubleNewline + 2).trim() : text;
      chat.title = titleSource.substring(0, 30) + (titleSource.length > 30 ? "..." : "");
      renderChatList();
    }

    chat.messages.push({ role: "user", content: text });
    inputEl.value = "";
    invalidateTokenCache();
    saveState();
    appendMessageToDOM(chat.messages[chat.messages.length - 1], chat.messages.length - 1);
    updateTokenCount();
  }

  if (skipApi) return;

  state.currentAbortController = new AbortController();
  btn.textContent = isAutoLoop ? `Thinking (Loop ${autoLoopDepth}/${MAX_LOOPS})...` : "Thinking...";

  try {
    const chat = state.chats.find((c) => c.id === state.currentChatId);
    let cleanMessages = chat.messages.filter((m) => m.role !== "error").map((m) => {
      if (m.role === "file") return { ...m };
      return { role: m.role, content: m.content || "" };
    });

    if (state.config.godMode) {
      cleanMessages.unshift({ role: "system", content: state.config.godModePrompt || DEFAULT_GOD_MODE_PROMPT });
    }

    cleanMessages = await resolveAllMessages(cleanMessages, btn);

    btn.textContent = isAutoLoop ? `Thinking (Loop ${autoLoopDepth}/${MAX_LOOPS})...` : "Thinking...";

    const isStream = state.config.streamResponse !== "false";
    const payload = { model: $("#model-select").value, messages: cleanMessages, stream: isStream };

    if (state.config.temperature !== "" && state.config.temperature !== undefined) payload.temperature = parseFloat(state.config.temperature);
    if (state.config.top_p !== "" && state.config.top_p !== undefined) payload.top_p = parseFloat(state.config.top_p);
    if (state.config.frequency_penalty !== "" && state.config.frequency_penalty !== undefined) payload.frequency_penalty = parseFloat(state.config.frequency_penalty);
    if (state.config.presence_penalty !== "" && state.config.presence_penalty !== undefined) payload.presence_penalty = parseFloat(state.config.presence_penalty);
    if (state.config.max_tokens !== "" && state.config.max_tokens !== undefined) payload.max_tokens = parseInt(state.config.max_tokens, 10);

    const response = await fetch(`${state.config.url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.config.key}` },
      body: JSON.stringify(payload),
      signal: state.currentAbortController.signal,
    });

    if (!response.ok) {
      throw new Error((await response.json().catch(() => ({}))).error?.message || `HTTP ${response.status}`);
    }

    btn.textContent = isAutoLoop ? `Generating (Loop ${autoLoopDepth}/${MAX_LOOPS})...` : "Generating...";

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
          if (now - lastRenderTime > 100) {
            updateMessageContentInDOM(msgIndex, reply, false);
            lastRenderTime = now;
          }
        }
      } catch (err) {
        if (err.name === "AbortError") {
          reply += "\n\n*[Stopped by user]*";
          chat.messages[msgIndex].content = reply;
        } else throw err;
      }

      chat.messages[msgIndex].content = reply;
      updateMessageContentInDOM(msgIndex, reply, true, "none");
    }

    saveState();

    if (state.config.godMode && reply) {
      const runMatches = [...reply.matchAll(/<run>([\s\S]*?)<\/run>/g)];
      if (runMatches.length > 0) {
        for (const match of runMatches) {
          const code = match[1].trim();
          const result = await executeGodMode(code);
          chat.messages.push({ role: "user", content: result });
          invalidateTokenCache();
          saveState();
          appendMessageToDOM(chat.messages[chat.messages.length - 1], chat.messages.length - 1);
        }
        return sendMessage(autoLoopDepth + 1);
      }
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      const chat = state.chats.find((c) => c.id === state.currentChatId);
      chat.messages.push({ role: "error", content: `**Error:**\n\n${error.message}` });
      invalidateTokenCache();
      saveState();
      appendMessageToDOM(chat.messages[chat.messages.length - 1], chat.messages.length - 1);
    }
  }

  state.currentAbortController = null;
  btn.textContent = "Send";
  saveState();
  updateTokenCount();
}

export function forkChat(msgIndex) {
  suspendSuperSecretSettings();
  resetEditState();
  const chat = state.chats.find((c) => c.id === state.currentChatId);
  const newId = Date.now().toString();
  state.chats.unshift({
    id: newId,
    title: chat.title + " (Forked)",
    messages: JSON.parse(JSON.stringify(chat.messages.slice(0, msgIndex + 1))),
  });
  state.currentChatId = newId;
  invalidateTokenCache();
  saveState();
  renderCurrentChat();
  renderChatList();
}

export function retryMessage(msgIndex) {
  resetEditState();
  const chat = state.chats.find((c) => c.id === state.currentChatId);
  const msg = chat.messages[msgIndex];

  if (msg.role === "file") {
    chat.messages = chat.messages.slice(0, msgIndex + 1);
  } else {
    $("#chat-input").value = msg.content;
    chat.messages = chat.messages.slice(0, msgIndex);
  }
  
  invalidateTokenCache();
  saveState();
  renderCurrentChat();
  sendMessage();
}

export function deleteMessage(msgIndex) {
  if (state.editingMessageIndex === msgIndex) cancelGlobalEdit();
  else if (state.editingMessageIndex !== null && state.editingMessageIndex > msgIndex) state.editingMessageIndex--;

  const chat = state.chats.find((c) => c.id === state.currentChatId);
  chat.messages.splice(msgIndex, 1);
  invalidateTokenCache();
  saveState();
  renderCurrentChat();
}

export function resetEditState() {
  state.editingMessageIndex = null;
  const area = $("#chat-input");
  if (!area) return;
  
  area.style.whiteSpace = "";
  area.style.overflowX = "";
  if (!state.isSuperSecretSettingsOpen && !state.isAdvancedRAGSettingsOpen) {
    area.value = "";
    area.style.height = state.promptHeight;
  }
}

export function startGlobalEdit(index) {
  const prevIdx = state.editingMessageIndex;
  state.editingMessageIndex = index;

  if (prevIdx !== null) updateMessageInDOM(prevIdx);
  updateMessageInDOM(index);

  const chat = state.chats.find((c) => c.id === state.currentChatId);
  const msg = chat.messages[index];
  const area = $("#chat-input");

  area.value = msg.role === "file" && msg.mode === "embed" ? msg.prompt || "" : msg.content;
  applyInputAreaState();
  area.focus();
}

export function saveGlobalEdit() {
  if (state.editingMessageIndex === null) return;
  const chat = state.chats.find((c) => c.id === state.currentChatId);
  const msg = chat.messages[state.editingMessageIndex];

  if (msg.role === "file") {
    if (msg.mode === "embed") {
      msg.prompt = $("#chat-input").value;
      const tEl = document.querySelector(`.msg[data-index="${state.editingMessageIndex}"] .embed-cfg-tokens`);
      if (tEl) msg.maxTokens = parseInt(tEl.value, 10) || 5000;
      const thEl = document.querySelector(`.msg[data-index="${state.editingMessageIndex}"] .embed-cfg-threshold`);
      if (thEl) msg.ragThreshold = parseFloat(thEl.value) || 0.0;
    } else {
      msg.content = $("#chat-input").value;
      msg.approxTokens = Math.ceil(msg.content.length / 4);
    }
  } else {
    msg.content = $("#chat-input").value;
  }

  invalidateTokenCache();
  saveState();
  endGlobalEdit();
}

export function cancelGlobalEdit() { endGlobalEdit(); }

export function endGlobalEdit() {
  const idx = state.editingMessageIndex;
  resetEditState();
  if (idx !== null) updateMessageInDOM(idx);
  applyInputAreaState();
}

export function toggleGlobalWrap() {
  const area = $("#chat-input");
  if (!area) return;
  area.style.whiteSpace = area.style.whiteSpace === "pre" ? "pre-wrap" : "pre";
  area.style.overflowX = area.style.whiteSpace === "pre" ? "auto" : "hidden";
}
