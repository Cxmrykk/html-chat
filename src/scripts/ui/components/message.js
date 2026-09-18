import { escapeHTML, formatDuration } from '../../core/format.js';
import {
  isThinking,
  isCollapsible,
  hasToolCalls,
  roleOptionsFor,
} from '../../core/roles.js';
import { toolCallMarkdown, toolResultLabel } from '../../core/tools.js';
import { renderMarkdown, enhance } from '../markdown.js';
import {
  ICON_COPY,
  ICON_EDIT,
  ICON_FORK,
  ICON_RETRY,
  ICON_SAVE,
  ICON_CANCEL,
  ICON_WRAP,
  ICON_DELETE,
  ICON_CHEVRON_DOWN,
  ICON_CHEVRON_UP,
} from '../icons.js';

/** A single message row: its markup and its in-place updates. */

/**
 * Retrying resends the message and regenerates everything after it, so it only
 * means something for the role that starts a turn.
 */
export function isRetryable(message) {
  return message?.role === 'user';
}

/**
 * A thinking box or a tool result is collapsed unless the user has opened it.
 * Anything without the flag (an import, say) counts as collapsed; a message
 * being edited is always shown in full so the text under edit stays visible.
 */
export function isCollapsed(message, { editing = false } = {}) {
  return isCollapsible(message) && !editing && message.collapsed !== false;
}

/**
 * The markdown shown for a message: its text, then any tool calls it made.
 * Also what "copy" and the transcript export use, so they match the screen.
 */
export function messageMarkdown(message) {
  const parts = [message?.content || ''];
  if (hasToolCalls(message)) parts.push(...message.toolCalls.map(toolCallMarkdown));
  return parts.filter(Boolean).join('\n\n');
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

  const buttons = [];
  if (isRetryable(message)) buttons.push(btn('message.retry', 'Retry', ICON_RETRY));
  buttons.push(
    btn('message.copy', 'Copy', ICON_COPY),
    btn('message.edit', 'Edit', ICON_EDIT),
    btn('message.fork', 'Fork', ICON_FORK),
    btn('message.delete', 'Delete', ICON_DELETE),
  );
  return buttons.join('');
}

function roleSelectHTML(message) {
  // A collapsible box already has a label ("Thinking", "JavaScript Result"),
  // so the role is obvious and doesn't need to be rendered in the actions area.
  if (isCollapsible(message)) return '';

  const options = roleOptionsFor(message);
  
  // If the role is locked (like an assistant message with tool calls), 
  // just show plain text instead of a pointless single-option dropdown.
  if (options.length === 1) {
    return `<span>${escapeHTML(options[0])}</span>`;
  }

  const optionsHTML = options
    .map((value) => {
      const selected = value === message.role ? ' selected' : '';
      return `<option value="${escapeHTML(value)}"${selected}>${escapeHTML(value)}</option>`;
    })
    .join('');
  return `<select class="role-select">${optionsHTML}</select>`;
}

function bodyHTML(message) {
  return renderMarkdown(messageMarkdown(message));
}

/** "Thinking..." until the turn stamps a duration, then "Thought for 12s". */
function thinkingLabel(message) {
  if (!Number.isFinite(message.seconds)) return 'Thinking...';
  return `Thought for ${formatDuration(Math.max(1, message.seconds))}`;
}

function collapsibleLabel(message) {
  return isThinking(message) ? thinkingLabel(message) : toolResultLabel(message.name);
}

/**
 * A thinking box or a tool result. Collapsed, it is a single header row —
 * label and chevron — and carries no content node at all, so a long reasoning
 * trace or a page of search results costs nothing to render until someone
 * opens it. The whole header toggles it; the role select and action buttons
 * only exist once it is open.
 */
function collapsibleHTML(message, index, editing) {
  const collapsed = isCollapsed(message, { editing });
  const noun = isThinking(message) ? 'thinking' : 'result';
  const hint = collapsed ? `Show ${noun}` : `Hide ${noun}`;

  const toggle = `
    <button class="collapse-toggle" data-command="message.toggleCollapsed"
            aria-expanded="${collapsed ? 'false' : 'true'}" title="${hint}">
      <span>${escapeHTML(collapsibleLabel(message))}</span>${collapsed ? ICON_CHEVRON_DOWN : ICON_CHEVRON_UP}
    </button>`;

  const actions = collapsed
    ? ''
    : `<div class="msg-actions">${roleSelectHTML(message)}${actionsHTML(message, editing)}</div>`;

  const content = collapsed ? '' : `<div class="msg-content">${bodyHTML(message)}</div>`;

  return `
    <div class="msg ${escapeHTML(message.role)} collapsible${collapsed ? ' collapsed' : ''}${editing ? ' editing' : ''}" data-index="${index}">
      <div class="msg-meta" data-command="message.toggleCollapsed" title="${hint}">
        ${toggle}
        ${actions}
      </div>
      ${content}
    </div>`;
}

export function messageHTML(message, index, { editing = false } = {}) {
  if (isCollapsible(message)) return collapsibleHTML(message, index, editing);

  return `
    <div class="msg ${escapeHTML(message.role)}${editing ? ' editing' : ''}" data-index="${index}">
      <div class="msg-meta">
        ${roleSelectHTML(message)}
        <div class="msg-actions">${actionsHTML(message, editing)}</div>
      </div>
      <div class="msg-content">${bodyHTML(message)}</div>
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
