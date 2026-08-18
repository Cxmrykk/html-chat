/** Embeddings endpoint client. Takes config explicitly; touches no state. */

function resolveEndpoint(config) {
  const custom = config.embeddingsUrl && config.embeddingsUrl.trim() !== ''
    ? config.embeddingsUrl.trim()
    : config.url;

  let base = (custom || '').replace(/\/+$/, '');
  if (base.endsWith('/chat/completions')) {
    base = base.replace('/chat/completions', '');
  }
  return `${base}/embeddings`;
}

function resolveKey(config) {
  return config.embeddingsKey && config.embeddingsKey.trim() !== ''
    ? config.embeddingsKey.trim()
    : config.key;
}

async function toError(response) {
  const body = await response.text();
  let message = body;
  try {
    message = JSON.parse(body).error.message;
  } catch {
    /* keep the raw body */
  }
  return new Error(`API Error: ${response.status} ${response.statusText}\n${message}`);
}

export async function fetchEmbeddings(config, texts, signal = null) {
  const response = await fetch(resolveEndpoint(config), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resolveKey(config)}`,
    },
    body: JSON.stringify({
      model: config.embeddingsModel || 'text-embedding-3-small',
      input: texts,
    }),
    signal: signal || undefined,
  });

  if (!response.ok) throw await toError(response);

  const payload = await response.json();
  return payload.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
}
