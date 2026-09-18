import { state, setModelStatus, persistConfig } from '../store/state.js';
import { fetchModels } from './api/models.js';
import { mergeModelLists } from '../core/models.js';

/** Model discovery: the cached server list, refreshed on demand. */

/** What the dropdown offers: the last list the server gave us, plus manual extras. */
export function availableModels() {
  const { models, extraModels } = state.data.config;
  return mergeModelLists(models, extraModels);
}

/**
 * Point `lastModel` at something that exists. An empty list changes nothing:
 * a failed first fetch must not forget the user's choice.
 */
export function ensureActiveModel() {
  const models = availableModels();
  const config = state.data.config;
  if (!models.length || models.includes(config.lastModel)) return false;
  config.lastModel = models[0];
  return true;
}

export async function refreshModels() {
  const config = state.data.config;
  if (!config.url?.trim()) return;

  // A newer refresh (the URL just changed, say) supersedes one in flight.
  state.runtime.modelsAbort?.abort();
  const controller = new AbortController();
  state.runtime.modelsAbort = controller;
  setModelStatus({ loading: true, error: null });

  let error = null;
  try {
    const ids = await fetchModels(config, controller.signal);
    if (controller.signal.aborted) return;
    config.models = ids;
    ensureActiveModel();
    await persistConfig();
  } catch (failure) {
    if (failure.name === 'AbortError') return;
    // The cached list stays: a server that is down is not a server with no models.
    error = failure.message;
  } finally {
    if (state.runtime.modelsAbort === controller) {
      state.runtime.modelsAbort = null;
      setModelStatus({ loading: false, error });
    }
  }
}
