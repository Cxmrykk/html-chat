import { $ } from '../dom.js';
import { state, currentChat } from '../../store/state.js';
import { GLOBAL_SETTINGS, PER_MODEL_KEYS } from '../../core/settings-schema.js';
import { escapeHTML, truncate } from '../../core/format.js';
import { mergeModelLists } from '../../core/models.js';
import { hasOverrides } from '../../core/model-params.js';
import { settingsListHTML, selectRowHTML } from '../components/settings-list.js';
import { describeScopedSetting, readSetting } from '../../services/settings.js';
import {
  availableModels,
  listedModels,
  imageModels,
  imageToolModels,
} from '../../services/models.js';

/**
 * The advanced settings screen. Its main page opens with Quick Actions, cards
 * that act as soon as they are clicked: exporting the open chat, every chat,
 * or the settings; importing any of those; resetting every setting; and
 * deleting every chat. Then it holds every setting. Two more pages pick
 * models, each opened from a row under Image Generation:
 *
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
 * row with a transparent native `<select>` laid over it.
 */

const ALL_MODELS_LABEL = 'All models (defaults)';
const SELECT_ID = 'settings-model-select';
const IMAGE_CATEGORY = GLOBAL_SETTINGS.sendGeneratedImages.category;

/* ------------------------------------------------------------------ *
 * Main page
 * ------------------------------------------------------------------ */

/** One Quick Actions card: a setting row whose click runs `command` at once. */
function actionCardHTML({ command, label, value, title, disabled = false }) {
  return `
    <button class="setting-row" data-command="${escapeHTML(command)}"
            title="${escapeHTML(title)}"${disabled ? ' disabled' : ''}>
      <span>${escapeHTML(label)}</span>
      <span class="setting-value">${escapeHTML(value)}</span>
    </button>`;
}

function chatCount(count) {
  return count === 1 ? '1 chat' : `${count} chats`;
}

/**
 * Exports, the import that reads any of them, and the resets, as setting
 * cards under a heading of their own. Reset All Settings follows the model
 * picked for LLM Behavior: with one picked, it removes only its overrides.
 */
function quickActionsHTML(model) {
  const count = state.data.chats.length;
  const open = currentChat();

  const cards = [
    actionCardHTML({
      command: 'chat.exportCurrent',
      label: 'Export Current Chat',
      value: open ? truncate(open.title, 28) : 'No chat open',
      title: 'Download the open chat as a JSON file',
      disabled: !open,
    }),
    actionCardHTML({
      command: 'chat.export',
      label: 'Export All Chats',
      value: count ? chatCount(count) : 'No chats',
      title: 'Download every chat as one JSON file',
      disabled: !count,
    }),
    actionCardHTML({
      command: 'settings.export',
      label: 'Export Settings',
      value: 'Without API key',
      title:
        'Download every setting, per-model override and image model selection as a JSON file. The API key is left out.',
    }),
    actionCardHTML({
      command: 'data.import',
      label: 'Import',
      value: 'Chats or settings',
      title:
        'Import a file made by any of the exports: one chat, all chats, or the settings. Chats whose id already exists are skipped.',
    }),
    actionCardHTML({
      command: 'settings.resetAll',
      label: 'Reset All Settings',
      value: model ? `Overrides for ${truncate(model, 20)}` : 'To defaults',
      title: model
        ? `Remove every LLM Behavior override for ${model}`
        : 'Reset every setting to its default (per-model overrides and image models are kept)',
    }),
    actionCardHTML({
      command: 'chat.resetAll',
      label: 'Reset Chats',
      value: count ? `Delete ${chatCount(count)}` : 'No chats',
      title: 'Delete every chat. Export them first to keep a copy.',
      disabled: !count,
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

/** The two rows that open the model pickers, at the top of Image Generation. */
function pageRowsHTML() {
  const selected = imageModels();
  const tools = imageToolModels();
  const none = !selected.length;

  const toolsValue = none ? 'No image models' : `${tools.length} of ${selected.length}`;
  const toolsHint = none
    ? 'Identify at least one image model first'
    : 'Choose which image models the image tools may use';

  return `
    <button class="setting-row" data-command="settings.openPage" data-key="imageModels"
            title="Choose which models are image models">
      <span>Identify Image Models</span>
      <span class="setting-value">${escapeHTML(none ? 'None' : `${selected.length} identified`)}</span>
    </button>
    <button class="setting-row" data-command="settings.openPage" data-key="imageToolModels"
            title="${escapeHTML(toolsHint)}"${none ? ' disabled' : ''}>
      <span>Toggle Image Models</span>
      <span class="setting-value">${escapeHTML(toolsValue)}</span>
    </button>`;
}

function mainPageHTML() {
  const model = state.session.settingsModel;
  const selector = modelSelectorHTML(model);
  const leadRows = Object.fromEntries([...perModelCategories()].map((category) => [category, selector]));
  leadRows[IMAGE_CATEGORY] = (leadRows[IMAGE_CATEGORY] || '') + pageRowsHTML();

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
  imageModels: {
    title: 'Identify Image Models',
    note:
      'Click a model to mark it as an image model, and again to unmark it. Image models are used only by the image tools ' +
      '(Image Manipulation, in the sidebar), through the Images API (/images/generations and /images/edits). They are never ' +
      'offered in the model dropdown: the chat is for text models. Nothing is detected: only the models marked here are image models.',
    rows: imageModelRowsHTML,
  },
  imageToolModels: {
    title: 'Toggle Image Models',
    note:
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
      ${noteHTML(page.note)}
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
