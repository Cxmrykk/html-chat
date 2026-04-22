// --- PURE UTILITIES ---
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const $ = (s) => document.querySelector(s);

const escapeHTML = (str) =>
  (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function pickFiles(multiple = true) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.addEventListener("change", (e) =>
      resolve(Array.from(e.target.files)),
    );
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file);
  });
}

function cosSim(a, b) {
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function encodeVectorToBase64(vector) {
  if (!vector || !vector.length) return null;
  const f32 = new Float32Array(vector);
  const u8 = new Uint8Array(f32.buffer);
  let binary = "";
  for (let i = 0; i < u8.byteLength; i++) {
    binary += String.fromCharCode(u8[i]);
  }
  return btoa(binary);
}

function decodeBase64ToVector(base64) {
  if (!base64) return null;
  const binary = atob(base64);
  const u8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    u8[i] = binary.charCodeAt(i);
  }
  // Return typed array directly to compress DB payload drastically
  return new Float32Array(u8.buffer);
}
