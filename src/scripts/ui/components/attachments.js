import { $, fromHTML } from '../dom.js';
import { state, currentChat } from '../../store/state.js';
import { escapeHTML } from '../../core/format.js';
import { attachmentsOf } from '../../core/attachments.js';
import { imageUrlFor, imageStatus, requestImage } from '../../services/images.js';
import { ICON_CHEVRON_DOWN, ICON_CHEVRON_UP, ICON_DELETE, ICON_CANCEL } from '../icons.js';

/**
 * A message's attachments: a drop-down at the bottom of the row, and inside it
 * one square viewer per image, stacked in a single column.
 *
 * A viewer is always 1:1 and as wide as the drop-down. The image fills its
 * width and scrolls vertically; zooming (`setAttachmentZoom`) scales it within
 * the square. A placeholder is drawn pixelated under a text overlay, and a
 * click on it opens the file picker (`attachments.restore`).
 */

const MAX_ZOOM = 8;

function sizeLabel(attachment) {
  return `${attachment.width}×${attachment.height}`;
}

function overlayText(status) {
  return status === 'checking'
    ? 'Looking for the original…'
    : 'Placeholder · click to restore the original';
}

/** One image. Looks for its original the first time it is drawn. */
export function attachmentItemHTML(attachment, at, { editing = false } = {}) {
  let url = imageUrlFor(attachment.hash);
  if (!url) requestImage(attachment.hash);
  url = imageUrlFor(attachment.hash);
  const status = url ? 'original' : imageStatus(attachment.hash);
  const placeholder = !url;

  // Zooming out stops when a tall image fits the square whole.
  const minZoom = Math.min(1, attachment.width / attachment.height);
  const restore = placeholder
    ? ' data-command="attachments.restore" title="Click to restore the original image"'
    : '';

  const image = `<img class="attachment-image${placeholder ? ' pixelated' : ''}"
      src="${escapeHTML(url || attachment.placeholder)}" alt="${escapeHTML(attachment.name)}"
      style="aspect-ratio: ${attachment.width} / ${attachment.height}" draggable="false"${restore}>`;

  const overlay = placeholder
    ? `<div class="attachment-overlay" aria-hidden="true"><span>${escapeHTML(overlayText(status))}</span></div>`
    : '';

  const remove = editing
    ? `<button class="attachment-remove" data-command="attachments.remove" title="Remove this image">${ICON_DELETE}</button>`
    : '';

  return `
    <figure class="attachment${placeholder ? ' is-placeholder' : ''}" data-attachment="${at}"
            data-hash="${escapeHTML(attachment.hash)}">
      <div class="attachment-frame">
        <div class="attachment-viewer" data-zoom="1" data-min-zoom="${minZoom}"
             title="Pinch or Ctrl+Scroll to zoom · double-click to reset">${image}</div>
        ${overlay}
      </div>
      <figcaption class="attachment-caption">
        <span class="attachment-name">${escapeHTML(attachment.name)}</span>
        <span class="attachment-size">${escapeHTML(sizeLabel(attachment))}${placeholder ? ' · placeholder' : ''}</span>
        ${remove}
      </figcaption>
    </figure>`;
}

/** The drop-down, or nothing for a message without images. Closed unless opened. */
export function attachmentsHTML(message, { editing = false } = {}) {
  const list = attachmentsOf(message);
  if (!list.length) return '';

  const open = message.attachmentsOpen === true;
  const hint = open ? 'Hide attachments' : 'Show attachments';
  const body = open
    ? `<div class="attachments-body">${list
        .map((attachment, at) => attachmentItemHTML(attachment, at, { editing }))
        .join('')}</div>`
    : '';

  return `
    <div class="attachments${open ? ' open' : ''}">
      <button class="attachments-header" data-command="message.toggleAttachments"
              aria-expanded="${open ? 'true' : 'false'}" title="${hint}">
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
    const attachment = attachmentsOf(messages[index])[at];
    if (!attachment) continue;
    const editing = state.session.editingMessageIndex === index;
    figure.replaceWith(fromHTML(attachmentItemHTML(attachment, at, { editing })));
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
