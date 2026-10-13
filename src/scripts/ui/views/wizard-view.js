import { $ } from '../dom.js';
import { state, findFile, findProfile, isConfigured, embeddingsEnabled } from '../../store/state.js';
import { escapeHTML } from '../../core/format.js';
import { PARSER_PRESETS, CUSTOM_PARSER } from '../../core/parsers.js';
import {
  SEARCH_METHODS,
  METHOD_LABELS,
  METHOD_DESCRIPTIONS,
  normalizeProfile,
  enabledMethods,
  parserLabel,
} from '../../core/rag-profile.js';
import { sectionLabel, sectionTokens, lineAt, breadcrumb } from '../../core/sections.js';
import { REGEX_FLAGS } from '../../core/rag-search.js';
import { renderMarkdown, enhance } from '../markdown.js';
import {
  STEP_LABELS,
  ASSISTANT_STEPS,
  wizardSteps,
  profileChoices,
  profileUsage,
  otherUnconfiguredFiles,
} from '../../services/wizard.js';
import { ICON_DELETE } from '../icons.js';

/**
 * The file search configurator, drawn in the main panel.
 *
 * Every form control carries `data-field` (a dotted path into the draft, or
 * into `data-scope`: 'test' or 'wizard'); `app/events.js` routes its input to
 * `wizard.setField`, so no value is ever read back out of the DOM. The outline
 * preview, the test output and the assistant repaint on their own, so typing
 * elsewhere keeps its focus.
 */

const OUTLINE_LIMIT = 300;
const CUSTOM_DESCRIPTION =
  'Your own JavaScript: the body of an async function that receives text and fileName and returns [{ start, path }] boundaries. The assistant can write it for you.';

/** The wizard last drawn: a different one starts at the top. */
let lastRendered = null;

/* ------------------------------------------------------------------ *
 * Controls
 * ------------------------------------------------------------------ */

function dataAttrs(field, { scope = '', rerender = false } = {}) {
  return (
    `data-field="${escapeHTML(field)}"` +
    (scope ? ` data-scope="${escapeHTML(scope)}"` : '') +
    (rerender ? ' data-rerender="change"' : '')
  );
}

function fieldHTML(label, control, hint = '') {
  return `
    <div class="wizard-field">
      <label><span class="wizard-label">${escapeHTML(label)}</span>${control}</label>
      ${hint ? `<p class="wizard-hint">${escapeHTML(hint)}</p>` : ''}
    </div>`;
}

function inputHTML(field, value, { type = 'text', scope = '', placeholder = '', rerender = false, extra = '' } = {}) {
  const attributes = dataAttrs(field, { scope, rerender });
  const hint = placeholder ? ` placeholder="${escapeHTML(placeholder)}"` : '';
  return `<input type="${type}" ${attributes} value="${escapeHTML(value ?? '')}"${hint}${extra} />`;
}

function checkHTML(field, checked, label, hint = '', { scope = '', disabled = false } = {}) {
  return `
    <label class="wizard-check${disabled ? ' disabled' : ''}">
      <input type="checkbox" ${dataAttrs(field, { scope })}${checked ? ' checked' : ''}${disabled ? ' disabled' : ''} />
      <span>
        <strong>${escapeHTML(label)}</strong>
        ${hint ? `<span class="wizard-hint">${escapeHTML(hint)}</span>` : ''}
      </span>
    </label>`;
}

/* ------------------------------------------------------------------ *
 * Frame
 * ------------------------------------------------------------------ */

function headerHTML(wizard) {
  const meta = findFile(wizard.fileId);
  const configured = Boolean(meta) && isConfigured(meta);
  const status = configured
    ? 'Changes apply once saved.'
    : 'This file cannot be searched until its configuration is saved.';
  const count = wizard.queue.length;
  const waiting = count ? ` ${count} more file${count === 1 ? '' : 's'} waiting after this one.` : '';

  return `
    <div class="settings-header"><h2>Configure file search</h2></div>
    <p class="settings-subtitle"><strong>${escapeHTML(wizard.fileName)}</strong> · ${wizard.text.length.toLocaleString('en-US')} characters. ${status}${waiting}</p>`;
}

function stepsHTML(wizard) {
  const buttons = wizardSteps(wizard)
    .map(
      (step, index) =>
        `<button class="${step === wizard.step ? 'active' : ''}" data-command="wizard.step" data-key="${step}">${index + 1}. ${escapeHTML(STEP_LABELS[step])}</button>`,
    )
    .join('');
  return `<nav class="wizard-steps">${buttons}</nav>`;
}

