import { EVENTS } from '../store/events.js';
import {
  state,
  emit,
  findChat,
  currentChat,
  setGeneration,
  invalidateContext,
  persistChat,
  persistChatIndex,
  persistCurrentChat,
  persistPrefs,
} from '../store/state.js';
import * as chatsRepo from '../data/chats-repo.js';
import { requestCompletion } from './api/completions.js';
import { fullFileContent } from './retrieval.js';
import { extractRunBlocks, executeRunBlock } from './god-mode.js';
import { DEFAULT_GOD_MODE_PROMPT } from '../core/settings-schema.js';
import { truncate } from '../core/format.js';

/** Chat lifecycle and the send/execute loop. */

const MAX_GOD_MODE_LOOPS = 5;

/* ------------------------------------------------------------------ *
 * Chat CRUD
 * ------------------------------------------------------------------ */

export async function createChat() {
  const id = Date.now().toString();
  state.data.chats.unshift({ id, title: 'New Chat', messages: [] });
  state.data.currentChatId = id;
  invalidateContext();
  await persistCurrentChat();
  await persistPrefs();
  emit(EVENTS.CHATS);
  emit(EVENTS.MESSAGES);
  return id;
}

export async function openChat(id) {
  state.data.currentChatId = id;
  invalidateContext();
  await persistPrefs();
  emit(EVENTS.CHATS);
  emit(EVENTS.MESSAGES);
}

export async function removeChat(id) {
  state.data.chats = state.data.chats.filter((chat) => chat.id !== id);
  if (state.data.currentChatId === id) {
    state.data.currentChatId = state.data.chats.length ? state.data.chats[0].id : null;
  }
  invalidateContext();
  await chatsRepo.deleteChat(id, state.data.chats);
  await persistPrefs();
  emit(EVENTS.CHATS);
  emit(EVENTS.MESSAGES);
}

export async function renameChat(id, title) {
  const chat = findChat(id);
  if (!chat) return;
  chat.title = title.trim();
  await persistChat(id);
  await persistChatIndex();
  emit(EVENTS.CHATS);
}

export async function forkChat(messageIndex) {
  const chat = currentChat();
  if (!chat) return;

  const id = Date.now().toString();
  state.data.chats.unshift({
    id,
    title: `${chat.title} (Forked)`,
    messages: JSON.parse(JSON.stringify(chat.messages.slice(0, messageIndex + 1))),
  });
  state.data.currentChatId = id;

  invalidateContext();
  await persistCurrentChat();
  await persistPrefs();
  emit(EVENTS.CHATS);
  emit(EVENTS.MESSAGES);
}

/* ------------------------------------------------------------------ *
 * Messages
 * ------------------------------------------------------------------ */

export async function appendMessage(message, { chatId = state.data.currentChatId } = {}) {
  const chat = findChat(chatId);
  if (!chat) return -1;
  chat.messages.push(message);
  const index = chat.messages.length - 1;
  invalidateContext();
  await persistChat(chatId);
  if (chatId === state.data.currentChatId) emit(EVENTS.MESSAGE_APPENDED, { index });
  return index;
}

export async function updateMessage(index, patch) {
  const chat = currentChat();
  if (!chat || !chat.messages[index]) return;
  Object.assign(chat.messages[index], patch);
  invalidateContext();
  await persistChat();
  emit(EVENTS.MESSAGE, { index });
}

export async function deleteMessage(index) {
  const chat = currentChat();
  if (!chat) return;
  chat.messages.splice(index, 1);
  invalidateContext();
  await persistChat();
  emit(EVENTS.MESSAGES);
}

export async function truncateMessages(length) {
  const chat = currentChat();
  if (!chat) return;
  chat.messages.length = Math.max(0, length);
  invalidateContext();
  await persistChat();
  emit(EVENTS.MESSAGES);
}

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

/**
 * Expand file messages into plain user messages.
 * Embed-mode file messages contribute nothing until explicitly run — the
 * retrieved text is appended as its own message at that point.
 */
