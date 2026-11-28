import { $, setHidden } from '../dom.js';
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
