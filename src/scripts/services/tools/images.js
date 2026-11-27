import { findChat } from '../../store/state.js';
import { imageToolModels } from '../models.js';
import { createImages, imageRequestParams } from '../image-generation.js';
import { uploadBlob, sendsGeneratedImages } from '../images.js';
import { allImagesOf, imageRef, findImageByRef } from '../../core/attachments.js';
import { TOOL_NAMES } from '../../core/tools.js';

/**
 * The image tools: listing the image models the user allowed, generating
 * from a prompt, and editing images already in the chat. A failure is a
 * result the model can read and act on (another model, a better prompt); only
 * the user's abort propagates.
 */

const failure = (content) => ({ content, failed: true });

function modelProblem(model) {
  const allowed = imageToolModels();
  const list = allowed.join(', ') || 'none';
  const id = typeof model === 'string' ? model.trim() : '';
  if (!id) return `Error: \`model\` is required. Available image models: ${list}.`;
  if (!allowed.includes(id)) return `Error: "${id}" is not an available image model. Available: ${list}.`;
  return '';
}

function promptProblem(prompt) {
  return typeof prompt === 'string' && prompt.trim() ? '' : 'Error: `prompt` must be a non-empty string.';
}

function refsOf(value) {
  if (Array.isArray(value)) return value.filter((ref) => typeof ref === 'string' && ref.trim());
  if (typeof value === 'string' && value.trim()) return [value];
  return [];
}

/** The tool result: the new images' ids and sizes, and what the model can do next. */
function report(verb, model, records, revisedPrompt) {
  const count = records.length === 1 ? '1 image' : `${records.length} images`;
  const lines = [`${verb} ${count} with ${model}:`];
  for (const record of records) lines.push(`- ${imageRef(record)} (${record.width}×${record.height})`);
  if (revisedPrompt) lines.push('', `Revised prompt: ${revisedPrompt}`);
  lines.push(
    '',
    sendsGeneratedImages()
      ? 'The user can see the images, and they follow in the next message so you can check them.'
      : 'The user can see the images; you cannot.',
    `Pass an id to ${TOOL_NAMES.editImage} to change an image.`,
  );
  return lines.join('\n');
}

export async function listImageModels() {
  const models = imageToolModels();
  if (!models.length) return failure('No image models are available.');
  return {
    content: [
      'Image models you may use:',
      ...models.map((id) => `- ${id}`),
      '',
      `Not every model can edit images with ${TOOL_NAMES.editImage}; if one fails, try another.`,
    ].join('\n'),
    failed: false,
  };
}

export async function generateImage(args, { signal } = {}) {
  const problem = modelProblem(args.model) || promptProblem(args.prompt);
  if (problem) return failure(problem);

  const model = args.model.trim();
  const { records, revisedPrompt } = await createImages({
    model,
    prompt: args.prompt.trim(),
    params: imageRequestParams(args),
    signal,
  });
  return { content: report('Generated', model, records, revisedPrompt), failed: false, attachments: records };
}

/**
 * Edit with the images `args.images` names: any image in this chat, pasted by
 * the user or made by an earlier call. Only an original can be edited; a
 * placeholder is too coarse to be worth sending.
 */
export async function editImage(args, { signal, chatId } = {}) {
  const problem = modelProblem(args.model) || promptProblem(args.prompt);
  if (problem) return failure(problem);

  const refs = refsOf(args.images);
  if (!refs.length) {
    return failure('Error: `images` must list the ids of the images to edit, e.g. ["img_1a2b3c4d5e6f"].');
  }

  const known = (findChat(chatId)?.messages || []).flatMap(allImagesOf);
  const sources = [];
  for (const ref of refs) {
    const attachment = findImageByRef(known, ref);
    if (!attachment) {
      const ids = [...new Set(known.map(imageRef))].join(', ') || 'none';
      return failure(`Error: no image in this chat has the id "${ref}". Known ids: ${ids}.`);
    }
    const blob = await uploadBlob(attachment);
    if (!blob) {
      return failure(
        `Error: the original of ${imageRef(attachment)} is no longer stored, only a low-resolution placeholder, ` +
          'so it cannot be edited. The user can restore it by clicking it.',
      );
    }
    sources.push({ blob, name: attachment.name });
  }

  const model = args.model.trim();
  const { records, revisedPrompt } = await createImages({
    model,
    prompt: args.prompt.trim(),
    sources,
    params: imageRequestParams(args),
    signal,
  });
  return { content: report('Edited', model, records, revisedPrompt), failed: false, attachments: records };
}
