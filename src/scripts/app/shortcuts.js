import { $ } from '../ui/dom.js';
import { state } from '../store/state.js';
import { runCommand } from './commands.js';

/** Keyboard shortcuts. */

function scrollBetweenMessages(direction) {
  const container = $('#chat-container');
  if (!container) return;

  const messages = [...container.querySelectorAll('.msg')];
  if (!messages.length) return;

  if (direction === 'down') {
    const next = messages.find((element) => element.offsetTop - 15 > container.scrollTop + 5);
    container.scrollTop = next ? next.offsetTop - 15 : container.scrollHeight;
  } else {
    const previous = [...messages]
      .reverse()
      .find((element) => element.offsetTop - 15 < container.scrollTop - 5);
    container.scrollTop = previous ? previous.offsetTop - 15 : 0;
  }
}

function switchChat(direction) {
  const chats = state.data.chats;
  if (!chats.length) return;

  const current = Math.max(0, chats.findIndex((chat) => chat.id === state.data.currentChatId));
  const target = direction === 'up' ? current - 1 : current + 1;
  if (target < 0 || target >= chats.length) return;

  runCommand('chat.open', { id: chats[target].id, event: {} });
  requestAnimationFrame(() => {
    $('#chat-list .chat-item.active')?.scrollIntoView({ block: 'nearest' });
  });
}

function installSubmitShortcuts() {
  const submitFrom = (element, event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return false;
    event.preventDefault();

    if (element.id === 'settings-input') {
      runCommand('settings.save', { event });
      return true;
    }
    if (element.id === 'thinking-input') {
      runCommand('thinking.save', { event });
      return true;
    }
    if (element.id === 'wizard-input') {
      runCommand('wizard.ask', { event });
      return true;
    }
    if (state.session.editingMessageIndex !== null) {
      runCommand('message.saveEdit', { event });
      return true;
    }
    runCommand('chat.send', { event });
    return true;
  };

  for (const id of ['#chat-input', '#settings-input', '#thinking-input', '#wizard-input']) {
    $(id)?.addEventListener('keydown', (event) => submitFrom(event.target, event));
  }
}

/** Enter in the configurator's test box runs the test search. */
function installWizardShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    if (!event.target.matches?.('[data-test-query]')) return;
    event.preventDefault();
    runCommand('wizard.test', { event });
  });
}

export function installShortcuts() {
  installSubmitShortcuts();
  installWizardShortcuts();

  document.addEventListener('keydown', (event) => {
    const tag = document.activeElement?.tagName.toLowerCase();
    const inField = tag === 'input' || tag === 'textarea' || tag === 'select';

    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      const key = event.key.toLowerCase();
      const actions = {
        t: () => runCommand('chat.new', { event: {} }),
        w: () => state.data.currentChatId && runCommand('chat.delete', { id: state.data.currentChatId }),
        r: () => state.data.currentChatId && runCommand('chat.rename', { id: state.data.currentChatId }),
        p: () => runCommand('ui.toggleSidebar'),
        o: () => runCommand('ui.toggleTitle'),
        d: () => runCommand('ui.toggleTheme'),
        i: () => runCommand('settings.toggle', {}),
      };
      if (actions[key]) {
        event.preventDefault();
        actions[key]();
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        switchChat(event.key === 'ArrowUp' ? 'up' : 'down');
        return;
      }
    }

    if (event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      if (tag === 'textarea') return;
      event.preventDefault();
      scrollBetweenMessages(event.key === 'ArrowDown' ? 'down' : 'up');
      return;
    }

    if (
      !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !inField
    ) {
      event.preventDefault();
      $('#chat-container')?.scrollBy({
        top: event.key === 'ArrowDown' ? 150 : -150,
        behavior: 'smooth',
      });
    }
  });
}
