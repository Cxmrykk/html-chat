import { $ } from '../ui/dom.js';
import { runCommand } from './commands.js';
import { state, setSession, persistPrefs } from '../store/state.js';
import { renderSendButton } from '../ui/components/input-area.js';

/**
 * A single delegated listener resolves `data-command` attributes against the
 * registry. There is no `window.foo = foo` and no inline `onclick` anywhere.
 */

function contextFor(element, event) {
  const owner = element.closest('[data-id]');
  const message = element.closest('[data-index]');
  const call = element.closest('[data-call]');
  const block = element.closest('[data-block]');
  return {
    event,
    element,
    id: owner?.dataset.id,
    index: message ? Number.parseInt(message.dataset.index, 10) : undefined,
    key: element.dataset.key,
    // A tool call's `"round.call"` position inside its tools box.
    call: call?.dataset.call,
    // A top-level markdown block's position inside a message body.
    block: block ? Number.parseInt(block.dataset.block, 10) : undefined,
  };
}

function installCommandDelegation() {
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-command]');
    if (!target) return;
    // A form control inside a command element (the role select in an open
    // thinking header) must not trigger it.
    if (event.target.matches('input, textarea, select')) return;
    runCommand(target.dataset.command, contextFor(target, event));
  });

  // Catch Ctrl+Click specifically on the model select so we don't open the native dropdown
  document.addEventListener('mousedown', (event) => {
    const select = event.target.closest('#model-select');
    if (select && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      runCommand('thinking.edit', contextFor(select, event));
    }
  });

  document.addEventListener('change', (event) => {
    const cmdElement = event.target.closest('select[data-command], input[data-command]');
    if (cmdElement) {
      runCommand(cmdElement.dataset.command, contextFor(cmdElement, event));
      return;
    }
    if (event.target.classList.contains('role-select')) {
      const message = event.target.closest('.msg');
      if (!message) return;
      runCommand('message.setRole', {
        event,
        element: event.target,
        index: Number.parseInt(message.dataset.index, 10),
      });
    }
  });
}

/**
 * While a message is being edited, a click on its rendered markdown picks the
 * part to edit instead of doing what it normally would: a link inside does not
 * navigate. Ctrl/Cmd+Click keeps its copy meaning. Only the message's own
 * top-level blocks count, never something nested inside one.
 *
 * The native default is cancelled on `mousedown`, not just on `click`: that is
 * where the browser starts a text selection, extends it (Shift+Click, which
 * here means "keep what is above"), or grows it on a double or triple click.
 * `user-select: none` does not stop a selection anchored elsewhere from being
 * stretched across the message, so without this, picking a part could
 * highlight the whole transcript. It also keeps focus in the composer.
 */
function installEditSelection() {
  const container = $('#chat-container');
  if (!container) return;

  const inEditedContent = (event) =>
    state.session.editingMessageIndex !== null &&
    !(event.ctrlKey || event.metaKey) &&
    event.target.closest('.msg.editing > .msg-content');

  container.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || !inEditedContent(event)) return;
    event.preventDefault();
  });

  container.addEventListener('click', (event) => {
    const content = inEditedContent(event);
    if (!content) return;
    event.preventDefault();

    const block = event.target.closest('.md-block');
    if (!block || block.parentElement !== content) return;
    runCommand('message.selectBlock', contextFor(block, event));
  });
}

/**
 * A click on a collapsible code block opens or closes it. Not inside the
 * message being edited: there a click picks the block to edit, and the view
 * must stay exactly as it was.
 */
function installCodeCollapseDelegation() {
  document.addEventListener('click', (event) => {
    if (event.ctrlKey || event.metaKey) return;
    if (event.target.closest('.msg.editing > .msg-content')) return;
    
    // Ignore if user is selecting text
    const selection = window.getSelection();
    if (selection && selection.toString().trim() !== '') return;

    const pre = event.target.closest('pre.collapsible-code');
    if (!pre) return;
    
    pre.classList.toggle('collapsed');
  });
}

/** Ctrl/Alt-click affordances: copy code and math blocks. */
function installCopyAffordances() {
  const container = $('#chat-container');
  if (!container) return;

  container.addEventListener('click', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const target =
      event.target.closest('.katex') || event.target.closest('pre') || event.target.closest('code');
    if (!target) return;

    const text = target.classList.contains('katex')
      ? target.querySelector('annotation')?.textContent ||
        target.querySelector('.katex-mathml math')?.getAttribute('alttext') ||
        ''
      : target.innerText;

    if (!text) return;
    event.preventDefault();
    navigator.clipboard.writeText(text).then(() => {
      target.classList.add('flash');
      setTimeout(() => target.classList.remove('flash'), 100);
    });
  });
}

/** Body classes that drive the modifier-key hover styling. */
function installModifierTracking() {
  const toggle = (event) => {
    if (event.key === 'Control' || event.key === 'Meta') {
      document.body.classList.toggle('ctrl-down', event.type === 'keydown');
    }
    if (event.key === 'Alt') {
      document.body.classList.toggle('alt-down', event.type === 'keydown');
    }
  };
  window.addEventListener('keydown', toggle);
  window.addEventListener('keyup', toggle);
  window.addEventListener('blur', () => {
    document.body.classList.remove('ctrl-down', 'alt-down');
  });
}

/** Live-bind the textareas so no value is ever read back out of the DOM. */
function installEditorBindings() {
  const chatInput = $('#chat-input');
  const thinkInput = $('#thinking-input');

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const height = entry.target.style.height;
      if (!height || height === state.session.promptHeight) continue;
      setSession({ promptHeight: height }, { silent: true });
      persistPrefs();
      if (chatInput && chatInput !== entry.target) chatInput.style.height = height;
      if (thinkInput && thinkInput !== entry.target) thinkInput.style.height = height;
    }
  });

  if (chatInput) {
    chatInput.style.height = state.session.promptHeight;
    chatInput.addEventListener('input', renderSendButton);
    observer.observe(chatInput);
  }
  
  if (thinkInput) {
    thinkInput.style.height = state.session.promptHeight;
    observer.observe(thinkInput);
  }

  const settingsInput = $('#settings-input');
  if (settingsInput) {
    settingsInput.addEventListener('input', (event) => {
      setSession({ settingsDraft: event.target.value }, { silent: true });
    });
  }
}

export function installEventHandlers() {
  installCommandDelegation();
  installEditSelection();
  installCodeCollapseDelegation();
  installCopyAffordances();
  installModifierTracking();
  installEditorBindings();
}
