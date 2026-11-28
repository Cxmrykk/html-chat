/** Browser file picking, reading and downloading. */

export function pickFiles({ multiple = true, accept } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    if (accept) input.accept = accept;
    input.addEventListener('change', (event) => resolve([...event.target.files]));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/** Pick a single JSON file and return its text, or null if cancelled. */
export async function pickJSONText() {
  const [file] = await pickFiles({ multiple: false, accept: '.json' });
  return file ? readFileText(file) : null;
}

/** Save `blob` as a download named `filename`. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename || 'download';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoked a moment later: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
