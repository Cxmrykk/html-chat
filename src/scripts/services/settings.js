import { EVENTS } from '../store/events.js';
import {
  state,
  emit,
  findFile,
  persistConfig,
  persistFiles,
  invalidateContext,
} from '../store/state.js';
import {
  GLOBAL_SETTINGS,
  FILE_SETTINGS,
  resetsEmbeddings,
  requiresReembed,
} from '../core/settings-schema.js';
import { coerceForStorage } from '../core/values.js';
import { resetAllEmbeddings, refreshFileChunks } from './embedding.js';
import { getFileText, setFileText } from './file-library.js';

/** Settings management parameterised by scope (global or file-level). */

export function schemaFor(scope) {
  return scope === 'file' ? FILE_SETTINGS : GLOBAL_SETTINGS;
}

function targetFor(scope, fileId) {
  return scope === 'file' ? findFile(fileId) : state.data.config;
}

/** Current stored value for a key, ready to display in the list. */
export function readSetting(scope, key, fileId) {
  const target = targetFor(scope, fileId);
  return target ? target[key] : undefined;
}

/** Editor contents: the stored value, or the schema default when unset. */
export async function readEditorValue(scope, key, fileId) {
  const schema = schemaFor(scope);
  const entry = schema[key];
  if (!entry) return '';

  if (scope === 'file' && key === 'fileText') {
    return getFileText(fileId);
  }

  const target = targetFor(scope, fileId);
  const value = target ? target[key] : undefined;
  return value !== undefined && value !== '' ? String(value) : entry.default;
}

async function afterMutation(scope, key, fileId, previousEmbeddingsModel) {
  if (scope === 'file') {
    await persistFiles();
    if (requiresReembed(FILE_SETTINGS, key)) await refreshFileChunks(fileId);
    emit(EVENTS.FILES);
  } else {
    await persistConfig();
    if (
      resetsEmbeddings(GLOBAL_SETTINGS, key) &&
      previousEmbeddingsModel !== state.data.config.embeddingsModel
    ) {
      await resetAllEmbeddings();
    }
  }
  invalidateContext();
}

export async function saveSetting(scope, key, rawValue, fileId) {
  const schema = schemaFor(scope);
  const entry = schema[key];
  if (!entry) return;

  if (scope === 'file' && key === 'fileText') {
    await setFileText(fileId, rawValue);
    emit(EVENTS.FILES);
    invalidateContext();
    return;
  }

  const target = targetFor(scope, fileId);
  if (!target) return;

  const previousModel = state.data.config.embeddingsModel;
  target[key] = coerceForStorage(rawValue, entry.type);
  await afterMutation(scope, key, fileId, previousModel);
}

export async function resetSetting(scope, key, fileId) {
  const schema = schemaFor(scope);
  const entry = schema[key];
  // File contents have no meaningful default to restore.
  if (!entry || (scope === 'file' && key === 'fileText')) return;

  const target = targetFor(scope, fileId);
  if (!target) return;

  const previousModel = state.data.config.embeddingsModel;
  target[key] = entry.default;
  await afterMutation(scope, key, fileId, previousModel);
}

export async function resetAllSettings(scope, fileId) {
  const schema = schemaFor(scope);
  const target = targetFor(scope, fileId);
  if (!target) return;

  const previousModel = state.data.config.embeddingsModel;
  let needsReembed = false;

  for (const [key, entry] of Object.entries(schema)) {
    if (scope === 'file' && key === 'fileText') continue;
    if (requiresReembed(schema, key) && target[key] !== entry.default) needsReembed = true;
    target[key] = entry.default;
  }

  if (scope === 'file') {
    await persistFiles();
    if (needsReembed) await refreshFileChunks(fileId);
    emit(EVENTS.FILES);
  } else {
    await persistConfig();
    if (previousModel !== state.data.config.embeddingsModel) await resetAllEmbeddings();
  }
  invalidateContext();
}

/** Save connection configuration options. */
export async function saveConnectionConfig({ url, key, models, godMode }) {
  Object.assign(state.data.config, { url, key, models, godMode });
  await persistConfig();
  invalidateContext();
  emit(EVENTS.SESSION);
}

export function setActiveModel(model) {
  state.data.config.lastModel = model;
  return persistConfig();
}
