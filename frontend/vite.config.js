import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const backendTarget = 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '^/auth(?:/|$)': { target: backendTarget },
      '^/projects(?:/|[?]|$)': {
        target: backendTarget,
        // Project screen URLs overlap API paths. Browser navigation needs the
        // SPA entry; fetch requests use Accept: application/json and still proxy.
        bypass(req) {
          if (req.method === 'GET' && req.headers.accept?.includes('text/html')) {
            return '/index.html';
          }
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    clearMocks: true,
  },
});
