import { test as setup } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { config } from '../utils/config';

/**
 * Logs in once and saves the browser session to a file. Every other test
 * starts from that file, already logged in.
 */
setup('authenticate as vendor', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.login(config.vendorNumber);

  await page.waitForURL(/\/staff/);
  await page.context().storageState({ path: '.auth/vendor.json' });
});
