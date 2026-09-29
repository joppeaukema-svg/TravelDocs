import { defineConfig, devices } from '@playwright/test';

// Sandboxes with a preinstalled Chromium can point at it; CI installs its own browsers.
const chromiumExecutable = process.env.PW_CHROMIUM_EXECUTABLE;
// iPhone runs on WebKit in CI. Set PW_IPHONE_BROWSER=chromium where WebKit isn't installed.
const iphoneBrowser = process.env.PW_IPHONE_BROWSER === 'chromium' ? 'chromium' : 'webkit';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'pixel',
      use: {
        ...devices['Pixel 7'],
        ...(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}),
      },
    },
    {
      name: 'iphone',
      use: {
        ...devices['iPhone 13'],
        browserName: iphoneBrowser,
        ...(iphoneBrowser === 'chromium' && chromiumExecutable
          ? { launchOptions: { executablePath: chromiumExecutable } }
          : {}),
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
