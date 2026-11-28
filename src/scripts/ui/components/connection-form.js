import { $, setHidden } from '../dom.js';
import { state } from '../../store/state.js';
import { imageModels } from '../../services/models.js';

/**
 * The sidebar's connection form, beyond what the user types into it. The
 * Image Manipulation switch only means something once an image model is
 * identified, so until then it is not shown at all. Its checked state is kept
 * while hidden, so it comes back as it was.
 */
export function renderConnectionForm() {
  setHidden($('#cfg-image-gen-label'), !imageModels().length);
}

/**
 * Fill the form from the config: at startup, and after settings are
 * imported. Never on an ordinary render, which would overwrite what the user
 * is typing.
 */
export function hydrateConnectionForm() {
  const config = state.data.config;
  if ($('#cfg-url')) $('#cfg-url').value = config.url;
  if ($('#cfg-key')) $('#cfg-key').value = config.key;
  if ($('#cfg-js-exec')) $('#cfg-js-exec').checked = Boolean(config.jsExecution);
  if ($('#cfg-image-gen')) $('#cfg-image-gen').checked = Boolean(config.imageGeneration);
  renderConnectionForm();
}
