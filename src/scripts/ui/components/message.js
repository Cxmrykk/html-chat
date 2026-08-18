import { escapeHTML } from '../../core/format.js';
import { renderMarkdown, enhance } from '../markdown.js';

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
  if (editing) {
    return [
      '<button data-command="message.saveEdit">Save</button>',
      '<button data-command="message.cancelEdit">Cancel</button>',
      '<button data-command="message.toggleWrap">Toggle Wrap</button>',
    ].join('');
  }

  const isEmbed = message.role === 'file' && message.mode === 'embed';
  const editLabel = isEmbed ? 'Config' : 'Edit';
  const buttons = [`<button data-command="message.edit">${editLabel}</button>`];

  if (isEmbed) {
    buttons.push('<button data-command="message.runEmbed">Embed</button>');
  }

  buttons.push('<button data-command="message.fork">Fork</button>');

  const retryable = message.role === 'user' || (message.role === 'file' && message.mode === 'full');
  if (retryable) {
    buttons.push('<button data-command="message.retry">Retry</button>');
  }

  buttons.push('<button data-command="message.delete">Delete</button>');

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
  const element = template.content.firstElementChild;
  existing.replaceWith(element);
  enhance(element);
  return element;
}

/** Temporary label on an action button while a command runs. */
export function setMessageBusy(index, command, label) {
  const button = document.querySelector(
    `.msg[data-index="${index}"] button[data-command="${command}"]`,
  );
  if (!button) return () => {};
  const original = button.textContent;
  button.textContent = label;
  button.disabled = true;
  return () => {
    button.textContent = original;
    button.disabled = false;
  };
}
