import { $ } from '../dom.js';
import { state } from '../../store/state.js';
import { GLOBAL_SETTINGS, PER_MODEL_KEYS } from '../../core/settings-schema.js';
import { escapeHTML } from '../../core/format.js';
import { mergeModelLists } from '../../core/models.js';
import { hasOverrides, OMIT } from '../../core/model-params.js';
import { settingsListHTML } from '../components/settings-list.js';
import { describeScopedSetting } from '../../services/settings.js';
import { availableModels } from '../../services/models.js';

/**
 * The advanced settings screen: every setting on one page.
 *
 * The LLM parameters (the per-model settings, all under LLM Behavior) are
 * shown for the model picked in a selector at the top of their group: "All
 * models" for the defaults every model inherits, or one model for its own
 * overrides. Every other setting is shared by all models and ignores it.
 *
 * The selector is drawn as a setting row — the very same button — with a
 * transparent native `<select>` laid over it, so it has the rows' exact size,
 * font and hover, and still opens the browser's own list.
 */

const ALL_MODELS_LABEL = 'All models (defaults)';
const SELECT_ID = 'settings-model-select';

/** The categories that hold per-model settings, where the selector goes. */
function perModelCategories() {
  return new Set(PER_MODEL_KEYS.map((key) => GLOBAL_SETTINGS[key].category || 'Other'));
}

/**
 * Every model on offer, plus any that still has overrides but is no longer
 * listed, so its overrides can be seen and removed. Models with overrides are
 * marked.
 */
function modelChoices(selected) {
  const config = state.data.config;
  const models = mergeModelLists(
    availableModels(),
    Object.keys(config.modelParams || {}),
    selected ? [selected] : [],
  );
  return [
    { value: '', label: ALL_MODELS_LABEL },
    ...models.map((id) => ({ value: id, label: hasOverrides(config, id) ? `${id} (custom)` : id })),
  ];
}

function modelSelectorHTML(selected) {
  const choices = modelChoices(selected);
  const current = choices.find((choice) => choice.value === (selected || '')) || choices[0];
  const options = choices
    .map(
      ({ value, label }) =>
        `<option value="${escapeHTML(value)}"${value === current.value ? ' selected' : ''}>${escapeHTML(label)}</option>`,
    )
    .join('');
  const hint =
    'Which model the LLM Behavior values below are for. All models sets the defaults every model inherits.';

  return `
    <div class="setting-select" title="${escapeHTML(hint)}">
      <button class="setting-row" type="button" tabindex="-1" aria-hidden="true">
        <span>Model</span>
        <span class="setting-value">${escapeHTML(current.label)}</span>
      </button>
      <select id="${SELECT_ID}" data-command="settings.selectModel"
              aria-label="Model the LLM Behavior values are for">${options}</select>
    </div>`;
}

function subtitleHTML() {
  return (
    'Advanced engine parameters. Hover over a setting to see its description. ' +
    'The LLM Behavior values are for the model picked under that heading: All models sets the defaults; ' +
    `for one model, blank inherits the default and <code>${OMIT}</code> sends nothing for it.`
  );
}

export function renderSettingsView() {
  const container = $('#chat-container');
  if (!container) return;

  const model = state.session.settingsModel;
  // Re-rendering replaces the selector; keep the keyboard where it was.
  const selectorFocused = document.activeElement?.id === SELECT_ID;

  const selector = modelSelectorHTML(model);
  const leadRows = Object.fromEntries([...perModelCategories()].map((category) => [category, selector]));

  container.innerHTML = `
    <div class="settings-panel">
      <div class="settings-header">
        <h2>Super Secret Settings</h2>
        <button data-command="settings.resetAll"
                title="${
                  model
                    ? escapeHTML(`Remove every LLM Behavior override for ${model}`)
                    : 'Reset every setting to its default (per-model overrides are kept)'
                }">Reset All</button>
      </div>
      <p class="settings-subtitle">${subtitleHTML()}</p>
      ${settingsListHTML({
        schema: GLOBAL_SETTINGS,
        activeKey: state.session.activeSettingKey,
        describe: (key) => describeScopedSetting(key, model),
        leadRows,
      })}
    </div>`;

  if (selectorFocused) $(`#${SELECT_ID}`)?.focus({ preventScroll: true });
}
