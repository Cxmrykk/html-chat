import { $, fromHTML } from '../dom.js';
import { state, currentChat } from '../../store/state.js';
import { escapeHTML } from '../../core/format.js';
import { attachmentsOf } from '../../core/attachments.js';
import { imageUrlFor, imageStatus, requestImage } from '../../services/images.js';
import {
  ICON_CHEVRON_DOWN,
  ICON_CHEVRON_UP,
  ICON_DELETE,
  ICON_CANCEL,
  ICON_PAPERCLIP,
} from '../icons.js';

/**
 * A message's attachments: a drop-down at the bottom of the row, and inside it
 * one square viewer per image, tiled in two columns.
 *
 * Every viewer is 1:1 and as wide as its column. The image fills the viewer's
 * width: a landscape image sits centred in the square, a portrait one scrolls
 * vertically. Zooming (`setAttachmentZoom`) scales the image within it.
 *
 * Nothing is drawn over the image except, while its message is being edited,
 * a row of buttons in the top-right corner: move earlier, move later, remove.
 * Under it, a caption carries the image's tag, `[name]`, on the left and its
 * dimensions on the right. Once the original is known to be gone, the tag
 * turns red and reads `(!) [name]`.
 *
 * A click on an image means one of two things:
 *
 *   - while its message is being edited, replace it (`attachments.replace`);
 *   - otherwise, if it is a placeholder, restore its original
 *     (`attachments.restore`).
 *
 * The image's tooltip says which.
 */

const MAX_ZOOM = 8;
const ZOOM_HINT = 'Pinch or Ctrl+Scroll to zoom';

function sizeLabel(attachment) {
  return `${attachment.width}×${attachment.height}`;
}

/** What a click on the image does, for its tooltip; empty when it does nothing. */
function clickHint(placeholder, editing) {
  if (editing) return 'Click to replace this image';
  return placeholder ? 'Placeholder: click to restore the original image' : '';
}

/**
 * The corner buttons of an image in a message being edited. `data-key` is the
 * step a move takes; the ends of the list cannot move further out.
 */
function actionsHTML(at, count) {
  const btn = (command, title, icon, { key = '', disabled = false } = {}) =>
    `<button class="icon-btn" data-command="${command}"${key ? ` data-key="${key}"` : ''}
             title="${title}"${disabled ? ' disabled' : ''}>${icon}</button>`;

  return `
    <div class="attachment-actions">
      ${btn('attachments.move', 'Move earlier', ICON_CHEVRON_UP, { key: '-1', disabled: at === 0 })}
      ${btn('attachments.move', 'Move later', ICON_CHEVRON_DOWN, { key: '1', disabled: at >= count - 1 })}
      ${btn('attachments.remove', 'Remove this image', ICON_DELETE)}
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

  // Zooming out stops when the whole image fits the square: narrower than it
  // for a portrait image, full width for any other.
  const minZoom = Math.min(1, attachment.width / attachment.height);

  const command = editing
    ? 'attachments.replace'
    : placeholder
      ? 'attachments.restore'
      : '';
  const hint = clickHint(placeholder, editing);

  const image = `<img class="attachment-image${placeholder ? ' pixelated' : ''}"
      src="${escapeHTML(url || attachment.placeholder)}" alt="${escapeHTML(attachment.name)}"
      style="aspect-ratio: ${attachment.width} / ${attachment.height}" draggable="false"${
        command ? ` data-command="${command}"` : ''
      }${hint ? ` title="${escapeHTML(hint)}"` : ''}>`;

  const viewerHint = [ZOOM_HINT, editing || placeholder ? '' : 'double-click to reset']
    .filter(Boolean)
    .join(' · ');

  const tagTitle = missing
    ? `${attachment.name} (placeholder: the original is not stored)`
    : attachment.name;

  const classes = ['attachment'];
  if (placeholder) classes.push('is-placeholder');
  if (missing) classes.push('is-missing');
  if (editing) classes.push('is-replaceable');

  return `
    <figure class="${classes.join(' ')}" data-attachment="${at}"
            data-hash="${escapeHTML(attachment.hash)}">
      <div class="attachment-frame">
        <div class="attachment-viewer" data-zoom="1" data-min-zoom="${minZoom}"
             title="${escapeHTML(viewerHint)}">${image}</div>
        ${editing ? actionsHTML(at, count) : ''}
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

/**
 * Redraw every shown image with this hash, after its original was found,
 * found missing, or restored. Only the image itself is replaced.
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
    const list = attachmentsOf(messages[index]);
    const attachment = list[at];
    if (!attachment) continue;
    const editing = state.session.editingMessageIndex === index;
    figure.replaceWith(
      fromHTML(attachmentItemHTML(attachment, at, { editing, count: list.length })),
    );
  }
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

/* ------------------------------------------------------------------ *
 * Zoom
 * ------------------------------------------------------------------ */

/**
 * Scale the image in `viewer` to `zoom` times the viewer's width, keeping the
 * point under `anchor` (viewport coordinates; the centre if omitted) still.
 */
export function setAttachmentZoom(viewer, zoom, anchor = null) {
  const image = viewer?.querySelector('.attachment-image');
  if (!image) return;

  const min = Number(viewer.dataset.minZoom) || 1;
  const current = Number(viewer.dataset.zoom) || 1;
  const next = Math.min(MAX_ZOOM, Math.max(min, zoom));
  if (Math.abs(next - current) < 1e-4) return;

  const frame = viewer.getBoundingClientRect();
  const x = Number.isFinite(anchor?.x) ? anchor.x : frame.left + frame.width / 2;
  const y = Number.isFinite(anchor?.y) ? anchor.y : frame.top + frame.height / 2;

  const before = image.getBoundingClientRect();
  const rx = before.width ? (x - before.left) / before.width : 0.5;
  const ry = before.height ? (y - before.top) / before.height : 0.5;

  viewer.dataset.zoom = String(next);
  image.style.width = `${next * 100}%`;

  const after = image.getBoundingClientRect();
  viewer.scrollLeft += after.left + rx * after.width - x;
  viewer.scrollTop += after.top + ry * after.height - y;
}

/** One wheel step of zoom. A trackpad pinch arrives as Ctrl+wheel with small deltas. */
export function zoomAttachment(viewer, deltaY, anchor) {
  const current = Number(viewer.dataset.zoom) || 1;
  const delta = Math.max(-50, Math.min(50, deltaY));
  setAttachmentZoom(viewer, current * Math.exp(-delta * 0.01), anchor);
}

export function resetAttachmentZoom(viewer) {
  setAttachmentZoom(viewer, 1);
  viewer.scrollTop = 0;
  viewer.scrollLeft = 0;
}
