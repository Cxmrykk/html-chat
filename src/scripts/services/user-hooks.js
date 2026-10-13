/**
 * Compiling the JavaScript of a custom parser, written by the user or by the
 * configuration assistant. It runs in this page, as user hooks always have.
 * Compiled functions are cached by source; the cache is bounded because the
 * configurator recompiles on every pause in typing.
 */

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const CACHE_LIMIT = 50;
const cache = new Map();

/** `(text, fileName) => Promise<boundaries>`. Throws if the code does not parse. */
export function compileParser(code) {
  const source = typeof code === 'string' ? code : '';
  if (cache.has(source)) return cache.get(source);
  const parse = new AsyncFunction('text', 'fileName', source);
  cache.set(source, parse);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return parse;
}
