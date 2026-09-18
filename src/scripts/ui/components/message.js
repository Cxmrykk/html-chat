import { state } from '../../store/state.js';
import { escapeHTML, formatDuration } from '../../core/format.js';
import { isThinking, roleOptionsFor } from '../../core/roles.js';
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
  ICON_CHEVRON_DOWN,
  ICON_CHEVRON_UP,
} from '../icons.js';

/** A single message row: markup, in-place update, and the transient busy label. */

/**
 * Retrying resends the message and regenerates everything after it, so it only
 * means something for the two roles that can start a turn.
 */
export function isRetryable(message) {
  if (!message) return false;
  if (message.role === 'user') return true;
  return message.role === 'file' && message.mode === 'full';
}

/**
 * A thinking message is collapsed unless the user has opened it. Anything
 * without the flag (an import, say) counts as collapsed; a message being
 * edited is always shown in full so the text under edit stays visible.
 */
export function isCollapsedThinking(message, { editing = false } = {}) {
  return isThinking(message) && !editing && message.collapsed !== false;
}

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
  const btn = (cmd, label, icon) =>
    `<button data-command="${cmd}" title="${label}" class="icon-btn">${icon}</button>`;

  if (editing) {
    const buttons = [btn('message.saveEdit', 'Save', ICON_SAVE)];
    if (isRetryable(message)) {
      buttons.push(btn('message.retryEdit', 'Retry (save and regenerate)', ICON_RETRY));
    }
    buttons.push(
      btn('message.cancelEdit', 'Cancel', ICON_CANCEL),
      btn('message.toggleWrap', 'Toggle Wrap', ICON_WRAP),
    );
    return buttons.join('');
  }

  const isEmbed = message.role === 'file' && message.mode === 'embed';
  const editLabel = isEmbed ? 'Config' : 'Edit';
  const editIcon = isEmbed ? ICON_CONFIG : ICON_EDIT;

  const buttons = [];

  if (isRetryable(message)) {
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

function roleSelectHTML(message) {
  const options = roleOptionsFor(message.role)
    .map((value) => {
      const selected = value === message.role ? ' selected' : '';
      return `<option value="${escapeHTML(value)}"${selected}>${escapeHTML(value)}</option>`;
    })
    .join('');
  return `<select class="role-select">${options}</select>`;
}

function metaHTML(message) {
  if (message.role === 'file') {
    return `<span>FILE: ${escapeHTML(message.fileName)}</span>`;
  }
  return roleSelectHTML(message);
}

/** The markdown source shown for a message, whatever its role. */
function bodyOf(message) {
  if (message.role !== 'file') return message.content || '';
  if (message.mode === 'embed') return embedSummary(message);
  return `*Estimated file size: ~${message.approxTokens || 0} tokens*`;
}

function bodyHTML(message) {
  // Reasoning may draft `<run>` blocks; they never execute, so they must not
  // be headed "Executing Code".
  return renderMarkdown(bodyOf(message), { executed: !isThinking(message) });
}

/** "Thinking..." until the turn stamps a duration, then "Thought for 12s". */
function thinkingLabel(message) {
  if (!Number.isFinite(message.seconds)) return 'Thinking...';
  return `Thought for ${formatDuration(Math.max(1, message.seconds))}`;
}

/**
 * A thinking message. Collapsed, it is a single header row — label and
 * chevron — and carries no content node at all, so a long reasoning trace
 * costs nothing to render until someone opens it. The whole header toggles it;
 * the role select and action buttons only exist once it is open.
 */
function thinkingHTML(message, index, editing) {
  const collapsed = isCollapsedThinking(message, { editing });
  const hint = collapsed ? 'Show thinking' : 'Hide thinking';

  const toggle = `
    <button class="thinking-toggle" data-command="message.toggleThinking"
            aria-expanded="${collapsed ? 'false' : 'true'}" title="${hint}">
      <span>${escapeHTML(thinkingLabel(message))}</span>${collapsed ? ICON_CHEVRON_DOWN : ICON_CHEVRON_UP}
    </button>`;

  const actions = collapsed
    ? ''
    : `<div class="msg-actions">${roleSelectHTML(message)}${actionsHTML(message, editing)}</div>`;

  const content = collapsed ? '' : `<div class="msg-content">${bodyHTML(message)}</div>`;

  return `
    <div class="msg thinking${collapsed ? ' collapsed' : ''}${editing ? ' editing' : ''}" data-index="${index}">
      <div class="msg-meta" data-command="message.toggleThinking" title="${hint}">
        ${toggle}
        ${actions}
      </div>
      ${content}
    </div>`;
}

export function messageHTML(message, index, { editing = false } = {}) {
  if (isThinking(message)) return thinkingHTML(message, index, editing);

  const isEmbed = message.role === 'file' && message.mode === 'embed';
  const config = editing && isEmbed ? embedConfigHTML(message) : '';

  return `
    <div class="msg ${message.role}${editing ? ' editing' : ''}" data-index="${index}">
      <div class="msg-meta">
        ${metaHTML(message)}
        <div class="msg-actions">${actionsHTML(message, editing)}</div>
      </div>
      <div class="msg-content">${bodyHTML(message)}${config}</div>
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

/** Whether a message currently has a row in the transcript. */
export function hasMessageElement(index) {
  return Boolean(document.querySelector(`.msg[data-index="${index}"]`));
}

/** Swap a message's content only, for streaming updates. */
export function updateMessageContent(index, message, { final = true } = {}) {
  const element = document.querySelector(`.msg[data-index="${index}"] .msg-content`);
  if (!element) return null;
  element.innerHTML = bodyHTML(message);
  if (final) enhance(element);
  return element;
}

/** Replace a whole message element (role change, entering/leaving edit mode). */
export function replaceMessage(message, index, options) {
  const existing = document.querySelector(`.msg[data-index="${index}"]`);
  if (!existing) return null;

  const template = document.createElement('template');
  template.innerHTML = messageHTML(message, index, options).trim();
  existing.replaceWith(template.content.firstElementChild);
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
