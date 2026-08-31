import * as idb from './idb.js';
import { KEYS } from './keys.js';

/**
 * Small, non-config UI preferences that survive reloads.
 *
 * IndexedDB remains the source of truth, but it is async: the first paint
 * happens long before these resolve. The three values that affect colour or
 * layout are therefore mirrored into localStorage, which the pre-paint script
 * in index.html reads synchronously. That script hardcodes the same key
 * strings, so they must stay in step with `data/keys.js`.
 */

function readMirror(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeMirror(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* Storage disabled (private mode): IndexedDB still holds the value. */
  }
}

function syncMirror({ sidebarHidden, titleHidden, theme }) {
  writeMirror(KEYS.sidebarHidden, sidebarHidden === true);
  writeMirror(KEYS.titleHidden, titleHidden === true);
  writeMirror(KEYS.theme, theme || 'light');
}

/** What a first-time visitor gets. The boot script applies the same rule. */
function preferredTheme() {
  const query = window.matchMedia?.('(prefers-color-scheme: dark)');
  return query?.matches ? 'dark' : 'light';
}

/** Stored flag if there is one, otherwise the mirror, otherwise false. */
function resolveFlag(stored, key) {
  if (stored !== undefined && stored !== null) return stored === true;
  return readMirror(key) === 'true';
}

export async function loadPrefs() {
  const [sidebarHidden, titleHidden, promptHeight, currentChatId, theme] = await Promise.all([
    idb.get(KEYS.sidebarHidden),
    idb.get(KEYS.titleHidden),
    idb.get(KEYS.promptHeight),
    idb.get(KEYS.currentChatId),
    idb.get(KEYS.theme),
  ]);

  const prefs = {
    sidebarHidden: resolveFlag(sidebarHidden, KEYS.sidebarHidden),
    titleHidden: resolveFlag(titleHidden, KEYS.titleHidden),
    promptHeight: promptHeight || '',
    currentChatId: currentChatId || null,
    theme: theme || readMirror(KEYS.theme) || preferredTheme(),
  };

  // Re-arm the mirror so an install that predates it paints correctly next time.
  syncMirror(prefs);
  return prefs;
}

export async function savePrefs({ sidebarHidden, titleHidden, promptHeight, currentChatId, theme }) {
  syncMirror({ sidebarHidden, titleHidden, theme });
  await Promise.all([
    idb.set(KEYS.sidebarHidden, sidebarHidden),
    idb.set(KEYS.titleHidden, titleHidden),
    idb.set(KEYS.promptHeight, promptHeight),
    idb.set(KEYS.currentChatId, currentChatId || ''),
    idb.set(KEYS.theme, theme || 'light'),
  ]);
}
