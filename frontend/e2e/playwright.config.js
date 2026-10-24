import { defineConfig, devices } from '@playwright/test';

// Do not persist authentication inputs, tokens, or page snapshots in artifacts.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.js',
  globalSetup: './require-credentials.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  outputDir: '../test-results',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:8080',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Deliberately no webServer: use the operator's existing demo stack/database.
});
