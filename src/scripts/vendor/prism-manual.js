/**
 * Must run before prismjs itself is evaluated, so Prism sees `manual: true`
 * and does not auto-highlight the document on load.
 *
 * This lives in its own import-free module because ES module imports are
 * hoisted: a bare statement at the top of vendor/prism.js would run *after*
 * prismjs had already initialised.
 */
window.Prism = window.Prism || {};
window.Prism.manual = true;
