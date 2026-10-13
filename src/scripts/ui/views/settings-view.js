import { $ } from '../dom.js';
import { state } from '../../store/state.js';
import { GLOBAL_SETTINGS } from '../../core/settings-schema.js';
import { settingsListHTML } from '../components/settings-list.js';
import { readSetting } from '../../services/settings.js';

/** The advanced settings screen. */
export function renderSettingsView() {
  const container = $('#chat-container');
  if (!container) return;

  container.innerHTML = `
    <div class="settings-panel">
      <div class="settings-header">
        <h2>Super Secret Settings</h2>
        <button data-command="settings.resetAll">Reset All</button>
      </div>
      <p class="settings-subtitle">Advanced engine parameters. Hover over a setting to see its description. How each file is searched is set up per file: click a file with a caution sign, or Ctrl+Click any file.</p>
      ${settingsListHTML({
        schema: GLOBAL_SETTINGS,
        activeKey: state.session.activeSettingKey,
        readValue: readSetting,
      })}
    </div>`;
}
