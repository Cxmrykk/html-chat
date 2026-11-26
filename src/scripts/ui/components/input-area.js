import { $, setHidden, setDisabled } from '../dom.js';
import { state, currentChat } from '../../store/state.js';
import { estimateTokens } from '../../core/tokens.js';
import { formatCompactCount, escapeHTML } from '../../core/format.js';
import { buildApiMessages, payloadChars } from '../../core/tool-calls.js';
import { toolSchemaChars, toolActivityLabel } from '../../core/tools.js';
import { GLOBAL_SETTINGS } from '../../core/settings-schema.js';
import {
  describeCapabilities,
  capabilitySourceLabel,
  DEFAULT_EFFORT,
} from '../../core/capabilities.js';
import { availableModels, capabilitiesFor, reasoningChoicesFor } from '../../services/models.js';
import { toolSchemasFor } from '../../services/tools/index.js';
import { composerAttachmentsHTML } from './attachments.js';
import { setMarqueeText, syncSelectMarquee } from '../marquee.js';

/** Input area components: composer and settings editor bars. */

const PROMPT_PLACEHOLDER = 'Type your prompt here... Paste or drop images to attach them.';
const PICK_PLACEHOLDER =
  'Click the part of the message you want to edit, or Select All. Shift+Click another part to select everything in between. Paste or drop images to add them to the message.';
const EDIT_PLACEHOLDER = 'Empty: saving removes the selected part.';

const CLOSE_TITLE = 'Close the settings';
const CLOSE_BLOCKED_TITLE = 'Save, reset or cancel the setting being edited first';

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
 * discovered (plus any manually configured extras). When editing thinking,
 * the options flip to the reasoning levels. A name too long for the dropdown
 * scrolls (see `ui/marquee.js`). Hovering it says what the selected model
 * can do, when its endpoint said.
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

/**
 * Cached estimated character count for conversation context. It is measured
 * on the very payload a send would build, so whatever is left out of the
 * request (errors, thinking, unpaired tool calls) is left out of the estimate,
 * and the tool definitions that ride along with every request are counted.
 * Images are not: what they cost depends on the provider.
 */
function contextChars() {
  if (state.runtime.contextChars !== -1) return state.runtime.contextChars;

  let total = 0;
  const chat = currentChat();
  if (chat) {
    total = payloadChars(buildApiMessages(chat.messages)) + toolSchemaChars(toolSchemasFor());
  }

  state.runtime.contextChars = total;
  return total;
}

function generationLabel({ phase, tool, loop, maxLoops }) {
  const suffix = loop > 0 ? ` (Round ${loop}/${maxLoops})` : '';
  const verb =
    phase === 'tool' ? toolActivityLabel(tool) : phase === 'generating' ? 'Generating' : 'Thinking';
  return `${verb}${suffix}...`;
}

/** The text the send button should show right now. */
function sendButtonText() {
  if (state.runtime.generation.active) return generationLabel(state.runtime.generation);

  const input = $('#chat-input');
  const tokens = estimateTokens('x'.repeat((input?.value || '').length + contextChars()));
  const label = formatCompactCount(tokens);
  const pending = state.session.pendingAttachments?.length || 0;

  const parts = [];
  if (label) parts.push(`${label} tokens`);
  if (pending) parts.push(`${pending} image${pending === 1 ? '' : 's'}`);
  return parts.length ? `Send (${parts.join(' + ')})` : 'Send';
}

/**
 * The send button doubles as a token counter, and as the stop button while a
 * request is in flight. Its label stays on one line and scrolls when it does
 * not fit; the full text is always the button's accessible name.
 */
export function renderSendButton() {
  const button = $('#send-btn');
  if (!button) return;

  const text = sendButtonText();
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
 * The images waiting to be sent, above the prompt. Hidden while a message or
 * the thinking levels are being edited: images pasted then go to the message.
 */
export function renderComposerAttachments() {
  const strip = $('#composer-attachments');
  if (!strip) return;

  const list = state.session.pendingAttachments || [];
  const show =
    list.length > 0 &&
    state.session.view === 'chat' &&
    state.session.editingMessageIndex === null &&
    !state.session.editingThinking;

  setHidden(strip, !show);
  strip.innerHTML = show ? composerAttachmentsHTML(list) : '';
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

/** Show the bar that belongs to the current view, and the right buttons within. */
export function renderInputArea() {
  const view = state.session.view;

  setHidden($('#composer-bar'), view !== 'chat');
  setHidden($('#settings-bar'), view !== 'settings');

  if (view === 'settings') {
    renderSettingsEditor();
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

  editor.placeholder = GLOBAL_SETTINGS[activeSettingKey]?.tooltip || '';
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