/* ------------------------------------------------------------------ *
 * Steps
 * ------------------------------------------------------------------ */

function profileStepHTML(wizard) {
  const rows = profileChoices(wizard.fileName)
    .map(({ profile, matches, usedBy }) => {
      const methods = enabledMethods(profile).map((method) => METHOD_LABELS[method]).join(', ');
      const extensions = profile.extensions.map((extension) => `.${extension}`).join(' ');
      const badges =
        (matches ? '<span class="badge">matches this file</span>' : '') +
        (wizard.baseProfileId === profile.id ? '<span class="badge">current</span>' : '');
      const id = escapeHTML(profile.id);
      return `
        <div class="profile-row${matches ? ' match' : ''}">
          <div class="profile-info">
            <div class="profile-name">${escapeHTML(profile.name)}${badges}</div>
            <div class="profile-meta">${escapeHTML(extensions)} · ${escapeHTML(methods)} · ${escapeHTML(parserLabel(profile))} · used by ${usedBy} file${usedBy === 1 ? '' : 's'}</div>
          </div>
          <div class="profile-actions">
            <button data-command="wizard.useProfile" data-key="${id}" title="Search this file with this profile as it is">Use</button>
            <button data-command="wizard.editProfile" data-key="${id}" title="Start from this profile and change it">Edit</button>
            <button class="icon-btn" data-command="wizard.deleteProfile" data-key="${id}" title="Delete this profile">${ICON_DELETE}</button>
          </div>
        </div>`;
    })
    .join('');

  return `
    <section class="wizard-section">
      <h3>Choose a profile</h3>
      <p class="wizard-hint">A profile describes how one kind of document is searched. Use an existing one as it is, start from one, or create a new one.</p>
      ${rows || '<p class="wizard-hint">No profiles yet.</p>'}
      <div class="wizard-actions">
        <button data-command="wizard.newProfile">Create a new profile</button>
      </div>
    </section>`;
}

function methodsStepHTML(wizard) {
  const profile = normalizeProfile(wizard.draft);
  const canEmbed = embeddingsEnabled();

  const checks = SEARCH_METHODS.map((method) => {
    const checked = profile.methods[method];
    const blocked = method === 'embeddings' && !canEmbed;
    const note = blocked
      ? ' No embeddings model is configured: set Embeddings Model in the advanced settings (Alt+I) to use it.'
      : '';
    return checkHTML(`methods.${method}`, checked, METHOD_LABELS[method], `${METHOD_DESCRIPTIONS[method]}${note}`, {
      disabled: blocked && !checked,
    });
  }).join('');

  return `
    <section class="wizard-section">
      <h3>Search methods</h3>
      <p class="wizard-hint">Choose how the chat model may search files like this one. Each method becomes a tool, and the tool descriptions tell the model when to switch between them. At least one is required.</p>
      ${checks}
    </section>`;
}

function presetOptionsHTML(preset, values) {
  return Object.entries(PARSER_PRESETS[preset].options)
    .map(([key, spec]) => {
      const path = `parser.options.${key}`;
      const value = values[key] ?? spec.default;
      if (spec.type === 'boolean') return checkHTML(path, Boolean(value), spec.label, spec.hint);
      return fieldHTML(
        spec.label,
        inputHTML(path, value, { type: spec.type === 'number' ? 'number' : 'text' }),
        spec.hint,
      );
    })
    .join('');
}

function structureStepHTML(wizard) {
  const parser = wizard.draft.parser || {};
  const preset =
    parser.preset === CUSTOM_PARSER || PARSER_PRESETS[parser.preset]
      ? parser.preset
      : normalizeProfile(wizard.draft).parser.preset;

  const options = [
    ...Object.entries(PARSER_PRESETS).map(([name, spec]) => [name, spec.label]),
    [CUSTOM_PARSER, 'Custom code'],
  ]
    .map(
      ([value, label]) =>
        `<option value="${escapeHTML(value)}"${value === preset ? ' selected' : ''}>${escapeHTML(label)}</option>`,
    )
    .join('');

  const description = preset === CUSTOM_PARSER ? CUSTOM_DESCRIPTION : PARSER_PRESETS[preset].description;
  const details =
    preset === CUSTOM_PARSER
      ? fieldHTML(
          'Parser code',
          `<textarea class="wizard-code" ${dataAttrs('parser.code')} spellcheck="false">${escapeHTML(parser.code ?? '')}</textarea>`,
          'Runs in this page on the whole file, on every change here and whenever the file is indexed.',
        )
      : presetOptionsHTML(preset, parser.options || {});

  return `
    <section class="wizard-section">
      <h3>Document structure</h3>
      <p class="wizard-hint">Search results are whole sections of the document, labelled with their place in its hierarchy. Choose how the file is split; the outline below follows as you go.</p>
      ${fieldHTML('Parser', `<select ${dataAttrs('parser.preset')}>${options}</select>`, description)}
      ${details}
      ${fieldHTML(
        'Maximum section size (tokens)',
        inputHTML('maxSectionTokens', wizard.draft.maxSectionTokens, { type: 'number', extra: ' min="50"' }),
        'Longer sections are embedded in pieces and shown as an excerpt around the match.',
      )}
    </section>
    <section class="wizard-section">
      <h3>Outline of this file</h3>
      <div id="wizard-preview" class="wizard-preview"></div>
    </section>`;
}

