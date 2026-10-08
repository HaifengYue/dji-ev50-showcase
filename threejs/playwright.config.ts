import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader'],
      ignoreDefaultArgs: ['--disable-back-forward-cache'],
    },
  },
  webServer: {
    command: 'node qa/serve-built.mjs',
    url: 'http://127.0.0.1:4174/hangar/',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
