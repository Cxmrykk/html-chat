// --- CONSTANTS & DEFAULTS ---
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

const SETTING_DEFAULTS = {
  godModePrompt: {
    default: DEFAULT_GOD_MODE_PROMPT,
    tooltip: "System prompt used when God Mode is enabled (execute JavaScript).",
    category: "LLM Behavior",
  },
  temperature: {
    default: "",
    tooltip: "Controls randomness (0.0 to 2.0).",
    category: "LLM Behavior",
  },
  top_p: {
    default: "",
    tooltip: "Nucleus sampling (0.0 to 1.0).",
    category: "LLM Behavior",
  },
  max_tokens: {
    default: "",
    tooltip: "Maximum number of tokens to generate.",
    category: "LLM Behavior",
  },
  frequency_penalty: {
    default: "",
    tooltip: "Penalizes new tokens based on existing frequency (-2.0 to 2.0).",
    category: "LLM Behavior",
  },
  presence_penalty: {
    default: "",
    tooltip: "Penalizes new tokens based on presence (-2.0 to 2.0).",
    category: "LLM Behavior",
  },
  streamResponse: {
    default: "true",
    tooltip: "Stream responses chunk-by-chunk (true/false).",
    category: "LLM Behavior",
  },
  embeddingsUrl: {
    default: "",
    tooltip: "Custom base URL for embeddings (e.g. LiteLLM or OpenAI).",
    category: "API & Connections",
  },
  embeddingsKey: {
    default: "",
    tooltip: "API Key for the custom embeddings URL.",
    category: "API & Connections",
  },
  embeddingsModel: {
    default: "",
    tooltip: "Model used for processing local RAG commands. Empty to disable.",
    category: "API & Connections",
  },
  chunkSize: {
    default: "1000",
    tooltip: "Character size for file chunking.",
    category: "RAG & Document Processing",
  },
  chunkOverlap: {
    default: "200",
    tooltip: "Character overlap to maintain document continuity.",
    category: "RAG & Document Processing",
  },
  maxRagTokens: {
    default: "5000",
    tooltip: "Maximum estimated tokens to retrieve per file message.",
    category: "RAG & Document Processing",
  },
  ragThreshold: {
    default: "0.0",
    tooltip: "Min similarity threshold (0.0 to 1.0). 0.0 allows anything.",
    category: "RAG & Document Processing",
  },
  chunkBatchSize: {
    default: "100",
    tooltip: "Max chunks sent to Embeddings API at once.",
    category: "RAG & Document Processing",
  },
  chunkSeparator: {
    default: "...",
    tooltip: "String used to separate non-contiguous chunks (allows \\n).",
    category: "RAG & Document Processing",
  },
  maxVisibleChats: {
    default: "",
    tooltip: "Maximum number of chats displayed at once in the sidebar.",
    category: "UI & Display",
  },
  maxVisibleFiles: {
    default: "",
    tooltip: "Maximum number of files displayed at once in the sidebar.",
    category: "UI & Display",
  },
};

const FILE_SETTING_DEFAULTS = {
  maxRagTokens: {
    default: "",
    tooltip: "Override global max RAG tokens for this file.",
    category: "Overrides",
  },
  ragThreshold: {
    default: "",
    tooltip: "Override global match threshold for this file. (0.0 to 1.0)",
    category: "Overrides",
  },
  chunkSeparator: {
    default: "",
    tooltip: "Override global chunk separator. Use \\n for newline.",
    category: "Overrides",
  },
  customChunks: {
    default: "",
    tooltip: "A JSON array of strings to bypass all chunking logic.",
    category: "Chunk Generation",
  },
  customChunker: {
    default: `const chunkSize = parseInt(config.chunkSize) || 1000;\nconst chunkOverlap = parseInt(config.chunkOverlap) || 200;\nconst chunks = [];\nlet start = 0;\nwhile (start < text.length) {\n  let end = start + chunkSize;\n  if (end > text.length) end = text.length;\n  chunks.push(text.substring(start, end));\n  if (end >= text.length) break;\n  start = end - chunkOverlap;\n}\nreturn chunks;`,
    tooltip:
      "JS function body (vars: `text`, `config`). Returns an array of string chunks.",
    category: "Chunk Generation",
  },
  captureFunc: {
    default: "",
    tooltip:
      "JS function body (vars: `chunk`). Returns an array of matched components.",
    category: "Post-Retrieval Processing",
  },
  retrievalFunc: {
    default: "",
    tooltip:
      "JS function body (vars: `matches`, `text`). Returns a contextual string retrieved from the original text (empty to omit).",
    category: "Post-Retrieval Processing",
  },
  dedupFunc: {
    default: "",
    tooltip:
      "JS function body (vars: `chunkA`, `chunkB`). Returns boolean true if duplicate.",
    category: "Post-Retrieval Processing",
  },
};
