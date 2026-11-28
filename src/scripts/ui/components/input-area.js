import { $, setHidden, setDisabled } from '../dom.js';
import { state, currentChat } from '../../store/state.js';
import { escapeHTML } from '../../core/format.js';
import { GLOBAL_SETTINGS, isPerModel, describeSetting } from '../../core/settings-schema.js';
import { OMIT } from '../../core/model-params.js';
import { SEARCH_MODES } from '../../core/chat-search.js';
import {
  describeCapabilities,
  capabilitySourceLabel,
  DEFAULT_EFFORT,
} from '../../core/capabilities.js';
import { availableModels, capabilitiesFor, reasoningChoicesFor } from '../../services/models.js';
import { composerAttachmentsHTML } from './attachments.js';
import { setMarqueeText, syncSelectMarquee } from '../marquee.js';

/** Input area components: the composer, settings editor and chat search bars. */

const PROMPT_PLACEHOLDER = 'Type your prompt here...';
const PICK_PLACEHOLDER =
  'Click the part of the message you want to edit, or Select All. Shift+Click another part to select everything in between. Paste or drop images to add them to the message.';
const EDIT_PLACEHOLDER = 'Empty: saving removes the selected part.';

const CLOSE_TITLE = 'Close the settings';
const CLOSE_BLOCKED_TITLE = 'Save, reset or cancel the setting being edited first';

/** How close to the bottom still counts as "following along" (see `chat-view.js`). */
const STICK_THRESHOLD_PX = 48;

function optionHTML(value, title = '') {
  const tip = title ? ` title="${escapeHTML(title)}"` : '';
  return `<option value="${escapeHTML(value)}"${tip}>${escapeHTML(value)}</option>`;
}

/**
 * While thinking levels are being chosen, the dropdown lists the efforts the
 * selected model takes: the ones its endpoint reported (with `default`,
 * which sends none), or the user's own list when it reported nothing.
 */
function renderReasoningDropdown(select) {
  const model = state.data.config.lastModel;
  const { levels, reported, source } = reasoningChoicesFor(model);
  const effort = state.data.config.reasoningEffort;

  select.innerHTML = levels.map((level) => optionHTML(level)).join('');
  select.value = levels.includes(effort) ? effort : levels[0];
  setDisabled(select, false);

  select.title = reported
    ? `Reasoning effort for ${model || 'this model'}, as reported by ${capabilitySourceLabel(source)}. ` +
      `"${DEFAULT_EFFORT}" sends none and leaves it to the server.`
    : 'Reasoning effort, from your own list (edit it below). "none" sends none.';
  syncSelectMarquee(select);
}

/**
 * The model dropdown, driven by whatever `services/models.js` last
 * discovered (plus any manually configured extras), less what the model
 * filter hides. It lists text models only: image models are reached through
 * the image tools. When editing thinking, the options flip to the reasoning
 * levels. A name too long for the dropdown scrolls (see `ui/marquee.js`).
 * Hovering it says what the selected model can do, when its endpoint said.
 */
export function updateModelDropdown() {
  const select = $('#model-select');
  if (!select) return;

  if (state.session.editingThinking) {
    renderReasoningDropdown(select);
    return;
  }

  const models = availableModels();
  const { loading, error } = state.runtime.models;

  if (models.length) {
    select.innerHTML = models
      .map((model) => optionHTML(model, describeCapabilities(capabilitiesFor(model))))
      .join('');
    select.value = state.data.config.lastModel;
  } else {
    const label = loading
      ? 'Loading models...'
      : error
        ? 'No models (hover for details)'
        : 'No models';
    select.innerHTML = `<option value="">${escapeHTML(label)}</option>`;
  }

  setDisabled(select, !models.length);

  if (error) {
    select.title = `Model discovery failed: ${error}`;
  } else {
    const summary = describeCapabilities(capabilitiesFor(state.data.config.lastModel));
    select.title = [summary, 'Ctrl+Click to configure thinking levels'].filter(Boolean).join('\n');
  }
  syncSelectMarquee(select);
}

