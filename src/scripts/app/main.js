import { $ } from '../ui/dom.js';
import { state, setSession } from '../store/state.js';
import * as configRepo from '../data/config-repo.js';
import * as chatsRepo from '../data/chats-repo.js';
import * as filesRepo from '../data/files-repo.js';
import * as prefsRepo from '../data/prefs-repo.js';
import { startEmbedding } from '../services/embedding.js';
import { installBindings, renderAll } from '../ui/bindings.js';
import { installEventHandlers } from './events.js';
import { installShortcuts } from './shortcuts.js';

/** Bootstrap: load, migrate, wire, render. Nothing else belongs here. */

function hydrateConnectionForm() {
  const config = state.data.config;
  if ($('#cfg-url')) $('#cfg-url').value = config.url;
  if ($('#cfg-key')) $('#cfg-key').value = config.key;
  if ($('#cfg-models')) $('#cfg-models').value = config.models;
  if ($('#cfg-godmode')) $('#cfg-godmode').checked = Boolean(config.godMode);
}

/** Resume any file that was mid-embed when the tab last closed. */
function resumeEmbeddings() {
  for (const file of state.data.files) {
    if (file.isEmbedding && (file.progress ?? 0) < 100) {
      startEmbedding(file.id);
    } else {
      file.isEmbedding = false;
    }
  }
}

async function init() {
  const [config, chats, files, prefs] = await Promise.all([
    configRepo.loadConfig(),
    chatsRepo.loadChats(),
    filesRepo.loadFileMetas(),
    prefsRepo.loadPrefs(),
  ]);

  state.data.config = config;
  state.data.files = files;
  state.data.chats = chats.sort((a, b) => Number(b.id) - Number(a.id));
  state.data.currentChatId =
    prefs.currentChatId || (state.data.chats.length ? state.data.chats[0].id : null);

  setSession(
    {
      sidebarHidden: prefs.sidebarHidden,
      titleHidden: prefs.titleHidden,
      promptHeight: prefs.promptHeight,
    },
    { silent: true },
  );

  hydrateConnectionForm();
  installBindings();
  installEventHandlers();
  installShortcuts();
  renderAll();
  resumeEmbeddings();
}

init();
