import { state } from '../../store/state.js';
import { escapeHTML } from '../../core/format.js';
import { renderMarkdown, enhance } from '../markdown.js';
import {
  ICON_COPY,
  ICON_EDIT,
  ICON_CONFIG,
  ICON_FORK,
  ICON_RETRY,
  ICON_SAVE,
  ICON_CANCEL,
  ICON_WRAP,
  ICON_EMBED,
  ICON_DELETE,
} from '../icons.js';

/** A single message row: markup, in-place update, and the transient busy label. */

function embedSummary(message) {
  let summary =
    `*Estimated file size: ~${message.approxTokens || 0} tokens*<br>` +
    `*(<= ${message.maxTokens || 5000} tokens with embeddings enabled)*`;
  if (message.prompt) summary += `\n\n**Search Prompt:** ${message.prompt}`;
  return summary;
}

function embedConfigHTML(message) {
  return `
    <div class="embed-config">
      <label>Max Tokens
        <input type="number" class="embed-cfg-tokens" value="${message.maxTokens || 5000}">
      </label>
      <label>Match Threshold
        <input type="number" step="0.1" class="embed-cfg-threshold" value="${message.ragThreshold || 0.0}">
      </label>
    </div>`;
}

function actionsHTML(message, editing) {
  const useIcons = state.data.config.messageActionIcons === 'true';
  const btn = (cmd, label, icon) =>
    `<button data-command="${cmd}" title="${label}"${useIcons ? ' class="icon-btn"' : ''}>${useIcons ? icon : label}</button>`;

  if (editing) {
    return [
      btn('message.saveEdit', 'Save', ICON_SAVE),
      btn('message.cancelEdit', 'Cancel', ICON_CANCEL),
      btn('message.toggleWrap', 'Toggle Wrap', ICON_WRAP),
    ].join('');
  }

  const isEmbed = message.role === 'file' && message.mode === 'embed';
  const editLabel = isEmbed ? 'Config' : 'Edit';
  const editIcon = isEmbed ? ICON_CONFIG : ICON_EDIT;

  const buttons = [];

  const retryable = message.role === 'user' || (message.role === 'file' && message.mode === 'full');
  if (retryable) {
    buttons.push(btn('message.retry', 'Retry', ICON_RETRY));
  }

  buttons.push(
    btn('message.copy', 'Copy', ICON_COPY),
    btn('message.edit', editLabel, editIcon)
  );

  if (isEmbed) {
    buttons.push(btn('message.runEmbed', 'Embed', ICON_EMBED));
  }

  buttons.push(btn('message.fork', 'Fork', ICON_FORK));
  buttons.push(btn('message.delete', 'Delete', ICON_DELETE));

  return buttons.join('');
}

function metaHTML(message) {
  if (message.role === 'file') {
    return `<span>FILE: ${escapeHTML(message.fileName)}</span>`;
  }
  const option = (value) =>
    `<option value="${value}"${message.role === value ? ' selected' : ''}>${value}</option>`;
  const errorOption = message.role === 'error'
    ? '<option value="error" selected>error</option>'
    : '';
  return `<select class="role-select">
      ${option('user')}${option('assistant')}${option('system')}${errorOption}
    </select>`;
}

export function messageHTML(message, index, { editing = false } = {}) {
  let body = message.content || '';
  let config = '';

  if (message.role === 'file') {
    if (message.mode === 'embed') {
      body = embedSummary(message);
      if (editing) config = embedConfigHTML(message);
    } else {
      body = `*Estimated file size: ~${message.approxTokens || 0} tokens*`;
    }
  }

  return `
    <div class="msg ${message.role}${editing ? ' editing' : ''}" data-index="${index}">
      <div class="msg-meta">
        ${metaHTML(message)}
        <div class="msg-actions">${actionsHTML(message, editing)}</div>
      </div>
      <div class="msg-content">${renderMarkdown(body)}${config}</div>
    </div>`;
}

export function mountMessage(container, message, index, options) {
  const template = document.createElement('template');
  template.innerHTML = messageHTML(message, index, options).trim();
  const element = template.content.firstElementChild;
  container.appendChild(element);
  enhance(element);
  return element;
}

/** Swap a message's content only, for streaming updates. */
export function updateMessageContent(index, content, { final = true } = {}) {
  const element = document.querySelector(`.msg[data-index="${index}"] .msg-content`);
  if (!element) return null;
  element.innerHTML = renderMarkdown(content);
  if (final) enhance(element);
  return element;
}

/** Replace a whole message element (role change, entering/leaving edit mode). */
export function replaceMessage(message, index, options) {
  const existing = document.querySelector(`.msg[data-index="${index}"]`);
  if (!existing) return null;

  const template = document.createElement('template');
  template.innerHTML = messageHTML(message, index, options).trim();
  const element = existing.replaceWith(template.content.firstElementChild);
  const newElement = document.querySelector(`.msg[data-index="${index}"]`);
  enhance(newElement);
  return newElement;
}

/** Temporary label on an action button while a command runs. */
export function setMessageBusy(index, command, label) {
  const button = document.querySelector(
    `.msg[data-index="${index}"] button[data-command="${command}"]`,
  );
  if (!button) return () => {};
  const original = button.innerHTML;
  button.textContent = label;
  button.disabled = true;
  return () => {
    button.innerHTML = original;
    button.disabled = false;
  };
}
