import { EVENTS } from '../store/events.js';
import {
  state,
  emit,
  setSession,
  findFile,
  findProfile,
  profileOf,
  isConfigured,
  usableMethods,
  currentChat,
} from '../store/state.js';
import {
  defaultProfile,
  normalizeProfile,
  validateProfile,
  enabledMethods,
  normalizeExtensions,
  diffProfiles,
} from '../core/rag-profile.js';
import { CUSTOM_PARSER, presetOptions } from '../core/parsers.js';
import { outlineStats, createLineIndex } from '../core/sections.js';
import { GENERATE_INSTRUCTION, GENERATE_DISPLAY } from '../core/rag-assistant.js';
import { parseDocument } from './parsing.js';
import { searchDocuments } from './retrieval.js';
import { runAssistant } from './rag-assistant.js';
import { getFileText } from './file-library.js';
import * as profiles from './profiles.js';
import { toggleChatFile } from './conversation.js';

/**
 * The file search configurator: choosing or building the profile one file is
 * searched with.
 *
 * Steps: profile (pick an existing one; only when there are any) → methods →
 * structure (parser, with a live outline of this file) → output (context,
 * notes, a test search) → save (name, extensions). From structure on, an
 * assistant can write or change the draft from a sample of the file.
 *
 * The draft is edited as raw form values and read through `normalizeProfile`
 * wherever it is used, so a half-typed number never breaks anything. Files
 * uploaded together are queued and configured one after another; a saved
 * profile can be applied to the other unconfigured files with its
 * extensions in one go.
 */

export const STEP_LABELS = {
  profile: 'Profile',
  methods: 'Methods',
  structure: 'Structure',
  output: 'Output',
  save: 'Save',
};

/** Steps on which the assistant is shown. */
export const ASSISTANT_STEPS = ['structure', 'output', 'save'];

const PREVIEW_DELAY_MS = 300;

let previewTimer = null;
let previewRun = 0;
let testRun = 0;
let assistantAbort = null;

const current = () => state.session.wizard;
const notify = (part = 'all', extra = {}) => emit(EVENTS.WIZARD, { part, ...extra });
const copy = (value) => JSON.parse(JSON.stringify(value));

const emptyPreview = () => ({ busy: false, error: '', sections: null, stats: null });
const emptyTest = () => ({ method: 'text', query: '', flags: '', busy: false, output: '', error: '' });
const emptyAssistant = () => ({ messages: [], busy: false, pending: '', status: '', error: '' });

/** Abandon everything in flight for the current wizard. */
function resetRuntime() {
  assistantAbort?.abort();
  assistantAbort = null;
  clearTimeout(previewTimer);
  previewTimer = null;
  previewRun++;
  testRun++;
}

