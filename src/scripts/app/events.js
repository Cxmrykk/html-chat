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
  return {
    event,
    element,
    id: owner?.dataset.id,
    index: message ? Number.parseInt(message.dataset.index, 10) : undefined,
    key: element.dataset.key,
  };
}

function installCommandDelegation() {
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-command]');
    if (!target) return;
    // Text inputs inside a command element (the embed config fields) must not
    // trigger it.
    if (event.target.matches('input, textarea, select')) return;
    runCommand(target.dataset.command, contextFor(target, event));
  });

  document.addEventListener('change', (event) => {
    const select = event.target.closest('select[data-command]');
    if (select) {
      runCommand(select.dataset.command, contextFor(select, event));
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

/** Live-bind the two textareas so no value is ever read back out of the DOM. */
function installEditorBindings() {
  const chatInput = $('#chat-input');
  if (chatInput) {
    chatInput.style.height = state.session.promptHeight;
    chatInput.addEventListener('input', renderSendButton);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.target.style.height;
        if (!height || height === state.session.promptHeight) continue;
        setSession({ promptHeight: height }, { silent: true });
        persistPrefs();
      }
    });
    observer.observe(chatInput);
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
  installCopyAffordances();
  installModifierTracking();
  installEditorBindings();
}
