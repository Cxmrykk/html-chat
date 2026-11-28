import { $ } from '../dom.js';
import { state } from '../../store/state.js';
import { GLOBAL_SETTINGS, PER_MODEL_KEYS } from '../../core/settings-schema.js';
import { escapeHTML, truncate } from '../../core/format.js';
import { mergeModelLists } from '../../core/models.js';
import { hasOverrides } from '../../core/model-params.js';
import { settingsListHTML, selectRowHTML, actionRowHTML } from '../components/settings-list.js';
import { describeScopedSetting, readSetting } from '../../services/settings.js';
import {
  availableModels,
  listedModels,
  imageModels,
  imageToolModels,
  modelFilter,
  filterableModels,
} from '../../services/models.js';

/**
 * The advanced settings screen. Its main page opens with Quick Actions, cards
 * that act as soon as they are clicked: exporting and importing the settings,
 * and resetting every setting. (Chats are exported, imported and reset on the
 * chats page.) Then it holds every setting. Three more pages pick models:
 *
 *   - Filter Models, opened from a row under API & Connections, lists every
 *     text model the dropdown could offer, and a click puts one on the
 *     filter's list or takes it off. Model Filter Mode decides whether the
 *     list hides those models (blacklist) or offers only them (whitelist).
 *   - Identify Image Models lists every model there is to pick from, and a
 *     click marks or unmarks one as an image model. Image models are only
 *     ever used by the image tools; the chat is for text models.
 *   - Toggle Image Models lists the image models alone, every one allowed by
 *     default, and a click switches one off (or on again) for the image
 *     tools. Its row is greyed out while no image model is identified.
 *
 * On the main page, the LLM parameters (the per-model settings, all under
 * LLM Behavior) are shown for the model picked in a selector at the top of
 * their group: "All models" for the defaults every model inherits, or one
 * model for its own overrides. Every other setting is shared by all models
 * and ignores it. The selector, like every dropdown setting, is a setting
 * row with a transparent native `<select>` laid over it. On/Off settings are
 * switches that flip with a click.
 */

const ALL_MODELS_LABEL = 'All models (defaults)';
const SELECT_ID = 'settings-model-select';
const IMAGE_CATEGORY = GLOBAL_SETTINGS.sendGeneratedImages.category;
const FILTER_CATEGORY = GLOBAL_SETTINGS.modelFilterMode.category;

/* ------------------------------------------------------------------ *
 * Main page
 * ------------------------------------------------------------------ */

/**
 * The settings exports and resets, as setting cards under a heading of their
 * own. Reset All Settings follows the model picked for LLM Behavior: with one
 * picked, it removes only its overrides.
 */
function quickActionsHTML(model) {
  const cards = [
    actionRowHTML({
      command: 'settings.export',
      label: 'Export Settings',
      value: 'Without API key',
      title:
        'Download every setting, per-model override, image model selection and the model filter as a JSON file. The API key is left out.',
    }),
    actionRowHTML({
      command: 'settings.import',
      label: 'Import Settings',
      value: 'Replaces these',
      title: 'Replace these settings with a file made by Export Settings, after asking. Your API key is kept.',
    }),
    actionRowHTML({
      command: 'settings.resetAll',
      label: 'Reset All Settings',
      value: model ? `Overrides for ${truncate(model, 20)}` : 'To defaults',
      title: model
        ? `Remove every LLM Behavior override for ${model}`
        : 'Reset every setting to its default (per-model overrides, image models and the model filter list are kept)',
    }),
  ];

  return `
    <div class="settings-category">
      <h3>Quick Actions</h3>
    </div>
    <div class="settings-group">${cards.join('')}</div>`;
}

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
  return selectRowHTML({
    label: 'Model',
    value: selected || '',
    options: modelChoices(selected),
    command: 'settings.selectModel',
    id: SELECT_ID,
    hint: 'Which model the LLM Behavior values below are for. All models sets the defaults every model inherits.',
    ariaLabel: 'Model the LLM Behavior values are for',
  });
}