/** What the send button says while a turn runs. */
function generationLabel({ phase }) {
  if (phase === 'tool') return 'Executing...';
  if (phase === 'generating') return 'Generating...';
  return 'Thinking...';
}

/**
 * The send button, which doubles as the stop button while a request is in
 * flight. Its label stays on one line and scrolls when it does not fit; the
 * full text is always the button's accessible name.
 */
export function renderSendButton() {
  const button = $('#send-btn');
  if (!button) return;

  const text = state.runtime.generation.active ? generationLabel(state.runtime.generation) : 'Send';
  if (button.getAttribute('aria-label') !== text) button.setAttribute('aria-label', text);
  setMarqueeText(button.querySelector('.marquee-label') || button, text);
}

function editingMessage() {
  const chat = currentChat();
  const index = state.session.editingMessageIndex;
  if (!chat || index === null) return null;
  return chat.messages[index] || null;
}

/**
 * The images waiting to be sent, in a strip at the bottom of the chat frame,
 * under the transcript. Hidden while a message or the thinking levels are
 * being edited: images pasted then go to the message.
 *
 * The strip takes its height out of the transcript, so a transcript that was
 * following the bottom is kept there when the strip appears or goes away.
 */
export function renderComposerAttachments() {
  const strip = $('#composer-attachments');
  if (!strip) return;

  const container = $('#chat-container');
  const wasPinned = container
    ? container.scrollHeight - container.scrollTop - container.clientHeight <= STICK_THRESHOLD_PX
    : false;

  const list = state.session.pendingAttachments || [];
  const show =
    list.length > 0 &&
    state.session.view === 'chat' &&
    state.session.editingMessageIndex === null &&
    !state.session.editingThinking;

  setHidden(strip, !show);
  strip.innerHTML = show ? composerAttachmentsHTML(list) : '';

  if (container && wasPinned) container.scrollTop = container.scrollHeight;
}

/**
 * The composer while a message is being edited. Until a block of the message
 * has been selected there is nothing to edit, so the composer is read-only and
 * says how to pick one; after that it holds the selected blocks' source.
 */
function renderComposerMode(chatInput, editingMsg) {
  if (!chatInput) return;
  const picking = Boolean(editingMsg) && !state.session.editingRange;
  chatInput.readOnly = picking;
  if (!editingMsg) chatInput.placeholder = PROMPT_PLACEHOLDER;
  else chatInput.placeholder = picking ? PICK_PLACEHOLDER : EDIT_PLACEHOLDER;
}

/**
 * The chats page's search bar: how the text is matched, whether case counts,
 * and the query itself. The query is only written back when it differs, so
 * a redraw never moves the caret while typing.
 */
function renderChatsBar() {
  const { query, mode, caseSensitive } = state.session.chatSearch;

  const select = $('#chat-search-mode');
  if (select) {
    if (!select.options.length) {
      select.innerHTML = SEARCH_MODES.map(
        (entry) => `<option value="${escapeHTML(entry.value)}">${escapeHTML(entry.label)}</option>`,
      ).join('');
    }
    if (select.value !== mode) select.value = mode;
  }

  const caseButton = $('#chat-search-case');
  if (caseButton) {
    caseButton.textContent = caseSensitive ? 'Case: On' : 'Case: Off';
    caseButton.setAttribute('aria-pressed', caseSensitive ? 'true' : 'false');
  }

  setDisabled($('#chat-search-clear'), !query);

  const input = $('#chat-search-input');
  if (input) {
    if (input.value !== query) input.value = query;
    input.placeholder = (SEARCH_MODES.find((entry) => entry.value === mode) || SEARCH_MODES[0]).hint;
  }
}

