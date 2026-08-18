// ==========================================
// CONSTANTS & DEFAULTS
// ==========================================
export const DEFAULT_GOD_MODE_PROMPT = [
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
  "1. DO NOT CALCULATE MANUALLY. If the user asks a math, logic, or data question, you MUST use a <run> block to compute it.",
  '2. NO FAKE CODE, MOCKS, OR HARDCODING. Your JavaScript MUST contain actual logic, algorithms, math, or simulations. DO NOT write "simplified" checks.',
  "3. VANILLA JS LIMITATIONS. You are in a browser. You do not have Python's `itertools`, `numpy`, or `scipy`. If you need combinations or matrix operations, implement them yourself.",
  "4. STATE PERSISTENCE. Each <run> block executes in a fresh async scope. Variables declared with `let` or `const` will NOT persist. Use `window`.",
  "5. ITERATIVE PROBLEM SOLVING. Break down complex problems into multiple <run> blocks.",
  "6. DEFER YOUR ANSWER. If you output a <run> block, DO NOT attempt to answer the user's prompt in the same message.",
  "7. WAIT FOR THE RESULT. The system will execute your code and return the result. If your code throws an error, fix it and try again.",
  "8. DELIVER THE FINAL ANSWER ONLY AFTER EXECUTION.",
  "9. NEVER use Node.js modules (require, os, fs). They do not exist here.",
  "10. NEVER use markdown backticks (```) around the <run> tags.",
  "",
  "EXAMPLE WORKFLOW:",
  "User: What is the square root of 9999?",
  "Assistant: I need to compute this.",
  "<run>",
  "return Math.sqrt(9999);",
  "</run>",
  "User: **Execution Result:**...",
  "Assistant: The square root is...",
].join("\n");

export const SETTING_DEFAULTS = {
  godModePrompt: { default: DEFAULT_GOD_MODE_PROMPT, tooltip: "System prompt used when God Mode is enabled.", category: "LLM Behavior" },
  temperature: { default: "", tooltip: "Controls randomness (0.0 to 2.0).", category: "LLM Behavior" },
  top_p: { default: "", tooltip: "Nucleus sampling (0.0 to 1.0).", category: "LLM Behavior" },
  max_tokens: { default: "", tooltip: "Maximum number of tokens to generate.", category: "LLM Behavior" },
  frequency_penalty: { default: "", tooltip: "Penalizes new tokens based on existing frequency (-2.0 to 2.0).", category: "LLM Behavior" },
  presence_penalty: { default: "", tooltip: "Penalizes new tokens based on presence (-2.0 to 2.0).", category: "LLM Behavior" },
  streamResponse: { default: "true", tooltip: "Stream responses chunk-by-chunk (true/false).", category: "LLM Behavior" },
  embeddingsUrl: { default: "", tooltip: "Custom base URL for embeddings.", category: "API & Connections" },
  embeddingsKey: { default: "", tooltip: "API Key for the custom embeddings URL.", category: "API & Connections" },
  embeddingsModel: { default: "", tooltip: "Model used for processing local RAG commands. Empty to disable.", category: "API & Connections" },
  fileWrapperFunc: {
    default: `const extMatch = (fileName || "").match(/\\.([^.]+)$/);\nconst ext = extMatch ? extMatch[1] : "txt";\nconst blockTicks = (fileContent || "").includes("\`\`\`") ? "\`\`\`\`" : "\`\`\`";\nreturn \`\\\`\${fileName}\\\`:\\n\\n\${blockTicks}\${ext}\\n\${fileContent}\\n\${blockTicks}\`;`,
    tooltip: "JS Function [Vars: fileContent, fileName]: Wrap the final file content/chunks before inserting into the prompt.",
    category: "RAG & Document Processing",
  },
  maxRagTokens: { default: "5000", tooltip: "Maximum estimated tokens to retrieve per file message.", category: "RAG & Document Processing" },
  ragThreshold: { default: "0.0", tooltip: "Min similarity threshold (0.0 to 1.0). 0.0 allows anything.", category: "RAG & Document Processing" },
  chunkMaxTokens: { default: "1024", tooltip: "Maximum tokens allowed per single chunk.", category: "RAG & Document Processing" },
  chunkBatchSize: { default: "100", tooltip: "Max chunks sent to Embeddings API at once.", category: "RAG & Document Processing" },
  chunkBatchMaxTokens: { default: "8192", tooltip: "Max estimated tokens sent to Embeddings API per batch.", category: "RAG & Document Processing" },
  maxVisibleChats: { default: "", tooltip: "Maximum number of chats displayed at once in the sidebar.", category: "UI & Display" },
  maxVisibleFiles: { default: "", tooltip: "Maximum number of files displayed at once in the sidebar.", category: "UI & Display" },
};