/** The row that opens Filter Models, after Model Filter Mode. */
function filterRowHTML() {
  const { mode, list } = modelFilter();
  const whitelist = mode === 'whitelist';
  const value = list.length
    ? `${list.length} ${whitelist ? 'shown' : 'hidden'}`
    : whitelist
      ? 'None shown'
      : 'None hidden';
  return actionRowHTML({
    command: 'settings.openPage',
    key: 'modelFilter',
    label: 'Filter Models',
    value,
    title: whitelist
      ? 'Choose the only models the model dropdown offers'
      : 'Choose which models the model dropdown hides',
  });
}

/** The two rows that open the image model pickers, at the top of Image Generation. */
function imagePageRowsHTML() {
  const selected = imageModels();
  const tools = imageToolModels();
  const none = !selected.length;

  return [
    actionRowHTML({
      command: 'settings.openPage',
      key: 'imageModels',
      label: 'Identify Image Models',
      value: none ? 'None' : `${selected.length} identified`,
      title: 'Choose which models are image models',
    }),
    actionRowHTML({
      command: 'settings.openPage',
      key: 'imageToolModels',
      label: 'Toggle Image Models',
      value: none ? 'No image models' : `${tools.length} of ${selected.length}`,
      title: none
        ? 'Identify at least one image model first'
        : 'Choose which image models the image tools may use',
      disabled: none,
    }),
  ].join('');
}

function mainPageHTML() {
  const model = state.session.settingsModel;
  const selector = modelSelectorHTML(model);
  const leadRows = Object.fromEntries([...perModelCategories()].map((category) => [category, selector]));
  leadRows[IMAGE_CATEGORY] = (leadRows[IMAGE_CATEGORY] || '') + imagePageRowsHTML();
  const trailRows = { [FILTER_CATEGORY]: filterRowHTML() };

  return `
    <div class="settings-panel" data-page="main">
      <div class="settings-header">
        <h2>Super Secret Settings</h2>
      </div>
      ${quickActionsHTML(model)}
      ${settingsListHTML({
        schema: GLOBAL_SETTINGS,
        activeKey: state.session.activeSettingKey,
        describe: (key) => describeScopedSetting(key, model),
        read: readSetting,
        leadRows,
        trailRows,
      })}
    </div>`;
}

/* ------------------------------------------------------------------ *
 * Model pickers
 * ------------------------------------------------------------------ */

function noteHTML(text) {
  return `<p class="settings-note">${escapeHTML(text)}</p>`;
}

/** One model in a picker: a button that toggles it. */
function choiceRowHTML({ command, id, name, on, onLabel, offLabel, title }) {
  return `
    <button class="setting-row setting-choice${on ? ' is-on' : ''}" data-command="${command}"
            data-key="${escapeHTML(id)}" aria-pressed="${on ? 'true' : 'false'}" title="${escapeHTML(title)}">
      <span class="setting-choice-name">${escapeHTML(name)}</span>
      <span class="setting-value">${escapeHTML(on ? onLabel : offLabel)}</span>
    </button>`;
}

/** Every text model the dropdown could offer, plus any on the list that is not one any more. */
function modelFilterRowsHTML() {
  const { mode, list } = modelFilter();
  const candidates = filterableModels();
  const models = mergeModelLists(candidates, list);
  if (!models.length) {
    return noteHTML('No models are listed yet. Check the connection settings, or add some under Extra Models.');
  }

  const whitelist = mode === 'whitelist';
  return models
    .map((id) => {
      const on = list.includes(id);
      const shown = whitelist ? on : !on;
      return choiceRowHTML({
        command: 'settings.toggleModelFilter',
        id,
        name: candidates.includes(id) ? id : `${id} (not listed)`,
        on,
        onLabel: whitelist ? 'Shown' : 'Hidden',
        offLabel: whitelist ? 'Hidden' : 'Shown',
        title: shown ? `Hide ${id} from the model dropdown` : `Offer ${id} in the model dropdown`,
      });
    })
    .join('');
}

function modelFilterNote() {
  return modelFilter().mode === 'whitelist'
    ? 'Whitelist: the model dropdown offers only the models marked Shown. Click a model to mark or unmark it. ' +
        'With none marked, no model is offered. Switch to a blacklist with Model Filter Mode, under API & Connections.'
    : 'Blacklist: the model dropdown hides the models marked Hidden. Click a model to hide it, and again to show it. ' +
        'Switch to a whitelist with Model Filter Mode, under API & Connections.';
}

