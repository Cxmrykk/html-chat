import { $, setHidden, setText, setDisabled } from '../dom.js';
import { state, currentChat, isEmbedding } from '../../store/state.js';
import { estimateTokens } from '../../core/tokens.js';
import { formatCompactCount, escapeHTML } from '../../core/format.js';
import { isSendable } from '../../core/roles.js';
import { schemaFor } from '../../services/settings.js';
import { availableModels } from '../../services/models.js';
import { DEFAULT_GOD_MODE_PROMPT } from '../../core/settings-schema.js';
import { isRetryable } from './message.js';

/** Input area components: composer and settings editor bars. */

/**
 * The model dropdown, driven by whatever `services/models.js` last
 * discovered (plus any manually configured extras). This never mutates
 * `lastModel` itself — `ensureActiveModel` in the models service owns that
 * reconciliation, so a render can never silently change the user's selection.
 */
export function updateModelDropdown() {
  const select = $('#model-select');
  if (!select) return;

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
  select.title = error ? `Model discovery failed: ${error}` : '';
}

/**
 * Cached estimated character count for conversation context. Only what is
 * actually sent counts: errors, thinking and un-run embed placeholders do not.
 */
function contextChars() {
  if (state.runtime.contextChars !== -1) return state.runtime.contextChars;

  let total = 0;
  const chat = currentChat();
  if (chat) {
    total = chat.messages.reduce(
      (sum, message) => (isSendable(message) ? sum + (message.content || '').length : sum),
      0,
    );
  }
  if (state.data.config.godMode) {
    total += (state.data.config.godModePrompt || DEFAULT_GOD_MODE_PROMPT).length;
  }

  state.runtime.contextChars = total;
  return total;
}

/**
 * The send button doubles as a token counter, and as the stop button while a
 * request is in flight.
 */
export function renderSendButton() {
  const button = $('#send-btn');
  if (!button) return;

  const { active, phase, loop, maxLoops } = state.runtime.generation;
  if (active) {
    const suffix = loop > 0 ? ` (Loop ${loop}/${maxLoops})` : '';
    const verb = phase === 'generating' ? 'Generating' : 'Thinking';
    setText(button, `${verb}${suffix}...`);
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

/** Show the composer or the settings editor, and the right buttons within. */
export function renderInputArea() {
  const settingsView = state.session.view !== 'chat';

  setHidden($('#composer-bar'), settingsView);
  setHidden($('#settings-bar'), !settingsView);

  if (settingsView) {
    renderSettingsEditor();
    return;
  }

  const editing = editingMessage();
  setHidden($('#model-select'), Boolean(editing));
  setHidden($('#send-btn'), Boolean(editing));
  setHidden($('#save-edit-btn'), !editing);
  // Retry regenerates from this message, so it only applies to the roles that
  // can start a turn — the same test the non-editing retry button uses.
  setHidden($('#retry-edit-btn'), !editing || !isRetryable(editing));
  setHidden($('#cancel-edit-btn'), !editing);

  const input = $('#chat-input');
  if (!input) return;
  input.disabled = false;
  input.placeholder = editing && editing.role === 'file' && editing.mode === 'embed'
    ? 'Type an embeddings prompt here. Default behavior: Uses subsequent user messages for search.'
    : 'Type your prompt here...';

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
