import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 4173,
    strictPort: true,
    fs: { allow: ['../..'] },
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: false,
      },
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: { '/api': { target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:8000', changeOrigin: false } },
  },
  build: { target: 'es2022', sourcemap: false },
});
