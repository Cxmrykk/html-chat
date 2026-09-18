import { $ } from '../dom.js';
import { state, embeddingsEnabled, findFile, currentChat } from '../../store/state.js';
import { escapeHTML, formatDuration, formatSpeed } from '../../core/format.js';
import { pickInteger } from '../../core/values.js';
import { ICON_DELETE } from '../icons.js';

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

/**
 * The file list doubles as the current chat's attachment picker: a row reads
 * `[x]` when the chat may search that file. It therefore repaints when the
 * current chat changes, not only when the files do.
 */
export function renderFileList() {
  const list = $('#file-list');
  if (!list) return;

  applyMaxHeight(list, state.data.config.maxVisibleFiles);

  if (!state.data.files.length) {
    list.innerHTML = '<p class="list-empty">No files uploaded.</p>';
    return;
  }

  const enabled = embeddingsEnabled();
  const attached = new Set(currentChat()?.fileIds || []);

  list.innerHTML = state.data.files
    .map((file) => {
      const selected = attached.has(file.id);
      const stats = enabled && shouldShowStats(file)
        ? `<div class="file-progress-stats">${progressStatsHTML(file)}</div>`
        : '';
      const bar = enabled
        ? `<div class="file-progress-bar" style="width: ${file.exactProgress ?? file.progress ?? 0}%"></div>`
        : '';

      return `
        <div class="chat-item file-item${selected ? ' selected' : ''}" data-id="${escapeHTML(file.id)}"
             data-command="file.openSettings"
             title="Ctrl+Click for Advanced RAG Settings">
          <div class="file-item-row">
            <div class="chat-item-title" data-command="file.toggle"
                 role="checkbox" aria-checked="${selected ? 'true' : 'false'}"
                 title="Click to let this chat search the file&#10;Alt+Click to replace contents"><span class="file-marker" aria-hidden="true">${selected ? '[x]' : '[ ]'}</span> ${escapeHTML(file.name)}</div>
            <div class="chat-item-actions">
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
}
