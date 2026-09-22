import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  build: { rollupOptions: { input: { lab: resolve('index.html'), play: resolve('play/index.html'), dashboard: resolve('dashboard/index.html') } } },
});