async function resolveMessages(messages) {
  const resolved = [];
  for (const message of messages) {
    if (message.role !== 'file') {
      resolved.push(message);
      continue;
    }
    if (message.mode !== 'full') continue;
    const content = message.content || (await fullFileContent(message.fileId));
    resolved.push({ role: 'user', content: content || '*File not found.*' });
  }
  return resolved;
}

function buildTitle(text) {
  const lastBreak = text.lastIndexOf('\n\n');
  const source = lastBreak !== -1 ? text.substring(lastBreak + 2).trim() : text;
  return truncate(source, 30);
}

export function abortGeneration() {
  state.runtime.completionAbort?.abort();
  state.runtime.completionAbort = null;
  setGeneration({ active: false, phase: 'idle', loop: 0, maxLoops: 0 });
}

/**
 * Send the conversation to the API.
 *
 * `loopDepth` tracks God Mode re-entry after code execution; `skipApi` appends
 * the user's message without calling the API at all.
 */
export async function sendMessage({ text = '', loopDepth = 0, skipApi = false } = {}) {
  const isLoop = loopDepth > 0;

  if (isLoop && loopDepth >= MAX_GOD_MODE_LOOPS) {
    await appendMessage({
      role: 'error',
      content: `**System Error:** Maximum execution loop depth (${MAX_GOD_MODE_LOOPS}) reached.`,
    });
    return;
  }

  if (!isLoop) {
    if (!text.trim()) return;
    if (!state.data.config.key && !skipApi) {
      throw new Error('Please enter your API key in the settings first.');
    }
    if (!state.data.currentChatId) await createChat();

    const chat = currentChat();
    if (!chat.messages.length) {
      chat.title = buildTitle(text.trim());
      await persistChatIndex();
      emit(EVENTS.CHATS);
    }
    await appendMessage({ role: 'user', content: text.trim() });
    if (skipApi) return;
  }

  const chatId = state.data.currentChatId;
  const chat = findChat(chatId);
  if (!chat) return;

  const controller = new AbortController();
  state.runtime.completionAbort = controller;
  setGeneration({
    active: true,
    phase: 'thinking',
    loop: loopDepth,
    maxLoops: MAX_GOD_MODE_LOOPS,
  });

  try {
    let payload = chat.messages
      .filter((message) => message.role !== 'error')
      .map((message) => (message.role === 'file' ? { ...message } : {
        role: message.role,
        content: message.content || '',
      }));

    if (state.data.config.godMode) {
      payload.unshift({
        role: 'system',
        content: state.data.config.godModePrompt || DEFAULT_GOD_MODE_PROMPT,
      });
    }

    payload = await resolveMessages(payload);

    const index = await appendMessage({ role: 'assistant', content: '' }, { chatId });
    setGeneration({ phase: 'generating' });

    let reply = '';
    try {
      reply = await requestCompletion({
        config: state.data.config,
        model: state.data.config.lastModel,
        messages: payload,
        signal: controller.signal,
        onDelta: (partial) => {
          chat.messages[index].content = partial;
          emit(EVENTS.MESSAGE, { index, streaming: true });
        },
      });
    } catch (error) {
      if (error.name !== 'AbortError') throw error;
      reply = `${chat.messages[index].content}\n\n*[Stopped by user]*`;
    }

    chat.messages[index].content = reply;
    invalidateContext();
    await persistChat(chatId);
    emit(EVENTS.MESSAGE, { index, streaming: false });

    if (state.data.config.godMode && reply) {
      const blocks = extractRunBlocks(reply);
      if (blocks.length > 0) {
        for (const code of blocks) {
          const result = await executeRunBlock(code);
          await appendMessage({ role: 'user', content: result }, { chatId });
        }
        state.runtime.completionAbort = null;
        return sendMessage({ loopDepth: loopDepth + 1 });
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      await appendMessage(
        { role: 'error', content: `**Error:**\n\n${error.message}` },
        { chatId },
      );
    }
  } finally {
    state.runtime.completionAbort = null;
    setGeneration({ active: false, phase: 'idle', loop: 0, maxLoops: 0 });
    invalidateContext();
  }
}
