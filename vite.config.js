import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'src',
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: fileURLToPath(new URL('./', import.meta.url)),
    emptyOutDir: false,
    cssCodeSplit: false,
    // Everything (JS, CSS, KaTeX fonts) must inline for the single-file build.
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000,
  },
});