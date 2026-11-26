import { isBlank, pickBoolean, pickNumber } from './values.js';
import { DEFAULT_JS_TOOL_DESCRIPTION } from './tools.js';
import { REASONING_FIELDS, isReasoningField } from './reasoning.js';

/**
 * The single description of every configurable global setting.
 *
 * Each entry carries everything the rest of the app needs to know about it:
 * how to store it (`type`), what to call it (`label`) and what to show in the
 * list (`display`). Nothing else should maintain parallel lists of keys.
 */

/** Display helpers shared by several entries. */
const showApiDefault = (value) => (isBlank(value) ? 'API Default' : String(value));
const showValueOrDefault = (value) => (isBlank(value) ? 'Default' : String(value));
const showCustomOrDefault = (value, entry) =>
  isBlank(value) || value === entry.default ? 'Default' : 'Custom';
const showOnOff = (value, entry) =>
  pickBoolean(pickBoolean(false, entry.default), value) ? 'On' : 'Off';

/** An unknown field name is ignored when sending, so the list says so. */
const showEchoField = (value) => {
  if (isBlank(value)) return 'Off';
  const name = String(value).trim();
  return isReasoningField(name) ? name : `${name} (ignored)`;
};

const showCacheSize = (value, entry) => {
  const mb = pickNumber(Number(entry.default), value);
  return mb > 0 ? `${mb} MB` : 'Memory only';
};

export const GLOBAL_SETTINGS = {
  temperature: {
    label: 'Temperature',
    category: 'LLM Behavior',
    type: 'number',
    default: '',
    tooltip: 'Controls randomness (0.0 to 2.0).',
    payloadKey: 'temperature',
    display: showApiDefault,
  },
  top_p: {
    label: 'Top P',
    category: 'LLM Behavior',
    type: 'number',
    default: '',
    tooltip: 'Nucleus sampling (0.0 to 1.0).',
    payloadKey: 'top_p',
    display: showApiDefault,
  },
  max_tokens: {
    label: 'Max Tokens',
    category: 'LLM Behavior',
    type: 'number',
    default: '',
    tooltip: 'Maximum number of tokens to generate.',
    payloadKey: 'max_tokens',
    integer: true,
    display: showApiDefault,
  },
  frequency_penalty: {
    label: 'Frequency Penalty',
    category: 'LLM Behavior',
    type: 'number',
    default: '',
    tooltip: 'Penalizes new tokens based on existing frequency (-2.0 to 2.0).',
    payloadKey: 'frequency_penalty',
    display: showApiDefault,
  },
  presence_penalty: {
    label: 'Presence Penalty',
    category: 'LLM Behavior',
    type: 'number',
    default: '',
    tooltip: 'Penalizes new tokens based on presence (-2.0 to 2.0).',
    payloadKey: 'presence_penalty',
    display: showApiDefault,
  },
  maxToolRounds: {
    label: 'Max Tool Rounds',
    category: 'Tools',
    type: 'number',
    default: '10',
    tooltip:
      'How many times in one turn the model may call tools and be sent the results. After that it is asked to answer without tools.',
    display: showValueOrDefault,
  },
  toolResultMaxTokens: {
    label: 'Max Tool Result Tokens',
    category: 'Tools',
    type: 'number',
    default: '4000',
    tooltip: 'Estimated-token cap on a JavaScript result. Longer results are truncated. 0 disables the cap.',
    display: showValueOrDefault,
  },
  reasoningEchoField: {
    label: 'Echo Reasoning Field',
    category: 'Tools',
    type: 'text',
    default: '',
    tooltip:
      `During a tool loop, send the model's plain-text reasoning back under this field (${REASONING_FIELDS.join(' or ')}), for models that expect it. ` +
      'Empty sends none. Signed thinking blocks (Claude via LiteLLM) are always sent back regardless.',
    display: showEchoField,
  },
  jsToolDescription: {
    label: 'JavaScript Tool Description',
    category: 'Tools',
    type: 'code',
    default: DEFAULT_JS_TOOL_DESCRIPTION,
    tooltip: 'What the model is told about the JavaScript execution tool.',
    display: showCustomOrDefault,
  },
  extraModels: {
    label: 'Extra Models',
    category: 'API & Connections',
    type: 'text',
    default: '',
    tooltip: 'Comma-separated models to always offer, for servers that do not implement /models.',
    display: (value) => (isBlank(value) ? 'None' : String(value)),
  },
  probeCapabilities: {
    label: 'Probe Capabilities',
    category: 'API & Connections',
    type: 'boolean',
    default: 'true',
    tooltip:
      'When fetching models, also ask LiteLLM (/model/info) and Ollama (/api/show) what each model supports: tools, thinking and its levels, vision, context length. ' +
      'Off reads /models alone. A model reported without tool support is not offered tools.',
    display: showOnOff,
  },
  imageCacheMB: {
    label: 'Image Cache (MB)',
    category: 'Images',
    type: 'number',
    default: '100',
    tooltip:
      'How much browser storage original images may use so they survive a reload. The oldest are removed first once it is full. ' +
      '0 keeps originals in memory only. Chats themselves only ever store a pixelated placeholder.',
    display: showCacheSize,
  },
  collapseThinking: {
    label: 'Collapse Thinking',
    category: 'UI & Display',
    type: 'boolean',
    default: 'true',
    tooltip:
      'Whether a new thinking box (reasoning, and the tool calls made while thinking) starts collapsed: true or false. Any box can still be opened or closed by clicking it.',
    display: showOnOff,
  },
  autoCollapseCode: {
    label: 'Auto-Collapse Code',
    category: 'UI & Display',
    type: 'boolean',
    default: 'true',
    tooltip: 'Automatically collapse long code blocks. They can be toggled by clicking.',
    display: showOnOff,
  },
  codeCollapseThreshold: {
    label: 'Code Collapse Threshold',
    category: 'UI & Display',
    type: 'number',
    default: '20',
    tooltip: 'Minimum number of lines before a code block becomes collapsible.',
    display: showValueOrDefault,
  },
  codeCollapsePreviewLines: {
    label: 'Code Preview Lines',
    category: 'UI & Display',
    type: 'number',
    default: '5',
    tooltip: 'Number of lines to display when a code block is collapsed.',
    display: showValueOrDefault,
  },
  showCodeCollapseHint: {
    label: 'Show Code Collapse Hint',
    category: 'UI & Display',
    type: 'boolean',
    default: 'true',
    tooltip: 'Show a centered "Click to expand" fading overlay on collapsed code blocks.',
    display: showOnOff,
  },
  maxVisibleChats: {
    label: 'Max Visible Chats',
    category: 'UI & Display',
    type: 'number',
    default: '',
    tooltip: 'Maximum number of chats displayed at once in the sidebar.',
    display: (value) => (isBlank(value) ? 'Unlimited' : String(value)),
  },
};

/** Group schema keys by category, preserving declaration order. */
export function groupByCategory(schema) {
  const groups = new Map();
  for (const [key, entry] of Object.entries(schema)) {
    const category = entry.category || 'Other';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(key);
  }
  return groups;
}

/** The right-hand summary shown next to a setting in the list. */
export function describeSetting(schema, key, value) {
  const entry = schema[key];
  if (!entry) return '';
  const display = entry.display || showApiDefault;
  return display(value, entry);
}
