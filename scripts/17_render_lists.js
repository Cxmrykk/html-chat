// --- SIDEBAR RENDERING ---
function updateFileProgressDOM(id) {
  const f = files.find((meta) => meta.id === id);
  if (!f) return;

  const itemEl = document.querySelector(
    `.chat-item[data-id="${id}"][data-type="file"]`,
  );
  if (itemEl) {
    let statsEl = itemEl.querySelector(".file-progress-stats");
    let barEl = itemEl.querySelector(".file-progress-bar");

    if (f.isEmbedding && f.progress < 100) {
      const speed = f.embeddingSpeed
        ? `${f.embeddingSpeed.toFixed(1)} c/s`
        : "...";
      let eta = "...";
      if (f.embeddingEta !== undefined && f.embeddingEta !== null) {
        if (f.embeddingEta > 3600)
          eta = `${Math.floor(f.embeddingEta / 3600)}h ${Math.floor((f.embeddingEta % 3600) / 60)}m ${Math.round(f.embeddingEta % 60)}s`;
        else if (f.embeddingEta > 60)
          eta = `${Math.floor(f.embeddingEta / 60)}m ${Math.round(f.embeddingEta % 60)}s`;
        else eta = `${Math.round(f.embeddingEta)}s`;
      }
      const pct =
        f.exactProgress !== undefined
          ? f.exactProgress.toFixed(1)
          : (f.progress || 0).toFixed(1);

      if (!statsEl) {
        statsEl = document.createElement("div");
        statsEl.className = "file-progress-stats";
        statsEl.style.cssText =
          "font-size: 0.75em; color: #666; text-align: left; margin-top: 2px;";
        itemEl.insertBefore(statsEl, barEl || null);
      }
      statsEl.innerHTML = `<div>Progress: ${pct}% (${speed})</div><div>ETA: ${eta}</div>`;
    } else if (statsEl) statsEl.remove();

    if (barEl)
      barEl.style.width = `${f.exactProgress !== undefined ? f.exactProgress : f.progress}%`;

    const actionsEl = itemEl.querySelector(".chat-item-actions");
    if (actionsEl) {
      let embedBtn = actionsEl.querySelector('button[data-action="embed"]');
      if (f.progress >= 100 && !embedBtn) {
        embedBtn = document.createElement("button");
        embedBtn.dataset.action = "embed";
        embedBtn.title = "Insert Embedding";
        embedBtn.textContent = "e";
        actionsEl.insertBefore(embedBtn, actionsEl.firstChild);
      } else if (f.progress < 100 && embedBtn) embedBtn.remove();
    }
  }

  if (isAdvancedRAGSettingsOpen && activeAdvancedRAGFileId === id) {
    const toggleBtn = document.querySelector(
      'button[onclick="toggleAdvancedEmbedding()"]',
    );
    if (toggleBtn)
      toggleBtn.textContent = f.isEmbedding
        ? "⏸ Pause Embedding"
        : "▶ Start Embedding";
  }
}

function renderFileList() {
  const list = $("#file-list");
  const maxVisible = parseInt(config.maxVisibleFiles, 10);
  if (!isNaN(maxVisible) && maxVisible > 0) {
    list.style.maxHeight = `calc(${maxVisible} * (1.6em + 17px))`;
    list.style.overflowY = "auto";
  } else {
    list.style.maxHeight = "";
    list.style.overflowY = "";
  }

  if (!files.length)
    return (list.innerHTML =
      '<p style="font-size:0.8em; color:#666;">No files uploaded.</p>');
  const embeddingsEnabled = !!(
    config.embeddingsModel && config.embeddingsModel.trim() !== ""
  );

  list.innerHTML = files
    .map((f) => {
      let embedBtn = "",
        progressBar = "",
        progressStats = "";
      if (embeddingsEnabled) {
        if (f.isEmbedding && f.progress < 100) {
          const speed = f.embeddingSpeed
            ? `${f.embeddingSpeed.toFixed(1)} c/s`
            : "...";
          let eta = "...";
          if (f.embeddingEta !== undefined && f.embeddingEta !== null) {
            if (f.embeddingEta > 60)
              eta = `${Math.floor(f.embeddingEta / 60)}m ${Math.round(f.embeddingEta % 60)}s`;
            else eta = `${Math.round(f.embeddingEta)}s`;
          }
          progressStats = `<div class="file-progress-stats" style="font-size: 0.75em; color: #666; text-align: left; margin-top: 2px;"><div>Progress: ${(f.exactProgress || f.progress || 0).toFixed(1)}% (${speed})</div><div>ETA: ${eta}</div></div>`;
        }
        progressBar = `<div class="file-progress-bar" style="width: ${f.exactProgress !== undefined ? f.exactProgress : f.progress}%"></div>`;
        if (f.progress >= 100)
          embedBtn = `<button data-action="embed" title="Insert Embedding">e</button>`;
      }

      return `<div class="chat-item" style="display:block;" data-id="${f.id}" data-type="file" title="Ctrl+Click for Advanced RAG Settings">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div class="chat-item-title" data-action="load" title="Click to insert full contents into chat\nAlt+Click to overwrite contents">${escapeHTML(f.name)}</div>
        <div class="chat-item-actions">${embedBtn}<button data-action="delete" title="Delete File">d</button></div>
      </div>${progressStats}${progressBar}</div>`;
    })
    .join("");
}

function renderChatList() {
  const list = $("#chat-list");
  const maxVisible = parseInt(config.maxVisibleChats, 10);
  if (!isNaN(maxVisible) && maxVisible > 0) {
    list.style.maxHeight = `calc(${maxVisible} * (1.6em + 17px))`;
    list.style.overflowY = "auto";
  } else {
    list.style.maxHeight = "";
    list.style.overflowY = "";
  }

  if (!chats.length)
    return (list.innerHTML =
      '<p style="font-size:0.8em; color:#666;">No chats. Start a new one.</p>');

  list.innerHTML = chats
    .map(
      (chat) => `
    <div class="chat-item ${chat.id === currentChatId ? "active" : ""}" data-id="${chat.id}" data-type="chat">
      <div class="chat-item-title" data-action="load" title="Export: Alt+Click">${escapeHTML(chat.title)}</div>
      <div class="chat-item-actions"><button data-action="rename" title="Rename">r</button><button data-action="delete" title="Delete">d</button></div>
    </div>`,
    )
    .join("");
}
