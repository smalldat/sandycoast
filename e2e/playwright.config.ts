import { defineConfig, devices } from '@playwright/test';
import type { Pkg } from './fixtures/harness.js';

const PORT = 5299;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig<{ pkg: Pkg }>({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Pin everything that changes rasterization: the charts are canvases, so
    // scale and color profile are part of the test contract.
    deviceScaleFactor: 1,
    viewport: { width: 1100, height: 700 },
  },
  projects: [
    {
      // Canvas2D is the deterministic backend and the baseline for every
      // assertion. A WebGPU project follows in plan 08 step 5.
      name: 'chromium-canvas2d',
      use: {
        ...devices['Desktop Chrome'],
        deviceScaleFactor: 1,
        launchOptions: { args: ['--force-color-profile=srgb', '--font-render-hinting=none'] },
      },
    },
    {
      // Same scenarios against `dist/index.js` instead of `src/index.ts` — the
      // built `exports` map and tsup output, not just the TS sources. Requires
      // `npm run build` first; there is no dist/ dependency wired into the
      // `e2e` script itself, so run it manually before this project locally.
      name: 'packaged',
      use: {
        ...devices['Desktop Chrome'],
        deviceScaleFactor: 1,
        launchOptions: { args: ['--force-color-profile=srgb', '--font-render-hinting=none'] },
        pkg: 'dist',
      },
    },
  ],
  webServer: {
    command: 'npm run e2e:server',
    cwd: '..',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
