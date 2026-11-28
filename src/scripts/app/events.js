import { $ } from '../ui/dom.js';
import { runCommand } from './commands.js';
import { EVENTS } from '../store/events.js';
import { state, emit, setSession, persistPrefs } from '../store/state.js';
import { rememberExpandedScroll } from '../ui/components/attachments.js';
import {
  toggleCodeBlock,
  syncCodeOverlay,
  noteCodeScrollGesture,
  scrolledJustNow,
  isOnScrollbar,
} from '../ui/code-collapse.js';
import { isImageFile } from '../services/images.js';

/**
 * A single delegated listener resolves `data-command` attributes against the
 * registry. There is no `window.foo = foo` and no inline `onclick` anywhere.
 */

function contextFor(element, event) {
  const owner = element.closest('[data-id]');
  const message = element.closest('[data-index]');
  const call = element.closest('[data-call]');
  const block = element.closest('[data-block]');
  const attachment = element.closest('[data-attachment]');
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
    // An image's position among its message's attachments.
    attachment: attachment ? Number.parseInt(attachment.dataset.attachment, 10) : undefined,
  };
}

/**
 * Commands that run when a mouse or pen button goes down rather than on the
 * click. Their elements live in rows a streaming reply redraws many times a
 * second: the header pressed may be gone before the button comes back up,
 * and then no click ever fires. Opening a tool call while it streams in, or
 * a thinking box while it thinks, must not depend on luck. Touch and the
 * keyboard still go through `click`.
 */
const PRESS_COMMANDS = new Set(['message.toggleCall', 'message.toggleCollapsed']);
/** A click this soon after a press that already ran its command is that same press. */
const PRESS_CLICK_MS = 1000;

function installCommandDelegation() {
  let pressedAt = -Infinity;

  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = event.target.closest('[data-command]');
    if (!target || !PRESS_COMMANDS.has(target.dataset.command)) return;
    if (event.target.matches('input, textarea, select')) return;
    pressedAt = performance.now();
    runCommand(target.dataset.command, contextFor(target, event));
  });

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-command]');
    if (!target) return;
    // A form control inside a command element (the role select in an open
    // thinking header) must not trigger it.
    if (event.target.matches('input, textarea, select')) return;
    if (PRESS_COMMANDS.has(target.dataset.command) && performance.now() - pressedAt < PRESS_CLICK_MS) {
      pressedAt = -Infinity;
      return;
    }
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
 * While a message is being edited, a click on its rendered markdown selects
 * the block to edit instead of doing what it normally would: a link inside
 * does not navigate. Ctrl/Cmd+Click keeps its copy meaning. Only the message's
 * own top-level blocks count, never something nested inside one.
 *
 * The native default is cancelled on `mousedown`, not just on `click`: that is
 * where the browser starts a text selection, extends it (Shift+Click), or grows
 * it on a double or triple click. `user-select: none` does not stop a
 * selection anchored elsewhere from being stretched across the message, so
 * without this, picking a block could highlight the whole transcript. It also
 * keeps focus in the composer.
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
 * A click on a collapsible code block opens or closes it, keeping its code
 * where it is on screen; a collapsing block's preview lands where the click
 * was, room permitting (`ui/code-collapse.js`). Not inside the message being
 * edited: there a click picks the block to edit, and the view must stay
 * exactly as it was.
 *
 * A collapsed block scrolls on its own, so a click is not a toggle when it
 * lands on the block's scrollbar, or comes right after a wheel or touch
 * scroll of it (a trackpad tap that only stopped the scroll).
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
    if (isOnScrollbar(pre, event) || scrolledJustNow(pre)) return;

    toggleCodeBlock(pre, { clientY: event.clientY });
  });

  const noteGesture = (event) => noteCodeScrollGesture(event.target);
  document.addEventListener('wheel', noteGesture, { passive: true });
  document.addEventListener('touchmove', noteGesture, { passive: true });
}