/** Show the bar that belongs to the current view, and the right buttons within. */
export function renderInputArea() {
  const view = state.session.view;

  setHidden($('#composer-bar'), view !== 'chat');
  setHidden($('#settings-bar'), view !== 'settings');
  setHidden($('#chats-bar'), view !== 'chats');

  if (view === 'settings') {
    renderSettingsEditor();
    // The pending images belong to the composer: out of sight with it.
    renderComposerAttachments();
    return;
  }

  if (view === 'chats') {
    renderChatsBar();
    renderComposerAttachments();
    return;
  }

  const editingMsg = editingMessage();
  const editingThink = state.session.editingThinking;
  const normalMode = !editingMsg && !editingThink;

  // The model dropdown is repurposed to select thinking options during that mode
  setHidden($('#model-select'), Boolean(editingMsg));
  setHidden($('#send-btn'), !normalMode);

  setHidden($('#save-edit-btn'), !editingMsg);
  setHidden($('#cancel-edit-btn'), !editingMsg);

  setHidden($('#save-thinking-btn'), !editingThink);
  setHidden($('#cancel-thinking-btn'), !editingThink);

  const chatInput = $('#chat-input');
  const thinkInput = $('#thinking-input');

  setHidden(chatInput, editingThink);
  setHidden(thinkInput, !editingThink);

  if (chatInput && !editingThink) chatInput.disabled = false;
  if (thinkInput && editingThink) {
    thinkInput.disabled = false;
    thinkInput.title = reasoningChoicesFor().reported
      ? 'Your own levels, used for models whose endpoint reports none. This model uses the levels its endpoint reported.'
      : 'Your own levels, one per line. Used for models whose endpoint reports none.';
  }

  renderComposerMode(chatInput, editingMsg);
  renderComposerAttachments();
  renderSendButton();
}

/**
 * What the empty editor says: the setting's description, and for a model's
 * override, what an empty value inherits and how to send nothing.
 */
function settingPlaceholder(key) {
  const tooltip = GLOBAL_SETTINGS[key]?.tooltip || '';

  const model = state.session.settingsModel;
  if (!model || !isPerModel(key)) return tooltip;

  const inherited = describeSetting(GLOBAL_SETTINGS, key, state.data.config[key]);
  return (
    `For ${model}. Empty inherits the default (${inherited}); "${OMIT}" sends nothing for this model.\n\n` +
    tooltip
  );
}

/**
 * Enable/disable the settings editor according to whether a key is selected.
 * Close works the other way round: it is grayed out while a setting is being
 * edited, so it cannot be hit instead of Save, Reset or Cancel.
 */
export function renderSettingsEditor() {
  const { activeSettingKey } = state.session;
  const editor = $('#settings-input');
  if (!editor) return;

  const hasSelection = Boolean(activeSettingKey);
  setDisabled(editor, !hasSelection);
  setDisabled($('#settings-save-btn'), !hasSelection);
  setDisabled($('#settings-reset-btn'), !hasSelection);
  setDisabled($('#settings-cancel-btn'), !hasSelection);

  const close = $('#settings-close-btn');
  setDisabled(close, hasSelection);
  if (close) close.title = hasSelection ? CLOSE_BLOCKED_TITLE : CLOSE_TITLE;

  if (!hasSelection) {
    editor.value = '';
    editor.placeholder = 'Select a setting above to edit...';
    return;
  }

  editor.placeholder = settingPlaceholder(activeSettingKey);
}

/** Push the stored draft into the editor without clobbering an active edit. */
export function setSettingsEditorValue(value) {
  const editor = $('#settings-input');
  if (editor) editor.value = value ?? '';
}

/**
 * Chrome state is expressed as three classes on <html>. Stylesheets do the
 * rest: showing or hiding the header and sidebar, striking through the matching
 * toggle word, and swapping the theme tokens. The same classes are set by the
 * pre-paint script in index.html, so this only ever confirms or corrects them.
 */
export function applyChromeState() {
  const root = document.documentElement;
  root.classList.toggle('sidebar-hidden', state.session.sidebarHidden);
  root.classList.toggle('title-hidden', state.session.titleHidden);
  root.classList.toggle('dark-theme', state.session.theme === 'dark');
}
