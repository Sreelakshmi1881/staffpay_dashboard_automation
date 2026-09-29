import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * Pause between every browser action, in milliseconds. Zero by default so
 * normal and CI runs stay fast; `npm run test:watch` turns it up so a headed
 * run is slow enough to follow along with.
 */
const slowMo = Number(process.env.SLOW_MO ?? 0);

/**
 * A headed run is something a person is watching, so keep it to one browser
 * window - the default worker count opens four at once, racing each other.
 */
const headed = process.argv.includes('--headed') || !!process.env.PWDEBUG;

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* SLOW_MO pauses on every action, so a slowed run gets a longer timeout. */
  timeout: slowMo ? 120_000 : 30_000,
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* One worker on CI, and one for headed runs so there is a single window. */
  workers: process.env.CI || headed ? 1 : undefined,
  /* Everything a run produces lands under reports/. See https://playwright.dev/docs/test-reporters */
  outputDir: 'reports/test-output',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html-report', open: 'never' }],
    ['allure-playwright', { resultsDir: 'reports/allure-results' }],
    ['./utils/recordingsReporter.ts'],
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
    baseURL: 'https://staging.staffpay.in',
    trace: 'on-first-retry',
    video: 'on',
    screenshot: 'only-on-failure',
    launchOptions: { slowMo },
  },
  /* Configure project for Chrome */
     projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: 'chromium',
      testIgnore: /.*\.e2e\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: '.auth/vendor.json' },
      dependencies: ['setup'],
    },
    /* Full journeys that log in themselves, in one browser session. No
       dependencies, so running the file runs just that journey. Parallel logins
       are kept apart by the lock in LoginPage.login. */
    {
      name: 'Staff Creation',
      testMatch: /.*\.e2e\.spec\.ts/,
      /* A whole journey takes ~25s, plus any wait for the login lock. */
      timeout: slowMo ? 180_000 : 90_000,
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
