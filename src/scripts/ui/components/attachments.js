import { $, fromHTML } from '../dom.js';
import { state, currentChat } from '../../store/state.js';
import { escapeHTML } from '../../core/format.js';
import { attachmentsOf } from '../../core/attachments.js';
import { callAt } from '../../core/thinking.js';
import { imageUrlFor, imageStatus, requestImage } from '../../services/images.js';
import {
  ICON_CHEVRON_DOWN,
  ICON_CHEVRON_UP,
  ICON_DELETE,
  ICON_CANCEL,
  ICON_PAPERCLIP,
  ICON_COPY,
  ICON_DOWNLOAD,
  ICON_UPLOAD,
} from '../icons.js';

/**
 * A message's attachments: a drop-down at the bottom of the row, and inside it
 * one square per image, tiled in two columns. A tool call that made images
 * shows them the same way, in a strip of its own (`components/message.js`).
 *
 * In the grid every square shows its whole image: nothing scrolls or zooms
 * there. A click opens an image (`attachments.expand`): the grid shows it
 * alone, as wide as the whole area, in a square that scrolls vertically when
 * the image is taller than it is wide. Over it, outside the scrolling part,
 * X closes it (top-left), and download and copy sit top-right; for a
 * placeholder, whose original is gone, those two are greyed out and a restore
 * button comes first.
 *
 * Which image is open is session state (`state.session.expandedImage`), not
 * markup: rows are redrawn all the time while a reply streams, so after any
 * render `syncExpandedImage` finds the image again, by position and hash, and
 * gives back the scroll it had.
 *
 * While its message is being edited, a grid image carries a row of buttons
 * in its top-right corner: move earlier, move later, replace, remove. Under
 * every image, a caption carries its tag, `[name]`, on the left and its
 * dimensions on the right. Once the original is known to be gone, the tag
 * turns red and reads `(!) [name]`.
 */

const NOT_STORED = 'Only a placeholder of this image is stored: restore the original first';

function sizeLabel(attachment) {
  return `${attachment.width}×${attachment.height}`;
}

function iconButton(command, title, icon, { key = '', disabled = false, extra = '' } = {}) {
  return `<button class="icon-btn${extra ? ` ${extra}` : ''}" data-command="${command}"${
    key ? ` data-key="${key}"` : ''
  } title="${escapeHTML(title)}"${disabled ? ' disabled' : ''}>${icon}</button>`;
}

/**
 * The corner buttons of an image in a message being edited. `data-key` is the
 * step a move takes; the ends of the list cannot move further out.
 */
function editActionsHTML(at, count) {
  return `
    <div class="attachment-actions">
      ${iconButton('attachments.move', 'Move earlier', ICON_CHEVRON_UP, { key: '-1', disabled: at === 0 })}
      ${iconButton('attachments.move', 'Move later', ICON_CHEVRON_DOWN, { key: '1', disabled: at >= count - 1 })}
      ${iconButton('attachments.replace', 'Replace this image', ICON_UPLOAD)}
      ${iconButton('attachments.remove', 'Remove this image', ICON_DELETE)}
    </div>`;
}

/** The buttons of an open image: close on the left, its actions on the right. */
function viewToolsHTML(placeholder) {
  return `
    <div class="attachment-view-tools">
      ${iconButton('attachments.collapse', 'Close (Esc)', ICON_CANCEL, { extra: 'attachment-close' })}
      <div class="attachment-view-actions">
        ${placeholder ? iconButton('attachments.restore', 'Restore the original from a file', ICON_UPLOAD) : ''}
        ${iconButton('attachments.download', placeholder ? NOT_STORED : 'Download', ICON_DOWNLOAD, { disabled: placeholder })}
        ${iconButton('attachments.copy', placeholder ? NOT_STORED : 'Copy the image', ICON_COPY, { disabled: placeholder })}
      </div>
    </div>`;
}

/**
 * One image, `at` of `count`. Looks for its original the first time it is
 * drawn.
 */
export function attachmentItemHTML(attachment, at, { editing = false, count = 1 } = {}) {
  let url = imageUrlFor(attachment.hash);
  if (!url) requestImage(attachment.hash);
  url = imageUrlFor(attachment.hash);
  const placeholder = !url;
  // Red only once the lookup is over, so a cached original never flashes red.
  const missing = placeholder && imageStatus(attachment.hash) === 'missing';

  const hint = placeholder
    ? 'Placeholder: click to open it, and restore the original from there'
    : 'Click to open';

  // The aspect ratio gives an opened image its height before it has loaded,
  // so its scroll can be given back straight away.
  const image = `<img class="attachment-image${placeholder ? ' pixelated' : ''}"
      src="${escapeHTML(url || attachment.placeholder)}" alt="${escapeHTML(attachment.name)}"
      style="aspect-ratio: ${attachment.width} / ${attachment.height}" draggable="false"
      data-command="attachments.expand" title="${escapeHTML(hint)}">`;

  const tagTitle = missing
    ? `${attachment.name} (placeholder: the original is not stored)`
    : attachment.name;

  const classes = ['attachment'];
  if (placeholder) classes.push('is-placeholder');
  if (missing) classes.push('is-missing');
  if (editing) classes.push('is-editable');

  return `
    <figure class="${classes.join(' ')}" data-attachment="${at}"
            data-hash="${escapeHTML(attachment.hash)}">
      <div class="attachment-frame">
        <div class="attachment-viewer">${image}</div>
        ${editing ? editActionsHTML(at, count) : ''}
        ${viewToolsHTML(placeholder)}
      </div>
      <figcaption class="attachment-caption">
        <span class="attachment-tag" title="${escapeHTML(tagTitle)}">${
          missing ? '<span class="attachment-flag">(!)&nbsp;</span>' : ''
        }<span>[</span><span class="attachment-name">${escapeHTML(attachment.name)}</span><span>]</span></span>
        <span class="attachment-size">${escapeHTML(sizeLabel(attachment))}</span>
      </figcaption>
    </figure>`;
}

