// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:9440',
        changeOrigin: true,
      },
      '/pairing': {
        target: 'http://localhost:9440',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:9440',
        ws: true,
      },
    },
  },
});
