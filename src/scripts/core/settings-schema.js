import { isBlank, pickBoolean, pickNumber, pickInteger } from './values.js';
import { DEFAULT_JS_TOOL_DESCRIPTION } from './tools.js';
import { REASONING_FIELDS, isReasoningField } from './reasoning.js';

/**
 * The single description of every configurable global setting.
 *
 * Each entry carries everything the rest of the app needs to know about it:
 * how to store it (`type`), what to call it (`label`) and what to show in the
 * list (`display`). Nothing else should maintain parallel lists of keys.
 *
 * A `select` entry also lists its `options` (`{ value, label }`); it is shown
 * in the list as a dropdown and saved as soon as a choice is made, instead of
 * being edited in the textarea.
 *
 * Entries marked `perModel` are the LLM parameters sent with each request.
 * Their global value is the default for every model; a model may override it
 * (see `core/model-params.js`).
 *
 * Which models are image models (Identify Image Models), and which of them
 * the image tools may use (Toggle Image Models), are not entries here: they
 * are lists picked on their own settings pages (`config.imageModels`,
 * `config.imageToolExcluded`).
 */

/** How an image is scaled down to a pixel budget (`services/image-scaling.js`). */
export const SCALING_METHODS = [
  { value: 'high', label: 'Smooth, high quality' },
  { value: 'medium', label: 'Smooth, medium quality' },
  { value: 'low', label: 'Smooth, low quality (fastest)' },
  { value: 'stepped', label: 'Progressive halving' },
  { value: 'nearest', label: 'Nearest neighbour (pixelated)' },
];

/** Display helpers shared by several entries. */
const showApiDefault = (value) => (isBlank(value) ? 'API Default' : String(value));
const showValueOrDefault = (value) => (isBlank(value) ? 'Default' : String(value));
const showCustomOrDefault = (value, entry) =>
  isBlank(value) || value === entry.default ? 'Default' : 'Custom';
const showOnOff = (value, entry) =>
  pickBoolean(pickBoolean(false, entry.default), value) ? 'On' : 'Off';

/** The label of the chosen option, or of the default when the value is not one. */
const showOption = (value, entry) => {
  const options = entry.options || [];
  const match =
    options.find((option) => option.value === value) ||
    options.find((option) => option.value === entry.default);
  return match ? match.label : String(value ?? '');
};

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

/** A positive whole number of pixels; anything else shows (and acts as) the default. */
const positivePixels = (value, entry) => {
  const parsed = pickInteger(NaN, value);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : Number(entry.default);
};

const describePixels = (pixels) => {
  const side = Math.sqrt(pixels);
  return Number.isInteger(side) ? `${pixels} px (${side}×${side})` : `${pixels} px`;
};

const showPixels = (value, entry) => `${positivePixels(value, entry)} px`;

const showPixelBudget = (value, entry) => describePixels(positivePixels(value, entry));

/** A scaling budget: 0 (or less) means images go out at full size. */
const showScaleBudget = (value, entry) => {
  const pixels = pickInteger(Number(entry.default), value);
  return pixels > 0 ? describePixels(pixels) : 'Off (full size)';
};

