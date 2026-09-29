import { test as setup } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { allureSuite } from '../utils/allureSuite';
import { StaffListPage } from '../pages/StaffListPage';
import { config } from '../utils/config';

allureSuite(setup, 'Login');

/**
 * Logs in once and saves the browser session to a file. Every other test
 * starts from that file, already logged in.
 */
setup('Verify that the vendor can log in with an OTP from the DB and switch to the Bluedart_Onboarding branch', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.login(config.vendorNumber);

  await page.waitForURL(/\/staff/);
  await new StaffListPage(page).switchBranch(config.branch);
  await page.context().storageState({ path: '.auth/vendor.json' });
});
