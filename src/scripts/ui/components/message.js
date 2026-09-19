import { escapeHTML, formatElapsed } from '../../core/format.js';
import {
  isThinking,
  isTools,
  isCollapsible,
  isEditable,
  roleOptionsFor,
} from '../../core/roles.js';
import { callsOf } from '../../core/tool-calls.js';
import {
  toolCallHeadline,
  toolCallRequestMarkdown,
  toolCallMarkdown,
  callStatusOf,
  callStatusNote,
} from '../../core/tools.js';
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
  ICON_CHECK,
  ICON_CIRCLE,
  ICON_LOADER,
  ICON_SQUARE,
  ICON_MINUS,
  ICON_ALERT,
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
 * A thinking box with reasoning in it is collapsed unless the user has opened
 * it. Anything without the flag (an import, say) counts as collapsed; a
 * message being edited is always shown in full so the text under edit stays
 * visible.
 */
export function isCollapsed(message, { editing = false } = {}) {
  return isCollapsible(message) && !editing && message.collapsed !== false;
}

/**
 * The markdown for a message: its text, or for a tools box every call with its
 * result. What "copy" and the transcript export use, so they match the screen.
 */
export function messageMarkdown(message) {
  if (isTools(message)) return callsOf(message).map(toolCallMarkdown).join('\n\n');
  return message?.content || '';
}

/* ------------------------------------------------------------------ *
 * Shared pieces
 * ------------------------------------------------------------------ */

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
  buttons.push(btn('message.copy', 'Copy', ICON_COPY));
  if (isEditable(message)) buttons.push(btn('message.edit', 'Edit', ICON_EDIT));
  buttons.push(
    btn('message.fork', 'Fork', ICON_FORK),
    btn('message.delete', 'Delete', ICON_DELETE),
  );
  return buttons.join('');
}

function actionsBarHTML(message, editing) {
  return `<div class="msg-actions-container"><div class="msg-actions">${actionsHTML(message, editing)}</div></div>`;
}