function stillUnconfigured(ids) {
  return [...new Set(ids)].filter((id) => {
    const file = findFile(id);
    return file && !isConfigured(file);
  });
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export function wizardSteps(wizard = current()) {
  const steps = ['methods', 'structure', 'output', 'save'];
  if (state.data.profiles.length || wizard?.baseProfileId) steps.unshift('profile');
  return steps;
}

export function isAssistantBusy() {
  return Boolean(current()?.assistant.busy);
}

/** Profiles to offer, matching ones first, each with how many files use it. */
export function profileChoices(fileName) {
  return profiles.profilesForFile(fileName).map(({ profile, matches }) => ({
    profile,
    matches,
    usedBy: profiles.filesUsing(profile.id).length,
  }));
}

export function profileUsage(id) {
  return profiles.filesUsing(id).length;
}

/** Unconfigured files, other than this one, that the draft's extensions claim. */
export function otherUnconfiguredFiles(wizard = current()) {
  if (!wizard) return [];
  return profiles
    .unconfiguredFilesFor(normalizeExtensions(wizard.draft.extensions))
    .filter((file) => file.id !== wizard.fileId);
}

/* ------------------------------------------------------------------ *
 * Opening and closing
 * ------------------------------------------------------------------ */

/**
 * Open the configurator for a file. A configured file starts from its own
 * profile; an unconfigured one from the profile list (or a fresh draft when
 * there are no profiles). Files still waiting in an open wizard's queue stay
 * queued. `attachOnSave` attaches the file to the current chat once it is
 * configured: set when the user tried to attach it before it was.
 */
export async function openWizard(fileId, { queue = [], attachOnSave = false } = {}) {
  const meta = findFile(fileId);
  if (!meta) return;

  const previous = current();
  const carried = previous ? [...previous.queue, previous.fileId] : [];
  resetRuntime();

  const text = await getFileText(fileId);
  const profile = profileOf(meta);

  const wizard = {
    fileId,
    fileName: meta.name,
    text,
    lines: createLineIndex(text),
    queue: stillUnconfigured([...queue, ...carried]).filter((id) => id !== fileId),
    attachOnSave,
    step: profile || !state.data.profiles.length ? 'methods' : 'profile',
    draft: profile ? copy(profile) : defaultProfile({ fileName: meta.name }),
    baseProfileId: profile ? profile.id : null,
    applyToOthers: true,
    saving: false,
    error: '',
    preview: emptyPreview(),
    test: emptyTest(),
    assistant: emptyAssistant(),
  };

  setSession({
    view: 'wizard',
    wizard,
    activeSettingKey: null,
    settingsDraft: null,
    editingThinking: false,
  });
  runPreview();
}

/** Configure newly uploaded files: open the wizard, or queue them behind the open one. */
export async function configureFiles(ids) {
  const wizard = current();
  if (wizard) {
    wizard.queue = stillUnconfigured([...wizard.queue, ...ids]).filter((id) => id !== wizard.fileId);
    notify('all');
    return;
  }
  const [first, ...rest] = ids;
  if (first) await openWizard(first, { queue: rest });
}

export function closeWizard({ silent = false } = {}) {
  resetRuntime();
  if (!current() && state.session.view !== 'wizard') return;
  const patch = state.session.view === 'wizard' ? { wizard: null, view: 'chat' } : { wizard: null };
  setSession(patch, { silent });
}

/** A file was deleted: drop it from the queue, and move on if it was the one open. */
export async function forgetFile(id) {
  const wizard = current();
  if (!wizard) return;
  wizard.queue = wizard.queue.filter((entry) => entry !== id);
  if (wizard.fileId !== id) {
    notify('all');
    return;
  }
  const pending = stillUnconfigured(wizard.queue);
  if (pending.length) await openWizard(pending[0], { queue: pending.slice(1) });
  else closeWizard();
}

/* ------------------------------------------------------------------ *
 * Navigation
 * ------------------------------------------------------------------ */

export function goToStep(step) {
  const wizard = current();
  if (!wizard) return;
  const steps = wizardSteps(wizard);
  if (!steps.includes(step) || step === wizard.step) return;

  const pastMethods = steps.indexOf(step) > steps.indexOf('methods');
  if (pastMethods && !enabledMethods(normalizeProfile(wizard.draft)).length) {
    wizard.step = 'methods';
    wizard.error = 'Select at least one search method.';
    notify('all', { resetScroll: true });
    return;
  }

  wizard.step = step;
  wizard.error = '';
  notify('all', { resetScroll: true });
}

export function nextStep() {
  const wizard = current();
  if (!wizard) return;
  const steps = wizardSteps(wizard);
  const index = steps.indexOf(wizard.step);
  if (index !== -1 && index < steps.length - 1) goToStep(steps[index + 1]);
}

export function previousStep() {
  const wizard = current();
  if (!wizard) return;
  const steps = wizardSteps(wizard);
  const index = steps.indexOf(wizard.step);
  if (index > 0) goToStep(steps[index - 1]);
}

/* ------------------------------------------------------------------ *
 * The draft
 * ------------------------------------------------------------------ */

function loadDraft(wizard, draft, baseProfileId) {
  assistantAbort?.abort();
  Object.assign(wizard, {
    draft,
    baseProfileId,
    step: 'methods',
    error: '',
    test: emptyTest(),
    assistant: emptyAssistant(),
  });
  schedulePreview(0);
  notify('all', { resetScroll: true });
}

export function startNewProfile() {
  const wizard = current();
  if (wizard) loadDraft(wizard, defaultProfile({ fileName: wizard.fileName }), null);
}

export function editProfile(id) {
  const wizard = current();
  const profile = findProfile(id);
  if (wizard && profile) loadDraft(wizard, copy(profile), profile.id);
}

function setPath(target, path, value) {
  const keys = path.split('.');
  let node = target;
  for (const key of keys.slice(0, -1)) {
    if (!node[key] || typeof node[key] !== 'object') node[key] = {};
    node = node[key];
  }
  node[keys[keys.length - 1]] = value;
}

/**
 * Store one form value. `scope` is 'draft' (the profile), 'test' (the test
 * search) or 'wizard' (the wizard's own options). Structural changes ask for
 * a re-render; typing only stores, so the field keeps its focus.
 */
export function setField(scope, path, value, { rerender = false } = {}) {
  const wizard = current();
  if (!wizard || typeof path !== 'string' || !path) return;

  if (scope === 'wizard') {
    if (path === 'applyToOthers') wizard.applyToOthers = Boolean(value);
  } else if (scope === 'test') {
    setPath(wizard.test, path, value);
  } else {
    setPath(wizard.draft, path, value);
    if (path === 'parser.preset' && value !== CUSTOM_PARSER) {
      wizard.draft.parser.options = presetOptions(value);
    }
    if (path.startsWith('parser.') || path === 'maxSectionTokens') schedulePreview();
  }

  if (rerender) {
    wizard.error = '';
    notify('all');
  }
}

/* ------------------------------------------------------------------ *
 * Outline preview
 * ------------------------------------------------------------------ */

function schedulePreview(delay = PREVIEW_DELAY_MS) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    previewTimer = null;
    runPreview();
  }, delay);
}

