import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { allureSuite } from '../utils/allureSuite';
import { config } from '../utils/config';

allureSuite(test, 'Login');

test.use({ storageState: { cookies: [], origins: [] } });

test('Verify that the vendor can log in with an OTP from the DB and lands on the staff list', async ({ page }) => {
  const loginPage = new LoginPage(page);

  await loginPage.login(config.vendorNumber);

  await expect(page).toHaveURL(/\/staff/);
});