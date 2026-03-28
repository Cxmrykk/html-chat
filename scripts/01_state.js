// --- UTILS & STATE ---
const $ = (s) => document.querySelector(s);
const escapeHTML = (str) =>
  (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const GOD_MODE_PROMPT = `[SYSTEM OVERRIDE: CODE EXECUTION ENABLED]
You are executing directly inside the user's web browser (JS console). You are NOT in a sandboxed cloud environment. You are NOT in Node.js or Python. You have full, unrestricted access to the user's 'window', 'document', 'navigator', 'localStorage', etc.

However, to execute code, you MUST use this exact syntax (the return value is sent back to you):
<run>
// browser-side JS goes here
return data.toString();
</run>

CRITICAL RULES FOR TOOL USE:
1. DO NOT CALCULATE MANUALLY. If the user asks a math, logic, or data question, you MUST use a <run> block to compute it. Do not trust your own internal math.
2. NO FAKE CODE, MOCKS, OR HARDCODING. Your JavaScript MUST contain actual logic, algorithms, math, or simulations. DO NOT write "simplified" checks or hardcode the answer you already suspect. If you need to search for a counterexample, write a GENUINE exhaustive search. The code itself must do the actual work to prove the answer.
3. VANILLA JS LIMITATIONS. You are in a browser. You do not have Python's \`itertools\`, \`numpy\`, or \`scipy\`. If you need combinations, permutations, matrix operations, or deep equality checks, you MUST implement them yourself.
4. STATE PERSISTENCE. Each <run> block executes in a fresh async function scope. Variables declared with \`let\` or \`const\` will NOT persist between runs. To save state across multiple runs, attach it to the global \`window\` object (e.g., \`window.myState = ...\`).
5. ITERATIVE PROBLEM SOLVING. If a problem is too complex for one script, break it down. Write a <run> block to generate data, save it to \`window\`, and then write a second <run> block to process it. 
6. DEFER YOUR ANSWER. If you output a <run> block, DO NOT attempt to answer the user's prompt in the same message. Output ONLY your thought process and the <run> block.
7. WAIT FOR THE RESULT. The system will execute your code and return the result in the next message. If your code throws an error, DO NOT apologize—just write another <run> block to fix it and try again.
8. DELIVER THE FINAL ANSWER ONLY AFTER EXECUTION. Unless an error is spotted, once you have the results write your final response to the user and DO NOT include any <run> tags.
9. NEVER use Node.js modules (require, os, fs). They do not exist here.
10. NEVER use markdown backticks (\`\`\`) around the <run> tags. Just output the raw tags.

EXAMPLE WORKFLOW:
User: What is the square root of 9999?
Assistant: I need to compute this using JavaScript.
<run>
return Math.sqrt(9999);
</run>
User: **Execution Result:**
\`\`\`text
Return: 99.99499987499375
\`\`\`
Assistant: The square root of 9999 is 99.994999875.`;

let config = JSON.parse(localStorage.getItem("mf_config")) || {
  url: "https://api.openai.com/v1",
  key: "",
  models: "gpt-4o, gpt-4-turbo, gpt-3.5-turbo",
  godMode: false,
  lastModel: "",
};
let chats = JSON.parse(localStorage.getItem("mf_chats")) || [];
let currentChatId = localStorage.getItem("mf_current_chat_id") || null;
let currentAbortController = null;
let isSidebarHidden =
  localStorage.getItem("mf_sidebar_hidden") === "true" ||
  localStorage.getItem("mf_locked_in") === "true";
let isTitleHidden = localStorage.getItem("mf_title_hidden") === "true";
let editingMessageIndex = null;

let promptHeight = localStorage.getItem("mf_prompt_height") || "";
let editHeight = localStorage.getItem("mf_edit_height") || "250px";

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
  localStorage.setItem("mf_config", JSON.stringify(config));
  localStorage.setItem("mf_chats", JSON.stringify(chats));
  localStorage.setItem("mf_current_chat_id", currentChatId || "");
  localStorage.setItem("mf_sidebar_hidden", isSidebarHidden);
  localStorage.setItem("mf_title_hidden", isTitleHidden);
}

// --- INITIALIZATION ---
function init() {
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
        localStorage.setItem("mf_edit_height", h);
      } else {
        promptHeight = h;
        localStorage.setItem("mf_prompt_height", h);
      }
    }
  });
  textareaObserver.observe($("#chat-input"));

  // Enforce sorting by date (newest first) based on Unix epoch ID
  chats.sort((a, b) => Number(b.id) - Number(a.id));

  if (!currentChatId && chats.length > 0) currentChatId = chats[0].id;
  renderApp();
}

function updateTokenCount() {
  const btn = $("#send-btn");
  if (!btn) return;

  // Don't overwrite state indicators
  if (btn.textContent.includes("Thinking") || btn.classList.contains("hidden"))
    return;

  const inputVal = $("#chat-input").value || "";
  let context = "";

  // Calculate context from the active chat data
  if (currentChatId) {
    const chat = chats.find((c) => c.id === currentChatId);
    if (chat && chat.messages) {
      context = chat.messages.map((m) => m.content).join(" ");
    }
  }

  if (config.godMode) {
    context += " " + GOD_MODE_PROMPT;
  }

  // Napkin math: 1 token ~= 4 chars
  const totalChars = inputVal.length + context.length;
  const tokens = Math.ceil(totalChars / 4);

  // Logic: Hide if < 1k. Show k/M if > 1k. Remove .0
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

function saveConfig() {
  config = {
    ...config,
    url: $("#cfg-url").value.trim(),
    key: $("#cfg-key").value.trim(),
    models: $("#cfg-models").value.trim(),
    godMode: $("#cfg-godmode").checked,
  };
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