/** Every listed model, plus any identified one the server no longer lists. */
function imageModelRowsHTML() {
  const selected = imageModels();
  const listed = listedModels();
  const models = mergeModelLists(listed, selected);
  if (!models.length) {
    return noteHTML('No models are listed yet. Check the connection settings, or add some under Extra Models.');
  }

  return models
    .map((id) => {
      const on = selected.includes(id);
      return choiceRowHTML({
        command: 'settings.toggleImageModel',
        id,
        name: listed.includes(id) ? id : `${id} (not listed)`,
        on,
        onLabel: 'Image model',
        offLabel: 'Off',
        title: on ? `Stop treating ${id} as an image model` : `Treat ${id} as an image model`,
      });
    })
    .join('');
}

/** The image models, each allowed for the tools unless switched off. */
function toolModelRowsHTML() {
  const selected = imageModels();
  if (!selected.length) {
    return noteHTML('No image models are identified. Identify some under Identify Image Models first.');
  }
  const tools = imageToolModels();

  return selected
    .map((id) => {
      const on = tools.includes(id);
      return choiceRowHTML({
        command: 'settings.toggleImageToolModel',
        id,
        name: id,
        on,
        onLabel: 'Tool',
        offLabel: 'Off',
        title: on ? `Stop the image tools from using ${id}` : `Let the image tools use ${id}`,
      });
    })
    .join('');
}

const PAGES = {
  modelFilter: {
    title: 'Filter Models',
    note: modelFilterNote,
    rows: modelFilterRowsHTML,
  },
  imageModels: {
    title: 'Identify Image Models',
    note: () =>
      'Click a model to mark it as an image model, and again to unmark it. Image models are used only by the image tools ' +
      '(Image Manipulation, in the sidebar), through the Images API (/images/generations and /images/edits). They are never ' +
      'offered in the model dropdown: the chat is for text models. Nothing is detected: only the models marked here are image models.',
    rows: imageModelRowsHTML,
  },
  imageToolModels: {
    title: 'Toggle Image Models',
    note: () =>
      'The image tools (Image Manipulation, in the sidebar) may use every identified image model unless it is switched off here. ' +
      'Click a model to switch it off, and again to switch it back on.',
    rows: toolModelRowsHTML,
  },
};

function subPageHTML(name, page) {
  return `
    <div class="settings-panel" data-page="${escapeHTML(name)}">
      <div class="settings-header">
        <h2>${escapeHTML(page.title)}</h2>
        <button data-command="settings.openPage" data-key="main" title="Back to the settings">Back</button>
      </div>
      ${noteHTML(page.note())}
      <div class="settings-group">${page.rows()}</div>
    </div>`;
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

/** What has the keyboard inside the view, so a re-render can give it back. */
function focusedControl(container) {
  const element = document.activeElement;
  if (!element || !container.contains(element)) return null;
  return {
    id: element.id || '',
    command: element.dataset?.command || '',
    key: element.dataset?.key ?? '',
  };
}

function restoreFocus(container, saved) {
  if (!saved) return;
  let target = saved.id ? container.querySelector(`#${CSS.escape(saved.id)}`) : null;
  if (!target && saved.command) {
    target = [...container.querySelectorAll('[data-command]')].find(
      (element) =>
        element.dataset.command === saved.command && (element.dataset.key ?? '') === saved.key,
    );
  }
  target?.focus({ preventScroll: true });
}

export function renderSettingsView() {
  const container = $('#chat-container');
  if (!container) return;

  const requested = state.session.settingsPage;
  const name = PAGES[requested] ? requested : 'main';

  // Re-rendering the same page keeps its scroll and the keyboard where they
  // were; a different page starts at the top.
  const previous = container.querySelector(':scope > .settings-panel')?.dataset.page;
  const scroll = previous === name ? container.scrollTop : 0;
  const focus = focusedControl(container);

  container.innerHTML = name === 'main' ? mainPageHTML() : subPageHTML(name, PAGES[name]);

  container.scrollTop = scroll;
  if (previous === name) restoreFocus(container, focus);
}
