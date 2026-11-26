import { $ } from '../dom.js';
import { state } from '../../store/state.js';
import { GLOBAL_SETTINGS, isPerModel, pickSchema } from '../../core/settings-schema.js';
import { escapeHTML } from '../../core/format.js';
import { mergeModelLists } from '../../core/models.js';
import { hasOverrides, OMIT } from '../../core/model-params.js';
import { settingsListHTML } from '../components/settings-list.js';
import { describeScopedSetting } from '../../services/settings.js';
import { availableModels } from '../../services/models.js';

/**
 * The advanced settings screen. A dropdown at the top picks whose LLM
 * parameters are edited: nothing for the defaults (every setting is shown),
 * or a model, which shows only the parameters it may override.
 */

/**
 * Every model on offer, plus any that still has overrides but is no longer
 * listed, so its overrides can be seen and removed.
 */
function scopeOptionsHTML(selected) {
  const config = state.data.config;
  const models = mergeModelLists(
    availableModels(),
    Object.keys(config.modelParams || {}),
    selected ? [selected] : [],
  );
  const option = (value, label) =>
    `<option value="${escapeHTML(value)}"${value === (selected || '') ? ' selected' : ''}>${escapeHTML(label)}</option>`;

  return [
    option('', 'All models (defaults)'),
    ...models.map((id) => option(id, hasOverrides(config, id) ? `${id} (custom)` : id)),
  ].join('');
}

function subtitleHTML(model) {
  if (!model) {
    return 'Advanced engine parameters. Hover over a setting to see its description. LLM parameters set here are the defaults for every model.';
  }
  return (
    `LLM parameters for <strong>${escapeHTML(model)}</strong>. Blank inherits the default; ` +
    `<code>${OMIT}</code> sends nothing for this model. Pick "All models" for every other setting.`
  );
}

export function renderSettingsView() {
  const container = $('#chat-container');
  if (!container) return;

  const model = state.session.settingsModel;
  const schema = model ? pickSchema(GLOBAL_SETTINGS, isPerModel) : GLOBAL_SETTINGS;

  container.innerHTML = `
    <div class="settings-panel">
      <div class="settings-header">
        <h2>Super Secret Settings</h2>
        <button data-command="settings.resetAll"
                title="${model ? 'Remove every override for this model' : 'Reset every default'}">Reset All</button>
      </div>
      <div class="settings-scope">
        <label for="settings-model-select">Parameters for</label>
        <select id="settings-model-select" data-command="settings.selectModel">
          ${scopeOptionsHTML(model)}
        </select>
      </div>
      <p class="settings-subtitle">${subtitleHTML(model)}</p>
      ${settingsListHTML({
        schema,
        activeKey: state.session.activeSettingKey,
        describe: (key) => describeScopedSetting(key, model),
      })}
    </div>`;
}