/**
 * The drop-down, or nothing for a message without images. Closed unless
 * opened. Its header is built like a tool call's: an icon, the label, and the
 * chevron at the far end.
 */
export function attachmentsHTML(message, { editing = false } = {}) {
  const list = attachmentsOf(message);
  if (!list.length) return '';

  const open = message.attachmentsOpen === true;
  const hint = open ? 'Hide attachments' : 'Show attachments';
  const body = open
    ? `<div class="attachments-body">${list
        .map((attachment, at) => attachmentItemHTML(attachment, at, { editing, count: list.length }))
        .join('')}</div>`
    : '';

  return `
    <div class="attachments${open ? ' open' : ''}">
      <button class="attachments-header" data-command="message.toggleAttachments"
              aria-expanded="${open ? 'true' : 'false'}" title="${hint}">
        <span class="attachments-icon" aria-hidden="true">${ICON_PAPERCLIP}</span>
        <span class="attachments-label">Attachments (${list.length})</span>
        ${open ? ICON_CHEVRON_UP : ICON_CHEVRON_DOWN}
      </button>
      ${body}
    </div>`;
}

/* ------------------------------------------------------------------ *
 * The open image
 * ------------------------------------------------------------------ */

/**
 * The figure of the open image, if it is on screen: in the open chat, in the
 * row, call and position it was opened at, and still the same image (a
 * deleted message shifts every index after it).
 */
function expandedFigure(container) {
  const wanted = state.session.expandedImage;
  if (!wanted || state.session.view !== 'chat') return null;
  if (wanted.chatId !== state.data.currentChatId) return null;

  const row = container.querySelector(`.msg[data-index="${wanted.index}"]`);
  if (!row) return null;
  const grid = wanted.call
    ? row.querySelector(`.tool-call[data-call="${CSS.escape(wanted.call)}"] > .tool-call-images`)
    : row.querySelector(':scope > .attachments > .attachments-body');
  const figure = grid?.querySelector(`:scope > .attachment[data-attachment="${wanted.at}"]`);
  return figure && figure.dataset.hash === wanted.hash ? figure : null;
}

/**
 * Show the open image as open, and every other as not. Idempotent and cheap:
 * called after any render that may have rebuilt a row. An image opened again
 * after a redraw gets back the scroll it had.
 */
export function syncExpandedImage() {
  const container = $('#chat-container');
  if (!container) return;

  const target = expandedFigure(container);
  for (const figure of container.querySelectorAll('.attachment.expanded')) {
    if (figure !== target) figure.classList.remove('expanded');
  }
  for (const grid of container.querySelectorAll('.has-expanded')) {
    if (!target || grid !== target.parentElement) grid.classList.remove('has-expanded');
  }
  if (!target || target.classList.contains('expanded')) return;

  target.classList.add('expanded');
  target.parentElement?.classList.add('has-expanded');
  const viewer = target.querySelector('.attachment-viewer');
  if (viewer) viewer.scrollTop = state.session.expandedImage?.scrollTop || 0;
}

/** Keep the open image's scroll, so a redraw can give it back. */
export function rememberExpandedScroll(viewer) {
  const wanted = state.session.expandedImage;
  if (wanted && viewer?.closest('.attachment.expanded')) wanted.scrollTop = viewer.scrollTop;
}

/**
 * Redraw every shown image with this hash, after its original was found,
 * found missing, or restored. Only the image itself is replaced. An image a
 * tool call made is looked up on that call, and is never editable.
 */
export function syncAttachmentImages(hash) {
  const container = $('#chat-container');
  if (!container) return;
  const messages = currentChat()?.messages || [];
  const selector = `.attachment[data-hash="${CSS.escape(hash)}"]`;

  for (const figure of container.querySelectorAll(selector)) {
    const row = figure.closest('.msg[data-index]');
    const index = Number.parseInt(row?.dataset.index, 10);
    const at = Number.parseInt(figure.dataset.attachment, 10);
    const callKey = figure.closest('[data-call]')?.dataset.call;
    const holder = callKey ? callAt(messages[index], callKey) : messages[index];
    const list = attachmentsOf(holder);
    const attachment = list[at];
    if (!attachment) continue;
    const editing = !callKey && state.session.editingMessageIndex === index;
    figure.replaceWith(
      fromHTML(attachmentItemHTML(attachment, at, { editing, count: list.length })),
    );
  }
  syncExpandedImage();
}

/** The composer's images waiting to be sent, as removable chips. */
export function composerAttachmentsHTML(list) {
  return list
    .map((attachment, at) => {
      const url = imageUrlFor(attachment.hash);
      return `
        <span class="composer-attachment" title="${escapeHTML(`${attachment.name} (${sizeLabel(attachment)})`)}">
          <img src="${escapeHTML(url || attachment.placeholder)}" alt=""
               class="${url ? '' : 'pixelated'}" draggable="false">
          <span class="composer-attachment-name">${escapeHTML(attachment.name)}</span>
          <button data-command="attachments.removePending" data-key="${at}" title="Remove">${ICON_CANCEL}</button>
        </span>`;
    })
    .join('');
}
