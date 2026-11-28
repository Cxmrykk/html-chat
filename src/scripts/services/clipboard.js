/**
 * Copying an image to the clipboard. Browsers reliably accept only PNG there,
 * so anything else is converted first. The image is handed over as a promise,
 * which keeps Safari's user-gesture check satisfied while it is still being
 * read or converted.
 */

async function asPng(blob) {
  if (blob.type === 'image/png') return blob;
  if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot convert the image.');
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (png) => (png ? resolve(png) : reject(new Error('Could not convert the image.'))),
        'image/png',
      );
    });
  } finally {
    bitmap.close?.();
  }
}

/** Copy an image (a blob, or a promise of one) to the clipboard. */
export async function copyImageBlob(source) {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new Error('This browser cannot copy images to the clipboard.');
  }
  const png = Promise.resolve(source).then((blob) => {
    if (!blob) throw new Error('The original of this image is not stored.');
    return asPng(blob);
  });
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
