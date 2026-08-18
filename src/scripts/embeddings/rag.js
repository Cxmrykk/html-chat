import { state, dbGet, dbDeleteByPrefix, dbSetMultiple, dbSet, saveState, invalidateTokenCache, FILE_SETTING_DEFAULTS, SETTING_DEFAULTS, AsyncFunction, cosSim, encodeVectorToBase64, decodeBase64ToVector } from '../state.js';
import { getFileChunks, refreshFileChunks, fetchEmbeddings } from './core.js';
import { renderApp, appendMessageToDOM } from '../ui/render.js';
import { updateTokenCount } from '../ui/components.js';
import { selectAdvancedRAGSetting } from '../files.js';

export async function attemptChunking() {
  if (!state.activeAdvancedRAGFileId) return;
  const meta = state.files.find((f) => f.id === state.activeAdvancedRAGFileId);
  const data = await dbGet(`mf_filedata_${state.activeAdvancedRAGFileId}`);
  if (!meta || !data) return;

  const text = data.text || "";
  let chunks = [];

  const chunkerCode = meta.customChunker && meta.customChunker.trim() !== ""
      ? meta.customChunker : FILE_SETTING_DEFAULTS.customChunker.default;

  try {
    const fn = new AsyncFunction("fileContents", "config", chunkerCode);
    const res = await fn(text, state.config);
    if (Array.isArray(res)) {
      chunks = res.filter((c) => c !== null && c !== undefined);
    }
  } catch (e) {
    alert("Error executing customChunker: " + e.message);
    return;
  }

  meta.customChunks = JSON.stringify(chunks, null, 2);
  saveState();
  await refreshFileChunks(meta.id);

  if (state.activeAdvancedRAGSetting === "customChunks") {
    selectAdvancedRAGSetting("customChunks");
  } else {
    renderApp(true);
  }
}

export async function resolveAllMessages(messages, btnEl) {
  let resolved = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "file") {
      const meta = state.files.find((f) => f.id === msg.fileId);
      const mode = msg.mode || "embed";
      if (mode === "full") {
        let fileContent = msg.content;
        if (!fileContent && meta) {
          const data = await dbGet(`mf_filedata_${meta.id}`);
          if (data) {
            let wrapperFnCode = meta.fileWrapperFunc && meta.fileWrapperFunc.trim() !== ""
                ? meta.fileWrapperFunc : state.config.fileWrapperFunc && state.config.fileWrapperFunc.trim() !== ""
                  ? state.config.fileWrapperFunc : SETTING_DEFAULTS.fileWrapperFunc.default;
            let wrapperFn;
            try { 
              wrapperFn = new AsyncFunction("fileContent", "fileName", wrapperFnCode); 
            } catch (e) { 
              wrapperFn = async (c, n) => `\`${n}\`:\n\n\`\`\`\n${c}\n\`\`\``; 
            }
            fileContent = await wrapperFn(data.text, meta.name);
          }
        }
        resolved.push({ role: "user", content: fileContent || "*File not found.*" });
      }
    } else {
      resolved.push(msg);
    }
  }
  return resolved;
}

