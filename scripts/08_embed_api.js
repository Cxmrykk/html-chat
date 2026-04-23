// --- EMBEDDINGS API FETCH ---
async function fetchEmbeddings(texts, signal = null) {
  let base =
    config.embeddingsUrl && config.embeddingsUrl.trim() !== ""
      ? config.embeddingsUrl.trim().replace(/\/+$/, "")
      : config.url.replace(/\/+$/, "");
  if (base.endsWith("/chat/completions"))
    base = base.replace("/chat/completions", "");
  const endpoint = base + "/embeddings";

  const apiKey =
    config.embeddingsKey && config.embeddingsKey.trim() !== ""
      ? config.embeddingsKey.trim()
      : config.key;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.embeddingsModel || "text-embedding-3-small",
      input: texts,
    }),
    signal: signal || undefined,
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

async function resetAllFileEmbeddings() {
  for (const meta of files) {
    meta.progress = 0;
    meta.exactProgress = 0;
    meta.embeddedCount = 0;
    meta.chunkCount = 0;
    meta.isEmbedding = false;
    meta.embeddingSpeed = null;
    meta.embeddingEta = null;
    if (embeddingAbortControllers[meta.id]) {
      embeddingAbortControllers[meta.id].abort();
      delete embeddingAbortControllers[meta.id];
    }
    await dbDeleteByPrefix(`mf_chunk_${meta.id}_`);
  }
  saveState();
  renderApp();
}