function testHTML(wizard) {
  const test = wizard.test;
  const regex = test.method === 'regex';
  const methods = [
    ['text', 'Text'],
    ['regex', 'Regex'],
  ]
    .map(([value, label]) => `<option value="${value}"${test.method === value ? ' selected' : ''}>${label}</option>`)
    .join('');

  return `
    <section class="wizard-section">
      <h3>Try it</h3>
      <p class="wizard-hint">Search this file with the configuration as it stands and see exactly what the model would receive. Semantic search can be tried in a chat once the profile is saved and the file indexed.</p>
      <div class="wizard-test-row">
        <select ${dataAttrs('method', { scope: 'test' })}>${methods}</select>
        <input type="text" ${dataAttrs('query', { scope: 'test' })} data-test-query
               value="${escapeHTML(test.query ?? '')}"
               placeholder="${regex ? 'Pattern, e.g. v\\d+\\.\\d+' : 'Phrase to find'}" />
        ${
          regex
            ? `<input type="text" class="wizard-flags" ${dataAttrs('flags', { scope: 'test' })} value="${escapeHTML(test.flags ?? '')}" placeholder="flags" title="Any of ${REGEX_FLAGS}" />`
            : ''
        }
        <button data-command="wizard.test">Search</button>
      </div>
      <div id="wizard-test"></div>
    </section>`;
}

function outputStepHTML(wizard) {
  const draft = wizard.draft;
  const context = draft.context || {};
  const profile = normalizeProfile(draft);

  const threshold = profile.methods.embeddings
    ? fieldHTML(
        'Similarity threshold (0-1)',
        inputHTML('threshold', draft.threshold, { type: 'number', extra: ' step="0.01" min="0" max="1"' }),
        'Semantic matches scoring below this are dropped. 0 keeps everything.',
      )
    : '';

  return `
    <section class="wizard-section">
      <h3>What the model receives</h3>
      ${checkHTML(
        'context.breadcrumb',
        profile.context.breadcrumb,
        'Label results with their place in the document',
        'Each result starts with its path, e.g. "Installation › Linux", and its line numbers.',
      )}
      ${fieldHTML(
        'Neighbouring sections',
        inputHTML('context.neighbors', context.neighbors, { type: 'number', extra: ' min="0" max="5"' }),
        'How many sections before and after each match to include for context (0-5).',
      )}
      ${fieldHTML(
        'Header lines',
        inputHTML('context.headerLines', context.headerLines, { type: 'number', extra: ' min="0" max="50"' }),
        'Always include the first N lines of the file above its results, e.g. 1 for a CSV header row.',
      )}
      ${threshold}
      ${fieldHTML(
        'Notes for the chat model',
        `<textarea ${dataAttrs('notes')} rows="3">${escapeHTML(draft.notes ?? '')}</textarea>`,
        'Added to the search tool description next to each file using this profile: what these documents are and how best to search them. Write about the kind of document, since the profile is reused.',
      )}
    </section>
    ${testHTML(wizard)}`;
}

