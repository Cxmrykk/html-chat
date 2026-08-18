import * as idb from './idb.js';
import { KEYS } from './keys.js';

/** Small, non-config UI preferences that survive reloads. */

export async function loadPrefs() {
  const [sidebarHidden, titleHidden, promptHeight, currentChatId] = await Promise.all([
    idb.get(KEYS.sidebarHidden),
    idb.get(KEYS.titleHidden),
    idb.get(KEYS.promptHeight),
    idb.get(KEYS.currentChatId),
  ]);
  return {
    sidebarHidden: sidebarHidden === true,
    titleHidden: titleHidden === true,
    promptHeight: promptHeight || '',
    currentChatId: currentChatId || null,
  };
}

export async function savePrefs({ sidebarHidden, titleHidden, promptHeight, currentChatId }) {
  await Promise.all([
    idb.set(KEYS.sidebarHidden, sidebarHidden),
    idb.set(KEYS.titleHidden, titleHidden),
    idb.set(KEYS.promptHeight, promptHeight),
    idb.set(KEYS.currentChatId, currentChatId || ''),
  ]);
}
