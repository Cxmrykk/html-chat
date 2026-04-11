// --- UTILS & STATE ---
const $ = (s) => document.querySelector(s);
const escapeHTML = (str) =>
  (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const DEFAULT_GOD_MODE_PROMPT = [
  "[SYSTEM OVERRIDE: CODE EXECUTION ENABLED]",
  "You are executing directly inside the user's web browser (JS console). You are NOT in a sandboxed cloud environment. You are NOT in Node.js or Python. You have full, unrestricted access to the user's 'window', 'document', 'navigator', 'localStorage', etc.",
  "",
  "However, to execute code, you MUST use this exact syntax (the return value is sent back to you):",
  "<run>",
  "// browser-side JS goes here",
  "return data.toString();",
  "</run>",
  "",
  "CRITICAL RULES FOR TOOL USE:",
  "1. DO NOT CALCULATE MANUALLY. If the user asks a math, logic, or data question, you MUST use a <run> block to compute it. Do not trust your own internal math.",
  '2. NO FAKE CODE, MOCKS, OR HARDCODING. Your JavaScript MUST contain actual logic, algorithms, math, or simulations. DO NOT write "simplified" checks or hardcode the answer you already suspect. If you need to search for a counterexample, write a GENUINE exhaustive search. The code itself must do the actual work to prove the answer.',
  "3. VANILLA JS LIMITATIONS. You are in a browser. You do not have Python's `itertools`, `numpy`, or `scipy`. If you need combinations, permutations, matrix operations, or deep equality checks, you MUST implement them yourself.",
  "4. STATE PERSISTENCE. Each <run> block executes in a fresh async function scope. Variables declared with `let` or `const` will NOT persist between runs. To save state across multiple runs, attach it to the global `window` object (e.g., `window.myState = ...`).",
  "5. ITERATIVE PROBLEM SOLVING. If a problem is too complex for one script, break it down. Write a <run> block to generate data, save it to `window`, and then write a second <run> block to process it. ",
  "6. DEFER YOUR ANSWER. If you output a <run> block, DO NOT attempt to answer the user's prompt in the same message. Output ONLY your thought process and the <run> block.",
  "7. WAIT FOR THE RESULT. The system will execute your code and return the result in the next message. If your code throws an error, DO NOT apologize—just write another <run> block to fix it and try again.",
  "8. DELIVER THE FINAL ANSWER ONLY AFTER EXECUTION. Unless an error is spotted, once you have the results write your final response to the user and DO NOT include any <run> tags.",
  "9. NEVER use Node.js modules (require, os, fs). They do not exist here.",
  "10. NEVER use markdown backticks (```) around the <run> tags. Just output the raw tags.",
  "",
  "EXAMPLE WORKFLOW:",
  "User: What is the square root of 9999?",
  "Assistant: I need to compute this using JavaScript.",
  "<run>",
  "return Math.sqrt(9999);",
  "</run>",
  "User: **Execution Result:**",
  "```text",
  "Return: 99.99499987499375",
  "```",
  "Assistant: The square root of 9999 is 99.994999875.",
].join("\n");

// --- INDEXEDDB WRAPPER ---
const DB_NAME = "HTMLChatDB";
const STORE_NAME = "keyval";

function getDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME);
    };
  });
}

