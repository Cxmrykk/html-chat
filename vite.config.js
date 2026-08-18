import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  plugins: [viteSingleFile()],
  build: {
    outDir: resolve(__dirname, '.'),
    emptyOutDir: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
  },
});