async function runPreview() {
  const wizard = current();
  if (!wizard) return;
  const run = ++previewRun;

  wizard.preview.busy = true;
  notify('preview');

  const profile = normalizeProfile(wizard.draft);
  const { sections, error } = await parseDocument(profile, wizard.text, wizard.fileName);
  if (run !== previewRun || current() !== wizard) return;

  wizard.preview = {
    busy: false,
    error,
    sections,
    stats: outlineStats(wizard.text, sections, { maxSectionTokens: profile.maxSectionTokens }),
  };
  notify('preview');
}

/* ------------------------------------------------------------------ *
 * Test search
 * ------------------------------------------------------------------ */

/**
 * Search this file under the draft, exactly as a tool call would, and keep
 * the text the model would receive. Text and regex only: semantic search
 * needs the file embedded under the saved profile.
 */
export async function runTest() {
  const wizard = current();
  if (!wizard) return;

  const method = wizard.test.method === 'regex' ? 'regex' : 'text';
  const query = String(wizard.test.query ?? '').trim();
  if (!query) {
    wizard.test.error = method === 'regex' ? 'Enter a pattern to search for.' : 'Enter a phrase to search for.';
    wizard.test.output = '';
    notify('test');
    return;
  }

  const run = ++testRun;
  const live = () => run === testRun && current() === wizard;
  Object.assign(wizard.test, { busy: true, error: '' });
  notify('test');

  try {
    const profile = normalizeProfile(wizard.draft);
    const { sections, error } = await parseDocument(profile, wizard.text, wizard.fileName);
    const document = {
      fileId: wizard.fileId,
      fileName: wizard.fileName,
      profile,
      text: wizard.text,
      sections,
      lines: wizard.lines,
      error,
    };
    const args = method === 'regex' ? { pattern: query, flags: wizard.test.flags } : { query };
    const output = await searchDocuments({
      method,
      documents: new Map([[wizard.fileId, document]]),
      args,
    });
    if (!live()) return;
    wizard.test.output = output;
  } catch (error) {
    if (!live()) return;
    wizard.test.error = error.message;
    wizard.test.output = '';
  } finally {
    if (live()) {
      wizard.test.busy = false;
      notify('test');
    }
  }
}

/* ------------------------------------------------------------------ *
 * Assistant
 * ------------------------------------------------------------------ */

/**
 * Send one message to the assistant. Its answer replaces the draft (the
 * user's search methods kept), and the preview follows. Resolves with whether
 * the message went through; one that failed is taken back out of the
 * conversation so the user can resend it.
 */
