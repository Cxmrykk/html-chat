// --- EMBEDDINGS EXPORT/IMPORT ---
async function exportChunksAndVectors() {
  if (!activeAdvancedRAGFileId) return;
  const chunks = await getFileChunks(activeAdvancedRAGFileId);
  if (!chunks || chunks.length === 0) return alert("No chunks found.");

  const payload = {
    model: config.embeddingsModel,
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
  a.download = `file-vectors-${activeAdvancedRAGFileId}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importChunksAndVectors() {
  if (!activeAdvancedRAGFileId) return;
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
        if (!imported.chunks || !Array.isArray(imported.chunks))
          throw new Error("Invalid format.");

        if (imported.model !== config.embeddingsModel) {
          alert(
            `Model mismatch!\n\nExported model: '${imported.model}'\nCurrent model: '${config.embeddingsModel}'\n\nImport cancelled. To bypass this, manually edit the 'model' field in the JSON file to match your current model.`,
          );
          return;
        }

        const data = await dbGet(`mf_filedata_${activeAdvancedRAGFileId}`);
        if (!data) return;

        const raws = imported.chunks.map((c) =>
          c.raw !== undefined ? c.raw : c.text,
        );
        const meta = files.find((f) => f.id === activeAdvancedRAGFileId);
        meta.customChunks = JSON.stringify(raws, null, 2);

        await dbDeleteByPrefix(`mf_chunk_${activeAdvancedRAGFileId}_`);

        let chunkIndex = 0;
        const entries = [];
        const chunks = imported.chunks.map((c) => {
          let vec = c.vector_b64
            ? decodeBase64ToVector(c.vector_b64)
            : c.vector
              ? new Float32Array(c.vector)
              : null;
          let mapped = {
            index: chunkIndex++,
            text: c.text,
            raw: c.raw !== undefined ? c.raw : c.text,
            vector: vec,
          };
          entries.push([
            `mf_chunk_${activeAdvancedRAGFileId}_${String(mapped.index).padStart(6, "0")}`,
            mapped,
          ]);
          return mapped;
        });

        await dbSetMultiple(entries);

        meta.chunkCount = chunks.length;
        meta.embeddedCount = chunks.filter((c) => c.vector).length;
        meta.exactProgress =
          meta.chunkCount > 0
            ? (meta.embeddedCount / meta.chunkCount) * 100
            : 0;
        meta.progress = Math.round(meta.exactProgress);
        if (meta.progress >= 100) meta.isEmbedding = false;

        await dbSet(`mf_filedata_${activeAdvancedRAGFileId}`, data);
        saveState();
        if (activeAdvancedRAGSetting === "customChunks")
          await selectAdvancedRAGSetting("customChunks");
        else renderApp(true);

        alert("Imported chunks and vectors successfully.");
      } catch (err) {
        alert("Failed to import: " + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}
