import { marked, Prism, renderMathInElement } from '../vendor/index.js';
import { escapeHTML } from '../core/format.js';
import { fenceFor } from '../core/tools.js';
import { state } from '../store/state.js';
import { pickBoolean, pickInteger } from '../core/values.js';
import { GLOBAL_SETTINGS } from '../core/settings-schema.js';
import { ICON_CHEVRON_DOWN } from './icons.js';

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

/**
 * Chats from before tool calling hold code the model wrote as `<run>` text.
 * Nothing parses or executes that any more, but left alone it would reach
 * `innerHTML` as an unknown element and collapse into one unreadable line.
 */
const LEGACY_RUN_BLOCK = /<run>([\s\S]*?)<\/run>/g;

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

/** Present legacy `<run>` blocks as fenced JavaScript. Display only. */
function displayContentOf(content) {
  return (content || '').replace(LEGACY_RUN_BLOCK, (_match, code) => {
    const body = code.trim();
    const fence = fenceFor(body);
    return `\n${fence}javascript\n${body}\n${fence}`;
  });
}

export function renderMarkdown(content) {
  return marked.parse(displayContentOf(content));
}

/* ------------------------------------------------------------------ *
 * Blocks
 * ------------------------------------------------------------------ */

/**
 * The source as marked's lexer sees it, and where each of its characters came
 * from. The lexer (marked 12) normalises before it tokenises: every line
 * ending becomes `\n`, and a run of tabs following a line's leading spaces
 * becomes four spaces per tab. Token `raw` strings are slices of that
 * normalised text, so mapping them back to the stored content needs the same
 * transform with its origins recorded. `origin` has one entry more than the
 * text: the end of the source.
 */
function lexerView(source) {
  const chars = [];
  const origin = [];
  /** Where on the line we are: 'spaces' (leading), 'tabs' (the run after them), 'done'. */
  let phase = 'spaces';

  for (let i = 0; i < source.length; i++) {
    const char = source[i];

    if (char === '\r' || char === '\n') {
      chars.push('\n');
      origin.push(i);
      if (char === '\r' && source[i + 1] === '\n') i++;
      phase = 'spaces';
      continue;
    }

    if (char === '\t' && phase !== 'done') {
      chars.push('    ');
      origin.push(i, i, i, i);
      phase = 'tabs';
      continue;
    }

    if (!(char === ' ' && phase === 'spaces')) phase = 'done';
    chars.push(char);
    origin.push(i);
  }

  origin.push(source.length);
  return { text: chars.join(''), origin };
}

/**
 * A message's top-level markdown blocks — paragraphs, headings, lists, code
 * blocks, tables — each with its span of the source (`start` and `end`,
 * character offsets, end exclusive) and its token. Blank lines between blocks
 * belong to none of them.
 *
 * The spans are only trusted when the tokens account for every character of
 * the source. The lexer drops some text (reference-link definitions) and a few
 * of its merges invent some; whenever the check fails, the whole message is
 * one block with no token. Selection gets coarser, but an edit can never land
 * in the wrong place.
 *
 * The same goes for legacy `<run>` blocks, which are rewritten before display
 * and so no longer line up with the source — but only when the rewrite
 * actually changes something. The mere text `<run>` (in a code block quoting
 * this very file, say) is ordinary content and splits into blocks as usual.
 *
 * Empty or whitespace-only content has no blocks.
 */
export function sourceBlocks(content) {
  const source = typeof content === 'string' ? content : '';
  if (!source.trim()) return [];

  const whole = [{ start: 0, end: source.length, token: null }];
  if (displayContentOf(source) !== source) return whole;

  let tokens;
  try {
    tokens = marked.lexer(source);
  } catch {
    return whole;
  }
  if (!tokens.every((token) => typeof token.raw === 'string')) return whole;

  const { text, origin } = lexerView(source);
  if (tokens.map((token) => token.raw).join('') !== text) return whole;

  const blocks = [];
  let offset = 0;
  for (const token of tokens) {
    const next = offset + token.raw.length;
    if (token.type !== 'space') {
      blocks.push({ start: origin[offset], end: origin[next], token });
    }
    offset = next;
  }
  return blocks.length ? blocks : whole;
}

function renderToken(token) {
  try {
    return marked.parser([token]);
  } catch (error) {
    console.warn('Failed to render a markdown block:', error);
    return `<pre>${escapeHTML(token.raw)}</pre>`;
  }
}

/**
 * A message body, one wrapper per top-level block, so a click can be traced
 * back to the text that produced it. Every message renders this way, editing
 * or not, so starting an edit never re-lays out the transcript. The wrappers
 * carry no padding or border: margins collapse through them exactly as they
 * would without them.
 */
export function renderMarkdownBlocks(content) {
  return sourceBlocks(content)
    .map((block, index) => {
      const html = block.token ? renderToken(block.token) : renderMarkdown(content);
      return `<div class="md-block" data-block="${index}">${html}</div>`;
    })
    .join('');
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

    const config = state.data.config;
    const autoCollapse = pickBoolean(true, config.autoCollapseCode, GLOBAL_SETTINGS.autoCollapseCode.default);
    const collapseThreshold = pickInteger(20, config.codeCollapseThreshold, GLOBAL_SETTINGS.codeCollapseThreshold.default);
    const previewLines = pickInteger(5, config.codeCollapsePreviewLines, GLOBAL_SETTINGS.codeCollapsePreviewLines.default);
    const showHint = pickBoolean(true, config.showCodeCollapseHint, GLOBAL_SETTINGS.showCodeCollapseHint.default);

    const pres = element.querySelectorAll('pre');
    for (const pre of pres) {
      if (pre.closest('.msg.editing')) continue;
      
      const lines = (pre.textContent || '').replace(/\s+$/, '').split('\n').length;
      if (lines > collapseThreshold) {
        pre.classList.add('collapsible-code');
        pre.style.setProperty('--preview-lines', previewLines);
        
        // Let the user's manual toggling persist until the DOM node is physically recreated
        if (!pre.hasAttribute('data-collapsible')) {
          pre.setAttribute('data-collapsible', 'true');
          if (autoCollapse) pre.classList.add('collapsed');
        }

        // Overlay that acts as both the gradient fade and the hint text
        let overlay = pre.querySelector('.code-collapse-overlay');
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.className = 'code-collapse-overlay';
          pre.appendChild(overlay);
        }

        if (showHint) {
          if (!overlay.innerHTML) {
            overlay.innerHTML = `${ICON_CHEVRON_DOWN}`;
          }
        } else {
          if (overlay.innerHTML) {
            overlay.innerHTML = '';
          }
        }
      } else {
        pre.classList.remove('collapsible-code', 'collapsed');
        pre.removeAttribute('data-collapsible');
        const overlay = pre.querySelector('.code-collapse-overlay');
        if (overlay) overlay.remove();
      }
    }
  } catch (error) {
    console.warn('Failed to enhance markdown (math/highlighting/collapsible):', error);
  }
}