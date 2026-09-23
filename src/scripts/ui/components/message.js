import { escapeHTML, formatElapsed } from '../../core/format.js';
import { isThinking, isEditable, roleOptionsFor } from '../../core/roles.js';
import {
  roundsOf,
  roundHasOutput,
  hasOutput,
  hasReasoning,
  isCollapsible,
} from '../../core/thinking.js';
import {
  toolCallHeadline,
  toolCallRequestMarkdown,
  toolCallMarkdown,
  callStatusOf,
  callStatusNote,
} from '../../core/tools.js';
import {
  renderMarkdown,
  renderMarkdownBlocks,
  enhance,
  codeCollapseState,
  restoreCodeCollapseState,
} from '../markdown.js';
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
 * Whether the thinking message's own turn is still running. Its buttons are
 * hidden until then: retrying or deleting it would cut the transcript out
 * from under the loop.
 */
function isActive(message) {
  return Boolean(message?.active);
}

/**
 * Retrying resends and regenerates what comes after, so it means something
 * for the role that starts a turn, and for a finished thinking message with
 * something in it, which the turn then resumes.
 */
export function isRetryable(message) {
  if (message?.role === 'user') return true;
  return isThinking(message) && hasOutput(message) && !isActive(message);
}

/**
 * A thinking message with something in it is collapsed unless the user has
 * opened it. Anything without the flag (an import, say) counts as collapsed.
 */
export function isCollapsed(message, { editing = false } = {}) {
  return isCollapsible(message) && !editing && message.collapsed !== false;
}

/**
 * The markdown for a thinking message, round by round: the reasoning (unless
 * left out), the text written alongside the calls, then every call with its
 * result.
 */
function thinkingMarkdown(message, includeReasoning) {
  return roundsOf(message)
    .map((round) => {
      const parts = [];
      if (includeReasoning && round.thinking) parts.push(round.thinking);
      if (round.text) parts.push(round.text);
      for (const call of Array.isArray(round.calls) ? round.calls : []) {
        parts.push(toolCallMarkdown(call));
      }
      return parts.join('\n\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The markdown for a message: its text, or for a thinking message its rounds.
 * What "copy" and the transcript export use, so they match the screen.
 * `reasoning: false` leaves out the reasoning, keeping only what the model
 * was sent back.
 */
export function messageMarkdown(message, { reasoning = true } = {}) {
  if (isThinking(message)) return thinkingMarkdown(message, reasoning);
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

  // A single possible role gets plain text instead of a pointless dropdown.
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

/**
 * A thinking message renders its rounds. Anything else renders its text as
 * markdown blocks, each traceable to its span of the source, which is what
 * lets an edit pick out part of the message by clicking it.
 */
function bodyHTML(message) {
  if (isThinking(message)) return thinkingBodyHTML(message);
  return renderMarkdownBlocks(messageMarkdown(message));
}

/* ------------------------------------------------------------------ *
 * Tool calls
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

/* ------------------------------------------------------------------ *
 * Thinking message
 * ------------------------------------------------------------------ */

const ROUND_NOTES = { stopped: 'Stopped here.', failed: 'Failed here.' };

/**
 * One round: its reasoning, the text written alongside its calls, the calls,
 * and where the turn ended if it ended here. Calls are keyed by position in
 * the whole message (`"round.call"`), so an empty round renders nothing but
 * still keeps its place in the numbering.
 */
function roundHTML(round, roundIndex) {
  if (!roundHasOutput(round)) return '';

  const parts = [];
  if (round.thinking) {
    parts.push(`<div class="thinking-reasoning">${renderMarkdown(round.thinking)}</div>`);
  }
  if (round.text) {
    parts.push(`<div class="thinking-text">${renderMarkdown(round.text)}</div>`);
  }

  const calls = Array.isArray(round.calls) ? round.calls : [];
  if (calls.length) {
    const rows = calls.map((call, callIndex) => toolCallHTML(call, `${roundIndex}.${callIndex}`));
    parts.push(`<div class="tool-calls">${rows.join('')}</div>`);
  }

  const note = ROUND_NOTES[round.outcome];
  if (note) parts.push(`<p class="round-note">${escapeHTML(note)}</p>`);

  return `<div class="thinking-round">${parts.join('')}</div>`;
}

function thinkingBodyHTML(message) {
  return roundsOf(message).map(roundHTML).join('');
}

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
 * reply ever came. Messages from before timing existed have no duration at all.
 */
function thinkingLabelHTML(message) {
  if (isWaiting(message)) return `Thinking... ${liveElapsedHTML(message.startedAt)}`;
  if (message.outcome === 'interrupted') return 'Interrupted';
  const reasoned = hasReasoning(message);
  if (Number.isFinite(message.seconds)) {
    const verb = WAIT_OUTCOMES[message.outcome] || (reasoned ? 'Thought for' : 'Responded after');
    return `${verb} ${elapsedHTML(message.seconds)}`;
  }
  return reasoned ? 'Thought' : 'Thinking';
}

/**
 * The thinking message. With anything in it — reasoning, text or calls — it
 * is a collapsible header that carries no content node until opened, so a
 * long reasoning trace costs nothing to render until someone asks for it.
 * Without anything it is a plain header with nothing to open. Its buttons
 * appear once it holds something and its turn is over.
 */
function thinkingHTML(message, index) {
  const expandable = isCollapsible(message);
  const collapsed = isCollapsed(message);
  const showBody = expandable && !collapsed;
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

  const actions = expandable && !isActive(message) ? actionsBarHTML(message, false) : '';

  const classes = ['msg', 'thinking', expandable ? 'collapsible' : 'static'];
  if (collapsed) classes.push('collapsed');
  if (!showBody) classes.push('headline-only');

  return `
    <div class="${classes.join(' ')}" data-index="${index}">
      ${actions}
      ${meta}
      ${showBody ? `<div class="msg-content">${bodyHTML(message)}</div>` : ''}
    </div>`;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export function messageHTML(message, index, { editing = false } = {}) {
  if (isThinking(message)) return thinkingHTML(message, index);

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

/**
 * Replace a whole message element (role change, entering/leaving edit mode).
 * Code blocks the user opened or closed keep that state in the new row, so
 * starting or ending an edit leaves the transcript looking exactly as it was.
 */
export function replaceMessage(message, index, options) {
  const existing = document.querySelector(`.msg[data-index="${index}"]`);
  if (!existing) return null;

  const codeState = codeCollapseState(existing);

  const template = document.createElement('template');
  template.innerHTML = messageHTML(message, index, options).trim();
  existing.replaceWith(template.content.firstElementChild);
  const newElement = document.querySelector(`.msg[data-index="${index}"]`);
  enhance(newElement);
  restoreCodeCollapseState(newElement, codeState);
  return newElement;
}