function saveStepHTML(wizard) {
  const draft = wizard.draft;
  const profile = normalizeProfile(draft);
  const others = otherUnconfiguredFiles(wizard);
  const base = wizard.baseProfileId ? findProfile(wizard.baseProfileId) : null;
  const extensions = Array.isArray(draft.extensions) ? draft.extensions.join(', ') : draft.extensions ?? '';
  const methods = enabledMethods(profile).map((method) => METHOD_LABELS[method]).join(', ') || 'none';

  const othersHTML = others.length
    ? checkHTML(
        'applyToOthers',
        wizard.applyToOthers,
        `Also use it for ${others.length} other unconfigured file${others.length === 1 ? '' : 's'}`,
        others.map((file) => file.name).join(', '),
        { scope: 'wizard' },
      )
    : '';

  const usage = base ? profileUsage(base.id) : 0;
  const usageNote =
    base && usage
      ? `<p class="wizard-hint">"${escapeHTML(base.name)}" is used by ${usage} file${usage === 1 ? '' : 's'}. Updating it re-indexes all of them; saving as a new profile leaves them as they are.</p>`
      : '';

  const actions = base
    ? `<button data-command="wizard.save" data-key="update">Update "${escapeHTML(base.name)}"</button>
       <button data-command="wizard.save" data-key="new">Save as a new profile</button>`
    : '<button data-command="wizard.save" data-key="new">Save profile</button>';

  return `
    <section class="wizard-section">
      <h3>Save the profile</h3>
      <p class="wizard-hint">A profile can be reused for other files. Files with one of its extensions are offered it first.</p>
      ${fieldHTML('Name', inputHTML('name', draft.name, { placeholder: 'e.g. Markdown documentation' }))}
      ${fieldHTML(
        'File extensions',
        inputHTML('extensions', extensions, { placeholder: 'e.g. md, markdown', rerender: true }),
        'Comma-separated, without dots.',
      )}
      <p class="wizard-summary">Search methods: <strong>${escapeHTML(methods)}</strong> · Parser: <strong>${escapeHTML(parserLabel(profile))}</strong> · Sections up to <strong>${profile.maxSectionTokens}</strong> tokens</p>
      ${othersHTML}
      ${usageNote}
      <div class="wizard-actions">${actions}</div>
    </section>`;
}

const STEP_RENDERERS = {
  profile: profileStepHTML,
  methods: methodsStepHTML,
  structure: structureStepHTML,
  output: outputStepHTML,
  save: saveStepHTML,
};

/* ------------------------------------------------------------------ *
 * Public renders
 * ------------------------------------------------------------------ */

export function renderWizardView({ resetScroll = false } = {}) {
  const container = $('#chat-container');
  if (!container) return;

  const wizard = state.session.wizard;
  if (!wizard) {
    lastRendered = null;
    container.innerHTML = '<h3 class="chat-placeholder">Nothing to configure.</h3>';
    return;
  }

  const fresh = wizard !== lastRendered;
  lastRendered = wizard;
  const scroll = container.scrollTop;

  const body = (STEP_RENDERERS[wizard.step] || methodsStepHTML)(wizard);
  const error = wizard.error ? `<div class="wizard-error">${escapeHTML(wizard.error)}</div>` : '';
  const assistant = ASSISTANT_STEPS.includes(wizard.step)
    ? '<section id="wizard-assistant" class="wizard-section wizard-assistant"></section>'
    : '';

  container.innerHTML = `
    <div class="wizard">
      ${headerHTML(wizard)}
      ${stepsHTML(wizard)}
      ${error}
      ${body}
      ${assistant}
    </div>`;

  renderWizardPreview();
  renderWizardTest();
  renderWizardAssistant();

  container.scrollTop = resetScroll || fresh ? 0 : scroll;
}

/** The outline of the file under the draft: figures, warnings, and the section tree. */
export function renderWizardPreview() {
  const container = $('#wizard-preview');
  const wizard = state.session.wizard;
  if (!container || !wizard) return;

  const { busy, error, sections, stats } = wizard.preview;
  if (!sections) {
    container.innerHTML = `<p class="wizard-hint">${busy ? 'Parsing...' : 'No outline yet.'}</p>`;
    return;
  }

  const maxTokens = normalizeProfile(wizard.draft).maxSectionTokens;
  const summary =
    `${stats.count.toLocaleString('en-US')} section${stats.count === 1 ? '' : 's'} · ` +
    `deepest level ${stats.maxDepth} · largest about ${stats.largestTokens.toLocaleString('en-US')} tokens` +
    (busy ? ' · updating...' : '');

  const errorHTML = error
    ? `<div class="wizard-error">The parser failed, so the file is one section: ${escapeHTML(error)}</div>`
    : '';
  const warnings = stats.warnings
    .map((warning) => `<p class="outline-warning${warning.severe ? ' severe' : ''}">${escapeHTML(warning.message)}</p>`)
    .join('');

  const rows = sections
    .slice(0, OUTLINE_LIMIT)
    .map((section) => {
      const tokens = sectionTokens(section);
      const label = section.preamble
        ? '(before the first section)'
        : sectionLabel(section, wizard.text) || '(blank)';
      const first = lineAt(wizard.lines, section.start);
      const last = lineAt(wizard.lines, Math.max(section.start, section.end - 1));
      const lines = first === last ? `line ${first}` : `lines ${first}–${last}`;
      const classes = ['outline-row'];
      if (tokens > maxTokens) classes.push('oversized');
      if (section.preamble) classes.push('preamble');
      return `
        <div class="${classes.join(' ')}" style="--depth: ${Math.max(0, section.path.length - 1)}"
             title="${escapeHTML(breadcrumb(section.path))}">
          <span class="outline-label">${escapeHTML(label)}</span>
          <span class="outline-size">${lines} · ~${tokens.toLocaleString('en-US')}</span>
        </div>`;
    })
    .join('');
  const more =
    sections.length > OUTLINE_LIMIT
      ? `<div class="outline-more">... and ${(sections.length - OUTLINE_LIMIT).toLocaleString('en-US')} more sections</div>`
      : '';

  container.innerHTML = `
    <p class="outline-summary">${summary}</p>
    ${errorHTML}
    ${warnings}
    <div class="outline-tree">${rows}${more}</div>`;
}