export const FILE_SETTING_DEFAULTS = {
  fileText: { default: "", tooltip: "The full textual content of the file. Edit and save to update.", category: "Overrides" },
  fileWrapperFunc: { default: "", tooltip: "Override global File Wrapper Function for this file. [Vars: fileContent, fileName]", category: "Overrides" },
  maxRagTokens: { default: "", tooltip: "Override global max RAG tokens for this file.", category: "Overrides" },
  ragThreshold: { default: "", tooltip: "Override global match threshold for this file. (0.0 to 1.0)", category: "Overrides" },
  chunkMaxTokens: { default: "", tooltip: "Override global max tokens per chunk for this file.", category: "Overrides" },
  customChunks: { default: "", tooltip: "A JSON array to bypass all chunking logic.", category: "Chunk Generation" },
  customChunker: {
    default: `// Variables: 'fileContents' (full file string)\nconst chunkSize = 1000;\nconst chunkOverlap = 200;\nconst chunks = [];\nlet start = 0;\nwhile (start < fileContents.length) {\n  let end = start + chunkSize;\n  if (end > fileContents.length) end = fileContents.length;\n  chunks.push(fileContents.substring(start, end));\n  if (end >= fileContents.length) break;\n  start = end - chunkOverlap;\n}\nreturn chunks;`,
    tooltip: "JS Function [Vars: fileContents]: Create an array of chunks (strings or objects). Default splits by 1000 chars with a 200 char overlap.",
    category: "Chunk Generation",
  },
  retrievalFunc: { default: `return chunk;`, tooltip: "JS Function [Vars: chunk, fileContents]: Step 1. Process or expand context.", category: "Post-Retrieval Processing" },
  dedupFunc: { default: `return currentData === existingData;`, tooltip: "JS Function [Vars: currentData, existingData]: Step 2. Dup check.", category: "Post-Retrieval Processing" },
  mergeChunksFunc: { default: `return finalChunks.map(c => typeof c === 'string' ? c : JSON.stringify(c)).join("...");`, tooltip: "JS Function [Vars: finalChunks]: Step 3. Combine.", category: "Post-Retrieval Processing" },
};

// ==========================================
// STATE & DB
// ==========================================
export const DB_NAME = "HTMLChatDB";
export const STORE_NAME = "keyval";

export const state = {
  config: {},
  chats: [],
  files: [],
  currentChatId: null,
  currentAbortController: null,
  embeddingAbortControllers: {},
  isSidebarHidden: false,
  isTitleHidden: false,
  editingMessageIndex: null,
  promptHeight: "",
  isSuperSecretSettingsOpen: false,
  activeSuperSecretSetting: null,
  uncommittedSuperSecretValue: null,
  isAdvancedRAGSettingsOpen: false,
  activeAdvancedRAGFileId: null,
  activeAdvancedRAGSetting: null,
  uncommittedAdvancedRAGValue: null,
  cachedContextChars: -1
};

export function getDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME);
    };
  });
}

export async function dbGet(key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function dbSet(key, val) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(val, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function dbDelete(key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function dbGetByPrefix(prefix) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const range = IDBKeyRange.bound(prefix, prefix + "\uffff");
    const request = store.openCursor(range);
    const results = [];
    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function dbDeleteByPrefix(prefix) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const range = IDBKeyRange.bound(prefix, prefix + "\uffff");
    const request = store.delete(range);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function dbSetMultiple(entries) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    for (const [key, val] of entries) store.put(val, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export function invalidateTokenCache() {
  state.cachedContextChars = -1;
}

export async function saveState() {
  dbSet("mf_config", state.config);
  dbSet("mf_current_chat_id", state.currentChatId || "");
  dbSet("mf_sidebar_hidden", state.isSidebarHidden);
  dbSet("mf_title_hidden", state.isTitleHidden);
  dbSet("mf_prompt_height", state.promptHeight);
  dbSet("mf_files", state.files);
  const index = state.chats.map((c) => ({ id: c.id, title: c.title }));
  dbSet("mf_chat_index", index);
  if (state.currentChatId) {
    const current = state.chats.find((c) => c.id === state.currentChatId);
    if (current) dbSet(`mf_chat_${state.currentChatId}`, current);
  }
}

export async function saveAllChats() {
  const index = state.chats.map((c) => ({ id: c.id, title: c.title }));
  dbSet("mf_chat_index", index);
  for (let c of state.chats) await dbSet(`mf_chat_${c.id}`, c);
}

// ==========================================
// UTILITIES
// ==========================================
export const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export const $ = (s) => document.querySelector(s);

export const escapeHTML = (str) => {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

export function pickFiles(multiple = true) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.addEventListener("change", (e) => resolve(Array.from(e.target.files)));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file);
  });
}

export function cosSim(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function encodeVectorToBase64(vector) {
  if (!vector || !vector.length) return null;
  const f32 = new Float32Array(vector);
  const u8 = new Uint8Array(f32.buffer);
  let binary = "";
  for (let i = 0; i < u8.byteLength; i++) {
    binary += String.fromCharCode(u8[i]);
  }
  return btoa(binary);
}

export function decodeBase64ToVector(base64) {
  if (!base64) return null;
  const binary = atob(base64);
  const u8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    u8[i] = binary.charCodeAt(i);
  }
  return new Float32Array(u8.buffer);
}
