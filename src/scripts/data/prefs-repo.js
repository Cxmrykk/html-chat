import * as idb from './idb.js';
import { KEYS } from './keys.js';

/** Small, non-config UI preferences that survive reloads. */

export async function loadPrefs() {
  const [sidebarHidden, titleHidden, promptHeight, currentChatId, theme] = await Promise.all([
    idb.get(KEYS.sidebarHidden),
    idb.get(KEYS.titleHidden),
    idb.get(KEYS.promptHeight),
    idb.get(KEYS.currentChatId),
    idb.get(KEYS.theme),
  ]);
  return {
    sidebarHidden: sidebarHidden === true,
    titleHidden: titleHidden === true,
    promptHeight: promptHeight || '',
    currentChatId: currentChatId || null,
    theme: theme || 'light',
  };
}

export async function savePrefs({ sidebarHidden, titleHidden, promptHeight, currentChatId, theme }) {
  await Promise.all([
    idb.set(KEYS.sidebarHidden, sidebarHidden),
    idb.set(KEYS.titleHidden, titleHidden),
    idb.set(KEYS.promptHeight, promptHeight),
    idb.set(KEYS.currentChatId, currentChatId || ''),
    idb.set(KEYS.theme, theme || 'light'),
  ]);
}
