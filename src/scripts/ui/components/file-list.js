import { $ } from '../dom.js';
import { state, embeddingsEnabled, findFile, currentChat, profileOf } from '../../store/state.js';
import { escapeHTML, formatDuration, formatSpeed } from '../../core/format.js';
import { pickInteger } from '../../core/values.js';
import { ICON_DELETE, ICON_WARNING } from '../icons.js';

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

/** Embedding progress matters only for a file whose profile embeds, with a model to do it. */
function tracksEmbedding(file) {
  return embeddingsEnabled() && Boolean(profileOf(file)?.methods.embeddings);
}

function shouldShowBar(file) {
  return tracksEmbedding(file) && (file.progress ?? 0) < 100;
}

function shouldShowStats(file) {
  return tracksEmbedding(file) && Boolean(file.isEmbedding) && (file.progress ?? 0) < 100;
}

/** The caution button: no profile yet, or a parser that failed on this file. */
function cautionHTML(file, configured) {
  if (!configured) {
    return `<button class="caution" data-command="file.configure"
              title="Not configured: this file cannot be searched until you set up how. Click to configure.">${ICON_WARNING}</button>`;
  }
  if (file.indexError) {
    return `<button class="caution" data-command="file.configure"
              title="The parser failed on this file (${escapeHTML(file.indexError)}), so it is searched as one section. Click to fix the configuration.">${ICON_WARNING}</button>`;
  }
  return '';
}

/**
 * The file list doubles as the current chat's attachment picker: a row is
 * selected when the chat may search that file. It therefore repaints when the
 * current chat changes, not only when the files do. A file without a search
 * profile is shown muted with a caution button, and clicking it opens the
 * configurator instead of attaching it.
 */
export function renderFileList() {
  const list = $('#file-list');
  if (!list) return;

  applyMaxHeight(list, state.data.config.maxVisibleFiles);

  if (!state.data.files.length) {
    list.innerHTML = '<p class="list-empty">No files uploaded.</p>';
    return;
  }

  const attached = new Set(currentChat()?.fileIds || []);

  list.innerHTML = state.data.files
    .map((file) => {
      const selected = attached.has(file.id);
      const profile = profileOf(file);
      const configured = Boolean(profile);

      const stats = shouldShowStats(file)
        ? `<div class="file-progress-stats">${progressStatsHTML(file)}</div>`
        : '';
      const bar = shouldShowBar(file)
        ? `<div class="file-progress-bar" style="width: ${file.exactProgress ?? file.progress ?? 0}%"></div>`
        : '';

      const titleHint = configured
        ? `Searched with "${escapeHTML(profile.name)}"&#10;Click to let this chat search the file&#10;Alt+Click to replace contents&#10;Ctrl+Click to change its search configuration`
        : 'Not configured yet: click to set up how this file is searched';

      return `
        <div class="chat-item file-item${selected ? ' selected' : ''}${configured ? '' : ' unconfigured'}"
             data-id="${escapeHTML(file.id)}"
             data-command="file.edit"
             title="Ctrl+Click to change its search configuration">
          <div class="file-item-row">
            <div class="chat-item-title" data-command="file.toggle"
                 role="checkbox" aria-checked="${selected ? 'true' : 'false'}"
                 title="${titleHint}">${escapeHTML(file.name)}</div>
            <div class="chat-item-actions">
              ${cautionHTML(file, configured)}
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

  let bar = item.querySelector('.file-progress-bar');
  if (shouldShowBar(file)) {
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'file-progress-bar';
      item.appendChild(bar);
    }
    bar.style.width = `${file.exactProgress ?? file.progress ?? 0}%`;
  } else if (bar) {
    bar.remove();
    bar = null;
  }

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