/** The role dropdown of an ordinary message. */
function roleSelectHTML(message) {
  const options = roleOptionsFor(message);

  // A locked role gets plain text instead of a pointless single-option dropdown.
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

/**
 * A counter that `ui/ticker.js` keeps current while a turn runs. It carries
 * the moment the wait began; the text rendered here is only its first frame.
 */
function liveElapsedHTML(startedAt) {
  const seconds = (Date.now() - startedAt) / 1000;
  return `<span class="elapsed" data-started-at="${startedAt}">${escapeHTML(formatElapsed(seconds))}</span>`;
}

/** A finished duration: no timestamp, so the ticker leaves it alone. */
function elapsedHTML(seconds) {
  return `<span class="elapsed">${escapeHTML(formatElapsed(seconds))}</span>`;
}

function bodyHTML(message) {
  if (isTools(message)) return toolsBodyHTML(message);
  return renderMarkdown(messageMarkdown(message));
}

/* ------------------------------------------------------------------ *
 * Thinking box
 * ------------------------------------------------------------------ */

/** Still counting: the wait began and has neither ended nor been cut off. */
function isWaiting(message) {
  return (
    Number.isFinite(message.startedAt) && !Number.isFinite(message.seconds) && !message.outcome
  );
}

const WAIT_OUTCOMES = { stopped: 'Stopped after', failed: 'Failed after' };

/**
 * "Thinking... 2.4s" while waiting. Afterwards: "Thought for" when the model
 * reasoned, "Responded after" when it did not, or how the wait ended if no
 * reply ever came. Boxes from before timing existed have no duration at all.
 */
function thinkingLabelHTML(message) {
  if (isWaiting(message)) return `Thinking... ${liveElapsedHTML(message.startedAt)}`;
  if (message.outcome === 'interrupted') return 'Interrupted';
  if (Number.isFinite(message.seconds)) {
    const verb =
      WAIT_OUTCOMES[message.outcome] || (message.content ? 'Thought for' : 'Responded after');
    return `${verb} ${elapsedHTML(message.seconds)}`;
  }
  return message.content ? 'Thought' : 'Thinking';
}

/**
 * The thinking box. With reasoning in it, it is a collapsible header that
 * carries no content node until opened, so a long reasoning trace costs
 * nothing to render until someone asks for it. Without reasoning it is a plain
 * header with nothing to open. Actions appear whenever the box is not folded.
 */
function thinkingHTML(message, index, editing) {
  const expandable = isCollapsible(message);
  const collapsed = isCollapsed(message, { editing });
  const showBody = editing || (expandable && !collapsed);
  const label = `<span class="collapse-label">${thinkingLabelHTML(message)}</span>`;

  let meta;
  if (expandable) {
    const hint = collapsed ? 'Show thinking' : 'Hide thinking';
    meta = `
      <div class="msg-meta" data-command="message.toggleCollapsed" title="${hint}">
        <button class="collapse-toggle" data-command="message.toggleCollapsed"
                aria-expanded="${collapsed ? 'false' : 'true'}" title="${hint}">
          ${label}${collapsed ? ICON_CHEVRON_DOWN : ICON_CHEVRON_UP}
        </button>
      </div>`;
  } else {
    meta = `<div class="msg-meta">${label}</div>`;
  }

  const classes = ['msg', 'thinking', expandable ? 'collapsible' : 'static'];
  if (collapsed) classes.push('collapsed');
  if (!showBody) classes.push('headline-only');
  if (editing) classes.push('editing');

  return `
    <div class="${classes.join(' ')}" data-index="${index}">
      ${meta}
      ${showBody ? `<div class="msg-content">${bodyHTML(message)}</div>` : ''}
    </div>`;
}

/* ------------------------------------------------------------------ *
 * Tools box
 * ------------------------------------------------------------------ */

function toolCallStatusIcon(status) {
  switch (status) {
    case 'pending': return ICON_CIRCLE;
    case 'running': return ICON_LOADER;
    case 'done': return ICON_CHECK;
    case 'error': return ICON_CANCEL;
    case 'stopped': return ICON_SQUARE;
    case 'skipped': return ICON_MINUS;
    case 'interrupted': return ICON_ALERT;
    default: return '';
  }
}

/** The right-hand side of a call's header: a live counter, a duration, or its fate. */
function callTimeHTML(call, status) {
  const took = Number.isFinite(call.seconds) ? elapsedHTML(call.seconds) : '';
  switch (status) {
    case 'running':
      return Number.isFinite(call.startedAt) ? liveElapsedHTML(call.startedAt) : '';
    case 'done':
      return took;
    case 'error':
      return took ? `failed · ${took}` : 'failed';
    case 'stopped':
      return took ? `stopped · ${took}` : 'stopped';
    case 'skipped':
      return 'not run';
    case 'interrupted':
      return 'interrupted';
    default:
      return '';
  }
}

/** What an opened call shows: the code it ran (if any), then its result. */
function toolCallBodyHTML(call, status) {
  const parts = [];
  const request = toolCallRequestMarkdown(call);
  if (request) parts.push(`<div class="tool-call-request">${renderMarkdown(request)}</div>`);

  if (typeof call.result === 'string') {
    parts.push(`<div class="tool-call-result">${renderMarkdown(call.result || '*Empty result.*')}</div>`);
  } else {
    parts.push(`<p class="tool-call-note">${escapeHTML(callStatusNote(status))}</p>`);
  }
  return parts.join('');
}

/**
 * One call: a header row reading what the call does (the search query, or the
 * first line of the code), its status and its time. Clicking the header opens
 * the details; a closed call renders no details at all.
 */
function toolCallHTML(call, key) {
  const status = callStatusOf(call);
  const collapsed = call.collapsed !== false;
  const { verb, detail, scope } = toolCallHeadline(call);
  const hint = collapsed ? 'Show details' : 'Hide details';
  const title = `${verb}${scope ? ` in ${scope}` : ''}${detail ? ':' : ''}`;
  const time = callTimeHTML(call, status);

  const header = `
    <button class="tool-call-header" data-command="message.toggleCall"
            aria-expanded="${collapsed ? 'false' : 'true'}" title="${hint}">
      <span class="tool-call-status" aria-hidden="true">${toolCallStatusIcon(status)}</span>
      <span class="tool-call-text"><span class="tool-call-verb">${escapeHTML(title)}</span>${
        detail ? ` <span class="tool-call-detail">${escapeHTML(detail)}</span>` : ''
      }</span>
      ${time ? `<span class="tool-call-time">${time}</span>` : ''}
      ${collapsed ? ICON_CHEVRON_DOWN : ICON_CHEVRON_UP}
    </button>`;

  const body = collapsed ? '' : `<div class="tool-call-body">${toolCallBodyHTML(call, status)}</div>`;

  return `
    <div class="tool-call status-${status}${collapsed ? ' collapsed' : ''}" data-call="${escapeHTML(key)}">
      ${header}
      ${body}
    </div>`;
}

/** Every call of every round, keyed by position (`"round.call"`). */
function toolsBodyHTML(message) {
  const rows = [];
  (Array.isArray(message.rounds) ? message.rounds : []).forEach((round, roundIndex) => {
    (Array.isArray(round?.calls) ? round.calls : []).forEach((call, callIndex) => {
      rows.push(toolCallHTML(call, `${roundIndex}.${callIndex}`));
    });
  });
  return rows.join('') || '<p class="tool-call-note">No tool calls.</p>';
}

/**
 * The tools box: one green message holding every call of one or more
 * consecutive rounds, JavaScript and file search alike. It is never folded
 * itself; its calls are.
 */
function toolsHTML(message, index) {
  return `
    <div class="msg tools" data-index="${index}">
      ${actionsBarHTML(message, false)}
      <div class="msg-meta"><span>Tools</span></div>
      <div class="msg-content">${bodyHTML(message)}</div>
    </div>`;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export function messageHTML(message, index, { editing = false } = {}) {
  if (isThinking(message)) return thinkingHTML(message, index, editing);
  if (isTools(message)) return toolsHTML(message, index);

  return `
    <div class="msg ${escapeHTML(message.role)}${editing ? ' editing' : ''}" data-index="${index}">
      ${actionsBarHTML(message, editing)}
      <div class="msg-meta">
        ${roleSelectHTML(message)}
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
  const element = document.querySelector(`.msg[data-index="${index}"] > .msg-content`);
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
