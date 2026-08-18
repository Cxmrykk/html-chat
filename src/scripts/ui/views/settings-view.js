import { $ } from '../dom.js';
import { state, activeFile, isEmbedding } from '../../store/state.js';
import { escapeHTML } from '../../core/format.js';
import { settingsListHTML } from '../components/settings-list.js';
import { schemaFor, readSetting } from '../../services/settings.js';

/** Both settings screens, from one template. */

function fileToolbarHTML(file) {
  return `
    <div class="settings-toolbar">
      <button data-command="file.chunk" title="Generate chunks and overwrite Custom Chunks array">Attempt Chunking</button>
      <button data-command="file.toggleEmbed" title="Start or pause embeddings for this file">${
        isEmbedding(file.id) ? '⏸ Pause Embedding' : '▶ Start Embedding'
      }</button>
      <button data-command="file.exportVectors" title="Export JSON of Chunk &amp; Vector pairs">Export Vectors</button>
      <button data-command="file.importVectors" title="Import JSON of Chunk &amp; Vector pairs">Import Vectors</button>
    </div>`;
}

export function renderSettingsView() {
  const container = $('#chat-container');
  if (!container) return;

  const isFileScope = state.session.view === 'file-settings';
  const scope = isFileScope ? 'file' : 'global';
  const schema = schemaFor(scope);
  const file = isFileScope ? activeFile() : null;

  if (isFileScope && !file) {
    container.innerHTML = '<h3 class="chat-placeholder">File no longer available.</h3>';
    return;
  }

  const title = isFileScope ? 'Advanced RAG Settings' : 'Super Secret Settings';
  const subtitle = isFileScope
    ? `Configure specific embedding and retrieval logic for this file. (${escapeHTML(file.name)})`
    : 'Advanced engine parameters. Hover over a setting to see its description.';

  container.innerHTML = `
    <div class="settings-panel">
      <div class="settings-header">
        <h2>${title}</h2>
        <button data-command="settings.resetAll">Reset All</button>
      </div>
      <p class="settings-subtitle">${subtitle}</p>
      ${isFileScope ? fileToolbarHTML(file) : ''}
      ${settingsListHTML({
        schema,
        activeKey: state.session.activeSettingKey,
        readValue: (key) => readSetting(scope, key, state.session.activeFileId),
      })}
    </div>`;
}