async function dbGet(key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbSet(key, val) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(val, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function dbDelete(key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Global state variables
let config = {};
let chats = [];
let files = [];
let currentChatId = null;
let currentAbortController = null;
let isSidebarHidden = false;
let isTitleHidden = false;
let editingMessageIndex = null;
let promptHeight = "";
let editHeight = "250px";

// Super Secret Settings State
let isSuperSecretSettingsOpen = false;
let activeSuperSecretSetting = null;
let uncommittedSuperSecretValue = null;

const SETTING_DEFAULTS = {
  godModePrompt: {
    default: DEFAULT_GOD_MODE_PROMPT,
    tooltip: "Enter the system prompt used when God Mode is enabled.",
  },
  temperature: {
    default: "",
    tooltip: "Controls randomness (0.0 to 2.0). Leave empty for API default.",
  },
  top_p: {
    default: "",
    tooltip: "Nucleus sampling (0.0 to 1.0). Leave empty for API default.",
  },
  max_tokens: {
    default: "",
    tooltip:
      "Maximum number of tokens to generate. Leave empty for API default.",
  },
  frequency_penalty: {
    default: "",
    tooltip: "Penalizes new tokens (-2.0 to 2.0). Leave empty for API default.",
  },
  presence_penalty: {
    default: "",
    tooltip: "Penalizes new tokens (-2.0 to 2.0). Leave empty for API default.",
  },
  embeddingsUrl: {
    default: "",
    tooltip:
      "Custom base URL for embeddings (e.g., http://localhost:11434/v1). Leave empty to use main API URL.",
  },
  embeddingsKey: {
    default: "",
    tooltip:
      "API Key for the custom embeddings URL. Leave empty to use main API key.",
  },
  embeddingsModel: {
    default: "",
    tooltip:
      "Model used for processing local RAG commands. Leave empty to disable embeddings.",
  },
  chunkSize: {
    default: "1000",
    tooltip: "Character size for file chunking.",
  },
  chunkOverlap: {
    default: "200",
    tooltip: "Character overlap to maintain document continuity.",
  },
  maxRagTokens: {
    default: "5000",
    tooltip: "Maximum estimated tokens to retrieve per file message.",
  },
  ragThreshold: {
    default: "0.0",
    tooltip:
      "Minimum similarity threshold (0.0 to 1.0) for context injection. 0.0 allows anything.",
  },
  chunkBatchSize: {
    default: "100",
    tooltip:
      "Max chunks sent to Embeddings API at once. Lower this if you get batch size errors.",
  },
  chunkSeparator: {
    default: "...",
    tooltip:
      "String used to separate non-contiguous chunks in RAG. Allows special characters like \\n.",
  },
};

marked.use({
  extensions: [
    {
      name: "math",
      level: "inline",
      start(src) {
        return src.match(/\$/)?.index;
      },
      tokenizer(src) {
        const blockMatch = /^\$\$([\s\S]+?)\$\$/.exec(src);
        if (blockMatch)
          return { type: "math", raw: blockMatch[0], text: blockMatch[1] };
        const inlineMatch = /^\$([^\s$](?:\\.|[^$\n])*?)\$/.exec(src);
        if (inlineMatch)
          return { type: "math", raw: inlineMatch[0], text: inlineMatch[1] };
      },
      renderer(token) {
        return escapeHTML(token.raw);
      },
    },
  ],
});

function saveState() {
  dbSet("mf_config", config);
  dbSet("mf_chats", chats);
  dbSet("mf_files", files);
  dbSet("mf_current_chat_id", currentChatId || "");
  dbSet("mf_sidebar_hidden", isSidebarHidden);
  dbSet("mf_title_hidden", isTitleHidden);
  dbSet("mf_prompt_height", promptHeight);
  dbSet("mf_edit_height", editHeight);
}

// --- INITIALIZATION ---
async function init() {
  config = (await dbGet("mf_config")) || {
    url: "https://api.openai.com/v1",
    key: "",
    models: "gpt-4o, gpt-4-turbo, gpt-3.5-turbo",
    godMode: false,
    lastModel: "",
  };

  for (const key in SETTING_DEFAULTS) {
    if (config[key] === undefined) {
      config[key] = SETTING_DEFAULTS[key].default;
    }
  }

  chats = (await dbGet("mf_chats")) || [];
  files = (await dbGet("mf_files")) || [];
  currentChatId = (await dbGet("mf_current_chat_id")) || null;
  isSidebarHidden = (await dbGet("mf_sidebar_hidden")) === true;
  isTitleHidden = (await dbGet("mf_title_hidden")) === true;
  promptHeight = (await dbGet("mf_prompt_height")) || "";
  editHeight = (await dbGet("mf_edit_height")) || "250px";

  // UI Setup
  $("#cfg-url").value = config.url;
  $("#cfg-key").value = config.key;
  $("#cfg-models").value = config.models;
  $("#cfg-godmode").checked = config.godMode || false;

  updateModelDropdown();
  applySidebarState();
  applyTitleState();

  $("#chat-input").style.height = promptHeight;
  $("#chat-input").addEventListener("input", updateTokenCount);

  const textareaObserver = new ResizeObserver((entries) => {
    for (let entry of entries) {
      const h = entry.target.style.height;
      if (!h) continue;
      if (editingMessageIndex !== null) {
        editHeight = h;
      } else {
        promptHeight = h;
      }
      saveState();
    }
  });
  textareaObserver.observe($("#chat-input"));

  chats.sort((a, b) => Number(b.id) - Number(a.id));

  if (!currentChatId && chats.length > 0) currentChatId = chats[0].id;

  // Auto-resume paused embedding loops on boot
  for (const f of files) {
    if (f.isEmbedding && f.progress < 100) {
      startEmbeddingLoop(f.id);
    } else if (f.progress >= 100) {
      f.isEmbedding = false;
    }
  }

  renderApp();
}

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
        if (m.role === "file") return acc + (m.approxTokens || 0) * 4;
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

function toggleSidebar() {
  isSidebarHidden = !isSidebarHidden;
  saveState();
  applySidebarState();
}
function applySidebarState() {
  $("#sidebar").classList.toggle("hidden", isSidebarHidden);
  $("#toggle-sidebar-btn").textContent = isSidebarHidden
    ? "[show sidebar]"
    : "[hide sidebar]";
}

function toggleTitle() {
  isTitleHidden = !isTitleHidden;
  saveState();
  applyTitleState();
}
function applyTitleState() {
  $("#header").classList.toggle("hidden", isTitleHidden);
  $("#toggle-title-btn").textContent = isTitleHidden
    ? "[show title]"
    : "[hide title]";
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

function saveConfig() {
  const oldRAG =
    config.embeddingsModel + config.chunkSize + config.chunkOverlap;

  config = {
    ...config,
    url: $("#cfg-url").value.trim(),
    key: $("#cfg-key").value.trim(),
    models: $("#cfg-models").value.trim(),
    godMode: $("#cfg-godmode").checked,
  };

  const newRAG =
    config.embeddingsModel + config.chunkSize + config.chunkOverlap;
  if (oldRAG !== newRAG) {
    resetAllFileEmbeddings();
  }

  saveState();
  updateModelDropdown();
  renderApp(true);
  updateTokenCount();
  alert("Settings saved, don't fuck them up.");
}

function updateModelDropdown() {
  const select = $("#model-select");
  const models = config.models
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  select.innerHTML = models
    .map((m) => `<option value="${m}">${m}</option>`)
    .join("");
  if (config.lastModel && models.includes(config.lastModel))
    select.value = config.lastModel;
  else if (models.length > 0) {
    config.lastModel = models[0];
    saveState();
  }
}
function saveLastModel() {
  config.lastModel = $("#model-select").value;
  saveState();
}

// --- SUPER SECRET SETTINGS ACTIONS ---
function selectSuperSecretSetting(key) {
  activeSuperSecretSetting = key;
  uncommittedSuperSecretValue = null;
  const area = $("#chat-input");
  area.value =
    config[key] !== undefined && config[key] !== ""
      ? config[key]
      : SETTING_DEFAULTS[key].default;
  renderApp(true);
  area.focus();
}

function saveSuperSecretSetting() {
  if (!activeSuperSecretSetting) return;
  let val = $("#chat-input").value;
  const key = activeSuperSecretSetting;
  const oldRAG =
    config.embeddingsModel + config.chunkSize + config.chunkOverlap;

  if (
    key === "godModePrompt" ||
    key === "embeddingsModel" ||
    key === "embeddingsUrl" ||
    key === "embeddingsKey" ||
    key === "chunkSeparator"
  ) {
    config[key] = val;
  } else {
    if (val.trim() === "") {
      config[key] = "";
    } else {
      const parsed = parseFloat(val);
      config[key] = isNaN(parsed) ? "" : parsed;
    }
  }

  const newRAG =
    config.embeddingsModel + config.chunkSize + config.chunkOverlap;
  if (oldRAG !== newRAG) {
    resetAllFileEmbeddings();
  }

  saveState();
  activeSuperSecretSetting = null;
  uncommittedSuperSecretValue = null;
  renderApp(true);
  updateTokenCount();
}

function resetSuperSecretSetting() {
  if (!activeSuperSecretSetting) return;
  const key = activeSuperSecretSetting;
  const oldRAG =
    config.embeddingsModel + config.chunkSize + config.chunkOverlap;
  config[key] = SETTING_DEFAULTS[key].default;

  const newRAG =
    config.embeddingsModel + config.chunkSize + config.chunkOverlap;
  if (oldRAG !== newRAG) {
    resetAllFileEmbeddings();
  }

  saveState();
  activeSuperSecretSetting = null;
  uncommittedSuperSecretValue = null;
  renderApp(true);
  updateTokenCount();
}

function cancelSuperSecretSetting() {
  activeSuperSecretSetting = null;
  uncommittedSuperSecretValue = null;
  renderApp(true);
}

function resetAllSuperSecretSettings() {
  if (confirm("Reset ALL Advanced parameters to default?")) {
    const oldRAG =
      config.embeddingsModel + config.chunkSize + config.chunkOverlap;

    for (let key in SETTING_DEFAULTS) {
      config[key] = SETTING_DEFAULTS[key].default;
    }

    const newRAG =
      config.embeddingsModel + config.chunkSize + config.chunkOverlap;
    if (oldRAG !== newRAG) resetAllFileEmbeddings();

    saveState();
    if (activeSuperSecretSetting) {
      uncommittedSuperSecretValue = null;
      $("#chat-input").value =
        config[activeSuperSecretSetting] !== undefined
          ? config[activeSuperSecretSetting]
          : SETTING_DEFAULTS[activeSuperSecretSetting].default;
    }
    renderApp(true);
    updateTokenCount();
  }
}

init();
