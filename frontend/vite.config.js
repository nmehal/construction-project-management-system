import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const backendTarget = 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '^/auth(?:/|$)': { target: backendTarget },
      '^/projects(?:/|$)': { target: backendTarget },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    clearMocks: true,
  },
});
