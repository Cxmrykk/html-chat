import { $ } from '../dom.js';
import { state, embeddingsEnabled, findFile } from '../../store/state.js';
import { escapeHTML, formatDuration, formatSpeed } from '../../core/format.js';
import { pickInteger } from '../../core/values.js';
import { ICON_DELETE, ICON_EMBED } from '../icons.js';

const ROW_HEIGHT = '1.6em + 17px';

function applyMaxHeight(list, limit) {
  const max = pickInteger(0, limit);
  if (max > 0) {
    list.style.maxHeight = `calc(${max} * (${ROW_HEIGHT}))`;
    list.style.overflowY = 'auto';
  } else {
    list.style.maxHeight = '';
    list.style.overflowY = '';
  }
}

/** One shared formatter, so incremental and full renders cannot diverge. */
function progressStatsHTML(file) {
  const percent = (file.exactProgress ?? file.progress ?? 0).toFixed(1);
  return (
    `<div>Progress: ${percent}% (${formatSpeed(file.embeddingSpeed)})</div>` +
    `<div>ETA: ${formatDuration(file.embeddingEta)}</div>`
  );
}

function shouldShowStats(file) {
  return Boolean(file.isEmbedding) && (file.progress ?? 0) < 100;
}

export function renderFileList() {
  const list = $('#file-list');
  if (!list) return;

  applyMaxHeight(list, state.data.config.maxVisibleFiles);

  if (!state.data.files.length) {
    list.innerHTML = '<p class="list-empty">No files uploaded.</p>';
    return;
  }

  const enabled = embeddingsEnabled();

  list.innerHTML = state.data.files
    .map((file) => {
      const stats = enabled && shouldShowStats(file)
        ? `<div class="file-progress-stats">${progressStatsHTML(file)}</div>`
        : '';
      const bar = enabled
        ? `<div class="file-progress-bar" style="width: ${file.exactProgress ?? file.progress ?? 0}%"></div>`
        : '';
      const embedButton = enabled && (file.progress ?? 0) >= 100
        ? `<button data-command="file.insertEmbed" title="Insert Embedding">${ICON_EMBED}</button>`
        : '';

      return `
        <div class="chat-item file-item" data-id="${escapeHTML(file.id)}"
             data-command="file.openSettings"
             title="Ctrl+Click for Advanced RAG Settings">
          <div class="file-item-row">
            <div class="chat-item-title" data-command="file.insert"
                 title="Click to insert full contents into chat&#10;Alt+Click to replace contents">${escapeHTML(file.name)}</div>
            <div class="chat-item-actions">
              ${embedButton}
              <button data-command="file.delete" title="Delete File">${ICON_DELETE}</button>
            </div>
          </div>
          ${stats}
          ${bar}
        </div>`;
    })
    .join('');
}

/** Cheap in-place update for the high-frequency progress event. */
export function updateFileProgress(id) {
  const file = findFile(id);
  const item = $(`.file-item[data-id="${CSS.escape(id)}"]`);
  if (!file || !item) return;

  const bar = item.querySelector('.file-progress-bar');
  if (bar) bar.style.width = `${file.exactProgress ?? file.progress ?? 0}%`;

  let stats = item.querySelector('.file-progress-stats');
  if (shouldShowStats(file)) {
    if (!stats) {
      stats = document.createElement('div');
      stats.className = 'file-progress-stats';
      item.insertBefore(stats, bar || null);
    }
    stats.innerHTML = progressStatsHTML(file);
  } else if (stats) {
    stats.remove();
  }

  const actions = item.querySelector('.chat-item-actions');
  if (!actions) return;
  const embedButton = actions.querySelector('[data-command="file.insertEmbed"]');
  const complete = (file.progress ?? 0) >= 100;

  if (complete && !embedButton) {
    const button = document.createElement('button');
    button.dataset.command = 'file.insertEmbed';
    button.title = 'Insert Embedding';
    button.innerHTML = ICON_EMBED;
    actions.insertBefore(button, actions.firstChild);
  } else if (!complete && embedButton) {
    embedButton.remove();
  }
}
