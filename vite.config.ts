import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  // Direct Vite to the React application directory
  root: path.resolve(__dirname, './artifacts/sovereign-agent'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './artifacts/sovereign-agent/src'),
      '~': path.resolve(__dirname, '.'),
    },
  },
  server: {
    port: 5173,
    host: true, // Required for GitHub Codespaces forwarded port preview
    hmr: process.env.DISABLE_HMR !== 'true',
    proxy: {
      '/api': {
        target: process.env.API_TARGET || 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});