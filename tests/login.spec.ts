import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { config } from '../utils/config';

test.use({ storageState: { cookies: [], origins: [] } });

test('vendor can log in', async ({ page }) => {
  const loginPage = new LoginPage(page);

  await loginPage.login(config.vendorNumber);

  await expect(page).toHaveURL(/\/staff/);
});