import { marked, Prism, renderMathInElement } from '../vendor/index.js';
import { escapeHTML } from '../core/format.js';
import { RUN_BLOCK_PATTERN } from '../services/god-mode.js';

/**
 * Markdown rendering plus the KaTeX/Prism post-pass.
 *
 * See AGENT.md §5: output is not sanitised, deliberately.
 */

// Switch to 'mathml' to drop the KaTeX font payload entirely.
const MATH_OUTPUT = 'htmlAndMathml';

const MATH_DELIMITERS = [
  { left: '$$', right: '$$', display: true },
  { left: '$', right: '$', display: false },
];

// Claim `$...$` spans before marked can mangle them; auto-render handles the
// actual typesetting once the HTML is in the document.
marked.use({
  extensions: [
    {
      name: 'math',
      level: 'inline',
      start(src) {
        return src.match(/\$/)?.index;
      },
      tokenizer(src) {
        const block = /^\$\$([\s\S]+?)\$\$/.exec(src);
        if (block) return { type: 'math', raw: block[0], text: block[1] };
        const inline = /^\$([^\s$](?:\\.|[^$\n])*?)\$/.exec(src);
        if (inline) return { type: 'math', raw: inline[0], text: inline[1] };
        return undefined;
      },
      renderer(token) {
        return escapeHTML(token.raw);
      },
    },
  ],
});

/** Present `<run>` blocks as fenced JavaScript in the transcript. */
export function displayContentOf(content) {
  return (content || '').replace(
    RUN_BLOCK_PATTERN,
    (_match, code) => `**Executing Code:**\n\`\`\`javascript\n${code.trim()}\n\`\`\``,
  );
}

export function renderMarkdown(content) {
  return marked.parse(displayContentOf(content));
}

/** Typeset math and highlight code inside an already-rendered element. */
export function enhance(element) {
  if (!element) return;
  try {
    renderMathInElement(element, {
      delimiters: MATH_DELIMITERS,
      output: MATH_OUTPUT,
      throwOnError: false,
    });
    Prism.highlightAllUnder(element);
  } catch (error) {
    console.warn('Failed to enhance markdown (math/highlighting):', error);
  }
}

