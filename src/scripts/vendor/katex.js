import renderMathInElement from 'katex/dist/contrib/auto-render.mjs';

// Drop this import (and switch MATH_OUTPUT to 'mathml' in ui/markdown.js) to
// remove roughly 1-2 MB of base64-inlined KaTeX fonts from the built file.
import 'katex/dist/katex.min.css';

export { renderMathInElement };