export async function ask(instruction, { display } = {}) {
  const wizard = current();
  const text = String(instruction ?? '').trim();
  if (!wizard || !text || wizard.assistant.busy) return false;

  const assistant = wizard.assistant;
  const live = () => current() === wizard && wizard.assistant === assistant;
  const message = { role: 'user', content: text, display: display || text };
  assistant.messages.push(message);
  Object.assign(assistant, { busy: true, pending: '', status: 'Waiting for the model...', error: '' });
  notify('assistant');

  const controller = new AbortController();
  assistantAbort = controller;

  try {
    const result = await runAssistant({
      fileName: wizard.fileName,
      text: wizard.text,
      draft: wizard.draft,
      history: assistant.messages.map(({ role, content }) => ({ role, content })),
      signal: controller.signal,
      onProgress: ({ status, content }) => {
        if (!live()) return;
        if (status !== undefined) assistant.status = status;
        if (content !== undefined) assistant.pending = content;
        notify('assistant');
      },
    });
    if (!live()) return true;

    const before = normalizeProfile(wizard.draft);
    if (result.profile) wizard.draft = result.profile;
    assistant.messages.push({
      role: 'assistant',
      content: result.reply,
      display: result.explanation || (result.profile ? 'Updated the configuration.' : ''),
      changes: result.profile ? diffProfiles(before, result.profile) : [],
      problems: result.problems,
    });
    wizard.error = '';
    schedulePreview(0);
    return true;
  } catch (error) {
    if (!live()) return false;
    const at = assistant.messages.indexOf(message);
    if (at !== -1) assistant.messages.splice(at, 1);
    assistant.error = error.name === 'AbortError' ? 'Stopped.' : error.message;
    return false;
  } finally {
    if (assistantAbort === controller) assistantAbort = null;
    if (live()) {
      Object.assign(assistant, { busy: false, pending: '', status: '' });
      notify('all');
    }
  }
}

export function generate() {
  return ask(GENERATE_INSTRUCTION, { display: GENERATE_DISPLAY });
}

export function stopAssistant() {
  assistantAbort?.abort();
}

export function clearAssistant() {
  const wizard = current();
  if (!wizard || wizard.assistant.busy) return;
  wizard.assistant = emptyAssistant();
  notify('assistant');
}

/* ------------------------------------------------------------------ *
 * Finishing
 * ------------------------------------------------------------------ */

async function ensureAttached(fileId) {
  const meta = findFile(fileId);
  if (!meta || !usableMethods(profileOf(meta)).length) return;
  if ((currentChat()?.fileIds || []).includes(fileId)) return;
  await toggleChatFile(fileId);
}

/** This file is done: attach it if asked, then open the next queued one or close. */
async function finish(wizard) {
  if (wizard.attachOnSave) await ensureAttached(wizard.fileId);
  const pending = stillUnconfigured(wizard.queue);
  if (pending.length) {
    await openWizard(pending[0], { queue: pending.slice(1) });
    return;
  }
  closeWizard();
}

/** Search this file with an existing profile, unchanged. */
export async function useProfile(id) {
  const wizard = current();
  if (!wizard || wizard.saving || !findProfile(id)) return;
  wizard.saving = true;
  try {
    await profiles.assignProfile([wizard.fileId], id);
    if (current() === wizard) await finish(wizard);
  } catch (error) {
    if (current() === wizard) {
      wizard.error = error.message;
      notify('all');
    }
  } finally {
    wizard.saving = false;
  }
}

export async function deleteProfile(id) {
  await profiles.deleteProfile(id);
  const wizard = current();
  if (!wizard) return;
  if (wizard.baseProfileId === id) {
    wizard.baseProfileId = null;
    wizard.draft.id = '';
  }
  if (!wizardSteps(wizard).includes(wizard.step)) wizard.step = 'methods';
  notify('all');
}

/**
 * Save the draft — over the profile it started from (`mode` 'update'), or as
 * a new profile — and assign it to this file and, if chosen, to the other
 * unconfigured files with its extensions.
 */
export async function save(mode) {
  const wizard = current();
  if (!wizard || wizard.saving) return;

  const profile = normalizeProfile(wizard.draft);
  const errors = validateProfile(profile, { forSave: true });
  if (errors.length) {
    wizard.error = errors.join(' ');
    notify('all');
    return;
  }

  const update = mode === 'update' && Boolean(findProfile(wizard.baseProfileId));
  if (update) profile.id = wizard.baseProfileId;

  wizard.saving = true;
  try {
    const others = wizard.applyToOthers ? otherUnconfiguredFiles(wizard).map((file) => file.id) : [];
    const saved = await profiles.saveProfile(profile, { asNew: !update });
    await profiles.assignProfile([wizard.fileId, ...others], saved.id);
    if (current() === wizard) await finish(wizard);
  } catch (error) {
    if (current() === wizard) {
      wizard.error = error.message;
      notify('all');
    }
  } finally {
    wizard.saving = false;
  }
}
