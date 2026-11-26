import { $ } from '../ui/dom.js';
import { state, setSession } from '../store/state.js';
import * as configRepo from '../data/config-repo.js';
import * as chatsRepo from '../data/chats-repo.js';
import * as prefsRepo from '../data/prefs-repo.js';
import { purgeRetiredData } from '../data/retired-repo.js';
import { ensureActiveModel, refreshModels } from '../services/models.js';
import { installBindings, renderAll } from '../ui/bindings.js';
import { installEventHandlers } from './events.js';
import { installShortcuts } from './shortcuts.js';

/** Bootstrap: load, wire, render. Nothing else belongs here. */

function hydrateConnectionForm() {
  const config = state.data.config;
  if ($('#cfg-url')) $('#cfg-url').value = config.url;
  if ($('#cfg-key')) $('#cfg-key').value = config.key;
  if ($('#cfg-js-exec')) $('#cfg-js-exec').checked = Boolean(config.jsExecution);
}

async function init() {
  const [config, chats, prefs] = await Promise.all([
    configRepo.loadConfig(),
    chatsRepo.loadChats(),
    prefsRepo.loadPrefs(),
  ]);

  state.data.config = config;
  state.data.chats = chats.sort((a, b) => Number(b.id) - Number(a.id));
  state.data.currentChatId =
    prefs.currentChatId || (state.data.chats.length ? state.data.chats[0].id : null);

  setSession(
    {
      sidebarHidden: prefs.sidebarHidden,
      titleHidden: prefs.titleHidden,
      promptHeight: prefs.promptHeight,
      theme: prefs.theme,
    },
    { silent: true },
  );

  hydrateConnectionForm();
  // The cached list (or legacy migration) may already point somewhere stale.
  ensureActiveModel();
  installBindings();
  installEventHandlers();
  installShortcuts();
  renderAll();
  // Not awaited: the cached model list renders immediately, this refines it.
  refreshModels();
  // Not awaited: nothing reads the retired records, they only take up space.
  purgeRetiredData().catch((error) => console.error('Could not remove retired data:', error));
}

init();