/** The result of the last test search, exactly as the model would receive it. */
export function renderWizardTest() {
  const container = $('#wizard-test');
  const wizard = state.session.wizard;
  if (!container || !wizard) return;

  const { busy, error, output } = wizard.test;
  if (busy) {
    container.innerHTML = '<p class="wizard-hint">Searching...</p>';
    return;
  }
  if (error) {
    container.innerHTML = `<div class="wizard-error">${escapeHTML(error)}</div>`;
    return;
  }
  if (!output) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `<div class="msg-content wizard-output">${renderMarkdown(output)}</div>`;
  enhance(container);
}

function assistantMessageHTML(message) {
  if (message.role === 'user') {
    return `<div class="assistant-msg user"><div class="msg-content">${renderMarkdown(message.display || message.content)}</div></div>`;
  }

  const problems = Array.isArray(message.problems) ? message.problems : [];
  const changes = Array.isArray(message.changes) ? message.changes : [];
  let changesHTML = '';
  if (changes.length) {
    changesHTML = `<p class="assistant-changes">Changed: ${escapeHTML(changes.join(', '))}.</p>`;
  } else if (!problems.length) {
    changesHTML = '<p class="assistant-changes">No changes.</p>';
  }
  const problemsHTML = problems.length
    ? `<div class="assistant-problems"><p>Problems it could not fix:</p><ul>${problems
        .map((problem) => `<li>${escapeHTML(problem)}</li>`)
        .join('')}</ul></div>`
    : '';

  return `
    <div class="assistant-msg model">
      <div class="msg-content">${renderMarkdown(message.display || '')}</div>
      ${changesHTML}
      ${problemsHTML}
    </div>`;
}

/** The assistant: what it uses, the conversation, and the reply streaming in. */
export function renderWizardAssistant() {
  const container = $('#wizard-assistant');
  const wizard = state.session.wizard;
  if (!container || !wizard) return;

  const assistant = wizard.assistant;
  const model = state.data.config.lastModel;
  const intro = model
    ? `Uses <strong>${escapeHTML(model)}</strong> (the model selected for chatting) with a sample and statistics of this file. It edits the configuration above and checks its parser on the whole file; nothing is saved until you save. Ask for changes in the box below (Ctrl+Enter).`
    : 'Select a model in the chat model dropdown to use the assistant.';

  const log = assistant.messages.map(assistantMessageHTML).join('');
  const pending = assistant.busy
    ? `<div class="assistant-msg model pending">
         <p class="assistant-status">${escapeHTML(assistant.status || 'Working...')}</p>
         ${assistant.pending ? `<div class="msg-content">${renderMarkdown(assistant.pending)}</div>` : ''}
       </div>`
    : '';
  const disabled = assistant.busy ? ' disabled' : '';

  container.innerHTML = `
    <h3>Assistant</h3>
    <p class="wizard-hint">${intro}</p>
    <div class="wizard-actions">
      <button data-command="wizard.generate"${disabled}>Generate configuration</button>
      ${assistant.messages.length ? `<button data-command="wizard.clearAssistant"${disabled}>Clear conversation</button>` : ''}
    </div>
    ${log || pending ? `<div class="assistant-log">${log}${pending}</div>` : ''}
    ${assistant.error ? `<div class="wizard-error">${escapeHTML(assistant.error)}</div>` : ''}`;
  enhance(container);
}
