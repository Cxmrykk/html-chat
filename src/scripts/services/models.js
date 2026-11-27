import { state, setModelStatus, persistConfig, invalidateContext } from '../store/state.js';
import { fetchModelCatalog } from './api/models.js';
import { mergeModelLists, normalizeModelList, modelNamesFrom } from '../core/models.js';
import {
  normalizeCapabilities,
  reasoningChoices,
  reasoningEffortToSend,
  generatesImagesOnly,
} from '../core/capabilities.js';
import { pickBoolean } from '../core/values.js';
import { GLOBAL_SETTINGS } from '../core/settings-schema.js';

/** Model discovery: the cached server list and capabilities, refreshed on demand. */

/**
 * Every image model: the ones the endpoint reported as making images (and
 * not chatting), and the ones listed under Image Models.
 */
export function imageModels() {
  const { models, modelCapabilities, imageModels: manual } = state.data.config;
  const discovered = normalizeModelList(models).filter((id) =>
    generatesImagesOnly(modelCapabilities?.[id]),
  );
  return mergeModelLists(discovered, modelNamesFrom(manual));
}

/** Whether requests to `model` go to the Images API rather than chat completions. */
export function isImageModel(model = state.data.config.lastModel) {
  return Boolean(model) && imageModels().includes(model);
}

/** The image models the image tools may use (Image Tool Models). */
export function imageToolModels() {
  return modelNamesFrom(state.data.config.imageToolModels);
}

function imageModelsInChat() {
  return pickBoolean(
    false,
    state.data.config.imageModelsInChat,
    GLOBAL_SETTINGS.imageModelsInChat.default,
  );
}

/**
 * What the dropdown offers: the last list the server gave us, minus models it
 * says cannot chat (embedding models), plus manual extras, which are always
 * offered. Image models are offered only with Image Models in Chat on, after
 * the chat models.
 */
export function availableModels() {
  const { models, extraModels, modelCapabilities } = state.data.config;
  const images = imageModels();
  const isImage = new Set(images);
  const chatModels = normalizeModelList(models).filter(
    (id) => modelCapabilities?.[id]?.chat !== false && !isImage.has(id),
  );
  const extras = normalizeModelList(extraModels).filter((id) => !isImage.has(id));
  return mergeModelLists(chatModels, extras, imageModelsInChat() ? images : []);
}

/** What the endpoint reported about a model; all unknown if it said nothing. */
export function capabilitiesFor(model = state.data.config.lastModel) {
  return normalizeCapabilities(state.data.config.modelCapabilities?.[model]);
}

/** The reasoning-effort choices for a model: reported by the endpoint, or the user's list. */
export function reasoningChoicesFor(model = state.data.config.lastModel) {
  return reasoningChoices(capabilitiesFor(model), state.data.config.availableReasoningLevels);
}

/** The `reasoning_effort` a request to `model` carries, or null for none. */
export function reasoningEffortFor(model = state.data.config.lastModel) {
  const config = state.data.config;
  return reasoningEffortToSend(
    config.reasoningEffort,
    capabilitiesFor(model),
    config.availableReasoningLevels,
  );
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

  const probe = pickBoolean(
    true,
    config.probeCapabilities,
    GLOBAL_SETTINGS.probeCapabilities.default,
  );

  let error = null;
  try {
    const catalog = await fetchModelCatalog(config, { signal: controller.signal, probe });
    if (controller.signal.aborted) return;
    config.models = catalog.ids;
    config.modelCapabilities = catalog.capabilities;
    ensureActiveModel();
    await persistConfig();
    // Whether tools ride along with a request may have changed.
    invalidateContext();
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