export async function executeEmbedMessage(msgIndex) {
  const chat = state.chats.find((c) => c.id === state.currentChatId);
  const msg = chat.messages[msgIndex];
  if (!msg || msg.role !== "file" || msg.mode !== "embed") return;

  const meta = state.files.find((f) => f.id === msg.fileId);
  let fileContent = "*File not found.*";

  const btnEl = document.querySelector(`.msg[data-index="${msgIndex}"] button[data-action="run-embed"]`);
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
          if (nextMsg.role === "user" && nextMsg.content) lookaheadText.push(nextMsg.content);
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
            alert("Error fetching embeddings: " + err.message);
            return;
          }
        }

        const fileMaxTokens = meta.maxRagTokens !== undefined && meta.maxRagTokens !== "" ? parseInt(meta.maxRagTokens, 10) : undefined;
        const maxTokens = fileMaxTokens !== undefined && !isNaN(fileMaxTokens) ? fileMaxTokens : msg.maxTokens || 5000;
        const fileThreshold = meta.ragThreshold !== undefined && meta.ragThreshold !== "" ? parseFloat(meta.ragThreshold) : undefined;
        const threshold = fileThreshold !== undefined && !isNaN(fileThreshold) ? fileThreshold : msg.ragThreshold || 0.0;

        for (let i = 0; i < validChunks.length; i++) {
          const c = validChunks[i];
          c.score = queryEmb ? cosSim(queryEmb, c.vector) : -c.index;
          if (i % 500 === 0) await new Promise((r) => setTimeout(r, 0));
        }

        let topChunks = validChunks.filter((c) => !queryEmb || c.score >= threshold);
        topChunks.sort((a, b) => b.score - a.score);

        let currentTokens = 0;
        let finalChunksInternal = [];

        let retrievalFnCode = meta.retrievalFunc && meta.retrievalFunc.trim() !== "" ? meta.retrievalFunc : FILE_SETTING_DEFAULTS.retrievalFunc.default;
        let dedupFnCode = meta.dedupFunc && meta.dedupFunc.trim() !== "" ? meta.dedupFunc : FILE_SETTING_DEFAULTS.dedupFunc.default;
        let mergeFnCode = meta.mergeChunksFunc && meta.mergeChunksFunc.trim() !== "" ? meta.mergeChunksFunc : FILE_SETTING_DEFAULTS.mergeChunksFunc.default;

        let retrievalFn = async (c, t) => c;
        let dedupFn = async (a, b) => a === b;
        let mergeFn = async (c) => c.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("...");
        
        try { retrievalFn = new AsyncFunction("chunk", "fileContents", retrievalFnCode); } catch (e) { console.error("Retrieval Fn Syntax Error:", e); }
        try { dedupFn = new AsyncFunction("currentData", "existingData", dedupFnCode); } catch (e) { console.error("Dedup Fn Syntax Error:", e); }
        try { mergeFn = new AsyncFunction("finalChunks", mergeFnCode); } catch (e) { console.error("Merge Fn Syntax Error:", e); }

        for (let j = 0; j < topChunks.length; j++) {
          const curr = topChunks[j];
          let finalData = null;
          try {
            const chunkArg = curr.raw !== undefined ? curr.raw : curr.text;
            const retrievedData = await retrievalFn(chunkArg, data.text);
            if (retrievedData !== null && retrievedData !== undefined) finalData = retrievedData;
          } catch (e) { 
            finalData = curr.raw !== undefined ? curr.raw : curr.text; 
          }

          if (finalData !== null && finalData !== undefined) {
            let isDup = false;
            try {
              for (const d of finalChunksInternal) {
                if (await dedupFn(finalData, d.data)) { isDup = true; break; }
              }
            } catch (e) { 
              console.error("Deduplication error:", e); 
            }

            if (!isDup) {
              const strForTokens = typeof finalData === "string" ? finalData : JSON.stringify(finalData) || "";
              const chunkTokens = Math.ceil(strForTokens.length / 4);
              if (finalChunksInternal.length > 0 && currentTokens + chunkTokens > maxTokens) break;
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
          fileContent = finalChunks.map((c) => (typeof c === "string" ? c : JSON.stringify(c))).join("..."); 
        }
      } else {
        fileContent = "*File unindexed or no valid chunks.*";
      }
    }
  }

  let wrapperFnCode = meta && meta.fileWrapperFunc && meta.fileWrapperFunc.trim() !== "" ? meta.fileWrapperFunc : state.config.fileWrapperFunc && state.config.fileWrapperFunc.trim() !== "" ? state.config.fileWrapperFunc : SETTING_DEFAULTS.fileWrapperFunc.default;
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
  appendMessageToDOM(chat.messages[chat.messages.length - 1], chat.messages.length - 1);
  updateTokenCount();
}

export async function exportChunksAndVectors() {
  if (!state.activeAdvancedRAGFileId) return;
  const chunks = await getFileChunks(state.activeAdvancedRAGFileId);
  if (!chunks || chunks.length === 0) {
    alert("No chunks found.");
    return;
  }

  const payload = {
    model: state.config.embeddingsModel,
    chunks: chunks.map((c) => ({
      text: c.text,
      raw: c.raw !== undefined ? c.raw : c.text,
      vector_b64: encodeVectorToBase64(c.vector),
    })),
  };

  const dataStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `file-vectors-${state.activeAdvancedRAGFileId}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importChunksAndVectors() {
  if (!state.activeAdvancedRAGFileId) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (!imported.chunks || !Array.isArray(imported.chunks)) {
          throw new Error("Invalid format.");
        }

        if (imported.model !== state.config.embeddingsModel) {
          alert(`Model mismatch!\n\nExported model: '${imported.model}'\nCurrent model: '${state.config.embeddingsModel}'\n\nImport cancelled. To bypass this, manually edit the 'model' field in the JSON file to match your current model.`);
          return;
        }

        const data = await dbGet(`mf_filedata_${state.activeAdvancedRAGFileId}`);
        if (!data) return;

        const raws = imported.chunks.map((c) => c.raw !== undefined ? c.raw : c.text);
        const meta = state.files.find((f) => f.id === state.activeAdvancedRAGFileId);
        meta.customChunks = JSON.stringify(raws, null, 2);

        await dbDeleteByPrefix(`mf_chunk_${state.activeAdvancedRAGFileId}_`);

        let chunkIndex = 0;
        const entries = [];
        const chunks = imported.chunks.map((c) => {
          let vec = c.vector_b64 ? decodeBase64ToVector(c.vector_b64) : c.vector ? new Float32Array(c.vector) : null;
          let mapped = { index: chunkIndex++, text: c.text, raw: c.raw !== undefined ? c.raw : c.text, vector: vec };
          entries.push([`mf_chunk_${state.activeAdvancedRAGFileId}_${String(mapped.index).padStart(6, "0")}`, mapped]);
          return mapped;
        });

        await dbSetMultiple(entries);

        meta.chunkCount = chunks.length;
        meta.embeddedCount = chunks.filter((c) => c.vector).length;
        meta.exactProgress = meta.chunkCount > 0 ? (meta.embeddedCount / meta.chunkCount) * 100 : 0;
        meta.progress = Math.round(meta.exactProgress);
        if (meta.progress >= 100) {
          meta.isEmbedding = false;
        }

        await dbSet(`mf_filedata_${state.activeAdvancedRAGFileId}`, data);
        saveState();
        if (state.activeAdvancedRAGSetting === "customChunks") {
          selectAdvancedRAGSetting("customChunks");
        } else {
          renderApp(true);
        }

        alert("Imported chunks and vectors successfully.");
      } catch (err) { 
        alert("Failed to import: " + err.message); 
      }
    };
    reader.readAsText(file);
  };
  input.click();
}