export const GLOBAL_SETTINGS = {
  temperature: {
    label: 'Temperature',
    category: 'LLM Behavior',
    type: 'number',
    default: '',
    tooltip: 'Controls randomness (0.0 to 2.0).',
    payloadKey: 'temperature',
    perModel: true,
    display: showApiDefault,
  },
  top_p: {
    label: 'Top P',
    category: 'LLM Behavior',
    type: 'number',
    default: '',
    tooltip: 'Nucleus sampling (0.0 to 1.0).',
    payloadKey: 'top_p',
    perModel: true,
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
    perModel: true,
    display: showApiDefault,
  },
  frequency_penalty: {
    label: 'Frequency Penalty',
    category: 'LLM Behavior',
    type: 'number',
    default: '',
    tooltip: 'Penalizes new tokens based on existing frequency (-2.0 to 2.0).',
    payloadKey: 'frequency_penalty',
    perModel: true,
    display: showApiDefault,
  },
  presence_penalty: {
    label: 'Presence Penalty',
    category: 'LLM Behavior',
    type: 'number',
    default: '',
    tooltip: 'Penalizes new tokens based on presence (-2.0 to 2.0).',
    payloadKey: 'presence_penalty',
    perModel: true,
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
    tooltip: 'Estimated-token cap on a tool result. Longer results are truncated. 0 disables the cap.',
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
  retryKeepsThinking: {
    label: 'Retry Keeps Thinking',
    category: 'Tools',
    type: 'boolean',
    default: 'true',
    tooltip:
      'When Retry on a thinking box (or on the Assistant text before its tool calls) resumes a turn, append the reasoning shown so far in that turn to the latest user message as it is sent, so the model can pick up from it instead of losing it. ' +
      'The stored message is not changed. true or false.',
    display: showOnOff,
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
      'Off reads /models alone. A model reported without tool support is not offered tools. Image models are never detected: identify them under Image Generation.',
    display: showOnOff,
  },
  imageCacheMB: {
    label: 'Image Cache (MB)',
    category: 'Images',
    type: 'number',
    default: '100',
    tooltip:
      'How much browser storage original images (pasted or generated) may use so they survive a reload. The oldest are removed first once it is full. ' +
      '0 keeps originals in memory only. Chats themselves only ever store a pixelated placeholder.',
    display: showCacheSize,
  },
  placeholderWidth: {
    label: 'Placeholder Width',
    category: 'Images',
    type: 'number',
    default: '64',
    tooltip:
      'How many pixels wide a placeholder starts at (never wider than the original). It is halved until it fits Placeholder Max Pixels. ' +
      'Applies to images added from now on; existing placeholders keep their size.',
    display: showPixels,
  },
  placeholderMaxPixels: {
    label: 'Placeholder Max Pixels',
    category: 'Images',
    type: 'number',
    default: '4096',
    tooltip:
      'The most pixels (width × height) a placeholder may hold. While it holds more, its width is halved. ' +
      'Placeholders are stored in the chat, so larger values make chats larger. Applies to images added from now on.',
    display: showPixelBudget,
  },
  visionMaxPixels: {
    label: 'Vision Max Pixels',
    category: 'Images',
    type: 'number',
    default: '4194304',
    tooltip:
      'Images sent to a chat model to look at (pasted images, and generated ones with Send Generated Images on) that hold more than this many pixels (width × height) are scaled down to fit, keeping their aspect ratio. ' +
      '0 sends them at full size. This limits only the copy sent to the API: the image kept locally stays at full size. Image edits use Edit Max Pixels instead.',
    display: showScaleBudget,
  },
  visionScalingMethod: {
    label: 'Vision Scaling Method',
    category: 'Images',
    type: 'select',
    options: SCALING_METHODS,
    default: 'high',
    tooltip: 'How images are scaled down to Vision Max Pixels.',
    display: showOption,
  },
  sendGeneratedImages: {
    label: 'Send Generated Images',
    category: 'Image Generation',
    type: 'boolean',
    default: 'false',
    tooltip:
      'Send the images the image tools made back to the model, in a user message right after the tool results, so it can check them and adjust. ' +
      'Off, a tool result carries only the images’ ids and sizes. true or false.',
    display: showOnOff,
  },
  editMaxPixels: {
    label: 'Edit Max Pixels',
    category: 'Image Generation',
    type: 'number',
    default: '4194304',
    tooltip:
      'Images sent to an image model to edit (/images/edits, from the edit_image tool) that hold more than this many pixels (width × height) are scaled down to fit, keeping their aspect ratio. ' +
      '0 sends them at full size. This limits only the copy sent to the API: the image kept locally stays at full size.',
    display: showScaleBudget,
  },
  editScalingMethod: {
    label: 'Edit Scaling Method',
    category: 'Image Generation',
    type: 'select',
    options: SCALING_METHODS,
    default: 'high',
    tooltip: 'How images are scaled down to Edit Max Pixels.',
    display: showOption,
  },
  chatDateGroups: {
    label: 'Chat Date Groups',
    category: 'UI & Display',
    type: 'boolean',
    default: 'true',
    tooltip:
      'Group the chat list in the sidebar under collapsible date headings by when each chat was created: Today, Yesterday, each other day of the last 30 (e.g. Nov 24), then Older. true or false.',
    display: showOnOff,
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
};

/** Whether a setting may be overridden per model: the LLM parameters sent with each request. */
export function isPerModel(key) {
  return Boolean(GLOBAL_SETTINGS[key]?.perModel);
}

/** Every per-model key, in declaration order. */
export const PER_MODEL_KEYS = Object.keys(GLOBAL_SETTINGS).filter(isPerModel);

/** A `select` setting's value if it is one of its options, else its default. */
export function optionValue(key, value) {
  const entry = GLOBAL_SETTINGS[key];
  const options = entry?.options || [];
  return options.some((option) => option.value === value) ? value : entry?.default;
}

/** The entries of `schema` whose key passes `predicate`, in declaration order. */
export function pickSchema(schema, predicate) {
  return Object.fromEntries(Object.entries(schema).filter(([key]) => predicate(key)));
}

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