/**
 * `scroll` does not bubble, so it is caught on the way down. It keeps a code
 * preview's fade in step with how far it is scrolled, and remembers how far
 * the opened image is scrolled, so a redraw can give it back.
 */
function installScrollTracking() {
  document.addEventListener(
    'scroll',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.matches('pre.collapsible-code')) syncCodeOverlay(target);
      else if (target.matches('.attachment-viewer')) rememberExpandedScroll(target);
    },
    { capture: true, passive: true },
  );
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

/* ------------------------------------------------------------------ *
 * Images
 * ------------------------------------------------------------------ */

/** The image files of a paste or drop. Some browsers only expose clipboard files as items. */
function imageFilesFrom(transfer) {
  if (!transfer) return [];
  let files = [...(transfer.files || [])];
  if (!files.length && transfer.items) {
    files = [...transfer.items]
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter(Boolean);
  }
  return files.filter(isImageFile);
}

function carriesFiles(event) {
  return [...(event.dataTransfer?.types || [])].includes('Files');
}

/**
 * Images come in by the attach button, by pasting, or by dropping. A paste
 * counts when it is aimed at the composer or at nothing in particular, never
 * at another field. Text in the same paste still lands in the composer as
 * usual: a textarea ignores the image part.
 */
function installAttachmentInput() {
  document.addEventListener('paste', (event) => {
    if (state.session.view !== 'chat') return;
    const field =
      event.target instanceof Element ? event.target.closest('input, textarea, select') : null;
    if (field && field.id !== 'chat-input') return;
    const files = imageFilesFrom(event.clipboardData);
    if (files.length) runCommand('attachments.add', { event, files });
  });

  const main = $('.main');
  if (main) {
    let depth = 0;
    const clear = () => {
      depth = 0;
      main.classList.remove('drop-target');
    };

    main.addEventListener('dragenter', (event) => {
      if (!carriesFiles(event) || state.session.view !== 'chat') return;
      depth++;
      main.classList.add('drop-target');
    });
    main.addEventListener('dragleave', (event) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) main.classList.remove('drop-target');
    });
    main.addEventListener('dragover', (event) => {
      if (!carriesFiles(event) || state.session.view !== 'chat') return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    main.addEventListener('drop', (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      clear();
      if (state.session.view !== 'chat') return;
      const files = imageFilesFrom(event.dataTransfer);
      if (files.length) runCommand('attachments.add', { event, files });
    });
  }

  // A file dropped anywhere else must not make the browser navigate to it.
  window.addEventListener('dragover', (event) => {
    if (carriesFiles(event)) event.preventDefault();
  });
  window.addEventListener('drop', (event) => {
    if (carriesFiles(event)) event.preventDefault();
    main?.classList.remove('drop-target');
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
  const resizable = [$('#chat-input'), $('#thinking-input'), $('#chat-search-input')].filter(
    Boolean,
  );

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const height = entry.target.style.height;
      if (!height || height === state.session.promptHeight) continue;
      setSession({ promptHeight: height }, { silent: true });
      persistPrefs();
      for (const input of resizable) {
        if (input !== entry.target) input.style.height = height;
      }
    }
  });

  for (const input of resizable) {
    input.style.height = state.session.promptHeight;
    observer.observe(input);
  }

  const settingsInput = $('#settings-input');
  if (settingsInput) {
    settingsInput.addEventListener('input', (event) => {
      setSession({ settingsDraft: event.target.value }, { silent: true });
    });
  }

  // The chats page re-searches as the query is typed; only its results redraw.
  const searchInput = $('#chat-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      setSession(
        { chatSearch: { ...state.session.chatSearch, query: event.target.value } },
        { silent: true },
      );
      emit(EVENTS.SEARCH);
    });
  }
}

export function installEventHandlers() {
  installCommandDelegation();
  installEditSelection();
  installCodeCollapseDelegation();
  installScrollTracking();
  installCopyAffordances();
  installAttachmentInput();
  installModifierTracking();
  installEditorBindings();
}
