import { defineConfig, devices } from '@playwright/test';

const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };
const desktop = { viewport: { width: 1280, height: 800 } };

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5199', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev:demo', url: 'http://localhost:5199', reuseExistingServer: !process.env.CI, timeout: 60_000 },
  projects: [
    { name: 'phone-dark', use: { ...devices['Desktop Chrome'], ...phone, colorScheme: 'dark' } },
    { name: 'desktop-dark', use: { ...devices['Desktop Chrome'], ...desktop, colorScheme: 'dark' } },
  ],
});
