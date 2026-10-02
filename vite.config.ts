import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: { outDir: 'dist' },
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
});
