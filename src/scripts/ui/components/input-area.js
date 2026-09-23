import { $, setHidden, setText, setDisabled } from '../dom.js';
import {
  state,
  currentChat,
  isEmbedding,
} from '../../store/state.js';
import { estimateTokens } from '../../core/tokens.js';
import { formatCompactCount, escapeHTML } from '../../core/format.js';
import { buildApiMessages, payloadChars } from '../../core/tool-calls.js';
import { toolSchemaChars, toolActivityLabel } from '../../core/tools.js';
import { schemaFor } from '../../services/settings.js';
import { availableModels } from '../../services/models.js';
import { toolSchemasFor } from '../../services/tools/index.js';
import { isRetryable } from './message.js';

/** Input area components: composer and settings editor bars. */

const PROMPT_PLACEHOLDER = 'Type your prompt here...';
const PICK_PLACEHOLDER = 'Click the part of the message you want to edit.';
const EDIT_PLACEHOLDER = 'Empty: saving removes the selected part.';

/**
 * The model dropdown, driven by whatever `services/models.js` last
 * discovered (plus any manually configured extras). When editing thinking,
 * the options flip to the reasoning levels.
 */
export function updateModelDropdown() {
  const select = $('#model-select');
  if (!select) return;

  if (state.session.editingThinking) {
    const levels = (state.data.config.availableReasoningLevels || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    if (levels.length) {
      select.innerHTML = levels
        .map((level) => `<option value="${escapeHTML(level)}">${escapeHTML(level)}</option>`)
        .join('');
      select.value = state.data.config.reasoningEffort || 'none';
    } else {
      select.innerHTML = `<option value="none">none</option>`;
      select.value = 'none';
    }
    setDisabled(select, false);
    select.title = 'Select reasoning effort';
    return;
  }

  const models = availableModels();
  const { loading, error } = state.runtime.models;

  if (models.length) {
    select.innerHTML = models
      .map((model) => `<option value="${escapeHTML(model)}">${escapeHTML(model)}</option>`)
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
  select.title = error ? `Model discovery failed: ${error}` : 'Ctrl+Click to configure thinking levels';
}

/**
 * Cached estimated character count for conversation context. It is measured
 * on the very payload a send would build, so whatever is left out of the
 * request (errors, thinking, unpaired tool calls) is left out of the estimate,
 * and the tool definitions that ride along with every request are counted.
 */
function contextChars() {
  if (state.runtime.contextChars !== -1) return state.runtime.contextChars;

  let total = 0;
  const chat = currentChat();
  if (chat) {
    total = payloadChars(buildApiMessages(chat.messages)) + toolSchemaChars(toolSchemasFor(chat));
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

/**
 * The send button doubles as a token counter, and as the stop button while a
 * request is in flight.
 */
export function renderSendButton() {
  const button = $('#send-btn');
  if (!button) return;

  if (state.runtime.generation.active) {
    setText(button, generationLabel(state.runtime.generation));
    return;
  }

  const input = $('#chat-input');
  const tokens = estimateTokens('x'.repeat((input?.value || '').length + contextChars()));
  const label = formatCompactCount(tokens);
  setText(button, label ? `Send (${label} tokens)` : 'Send');
}

function editingMessage() {
  const chat = currentChat();
  const index = state.session.editingMessageIndex;
  if (!chat || index === null) return null;
  return chat.messages[index] || null;
}

/**
 * The composer while a message is being edited. Until a block of the message
 * has been selected there is nothing to edit, so the composer is read-only and
 * says how to pick one; after that it holds the selected block's source.
 */
function renderComposerMode(chatInput, editingMsg) {
  if (!chatInput) return;
  const picking = Boolean(editingMsg) && !state.session.editingRange;
  chatInput.readOnly = picking;
  if (!editingMsg) chatInput.placeholder = PROMPT_PLACEHOLDER;
  else chatInput.placeholder = picking ? PICK_PLACEHOLDER : EDIT_PLACEHOLDER;
}

/** Show the composer or the settings editor, and the right buttons within. */
export function renderInputArea() {
  const settingsView = state.session.view !== 'chat';

  setHidden($('#composer-bar'), settingsView);
  setHidden($('#settings-bar'), !settingsView);

  if (settingsView) {
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
  // Retry regenerates from this message, so it only applies to the role that
  // can start a turn — the same test the non-editing retry button uses.
  setHidden($('#retry-edit-btn'), !editingMsg || !isRetryable(editingMsg));
  setHidden($('#cancel-edit-btn'), !editingMsg);

  setHidden($('#save-thinking-btn'), !editingThink);
  setHidden($('#cancel-thinking-btn'), !editingThink);

  const chatInput = $('#chat-input');
  const thinkInput = $('#thinking-input');

  setHidden(chatInput, editingThink);
  setHidden(thinkInput, !editingThink);

  if (chatInput && !editingThink) chatInput.disabled = false;
  if (thinkInput && editingThink) thinkInput.disabled = false;

  renderComposerMode(chatInput, editingMsg);
  renderSendButton();
}

/** Enable/disable the settings editor according to whether a key is selected. */
export function renderSettingsEditor() {
  const { activeSettingKey, view } = state.session;
  const editor = $('#settings-input');
  if (!editor) return;

  const hasSelection = Boolean(activeSettingKey);
  setDisabled(editor, !hasSelection);
  setDisabled($('#settings-save-btn'), !hasSelection);
  setDisabled($('#settings-reset-btn'), !hasSelection);
  setDisabled($('#settings-cancel-btn'), !hasSelection);

  if (!hasSelection) {
    editor.value = '';
    editor.placeholder = 'Select a setting above to edit...';
    return;
  }

  const schema = schemaFor(view === 'file-settings' ? 'file' : 'global');
  editor.placeholder = schema[activeSettingKey]?.tooltip || '';
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

/** Reflect embedding state on the per-file settings toolbar. */
export function renderEmbeddingToggle(fileId) {
  if (state.session.view !== 'file-settings' || state.session.activeFileId !== fileId) return;
  const button = $('[data-command="file.toggleEmbed"]');
  if (button) {
    button.textContent = isEmbedding(fileId) ? '⏸ Pause Embedding' : '▶ Start Embedding';
  }
}
