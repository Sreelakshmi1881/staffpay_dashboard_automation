import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { allureSuite } from '../utils/allureSuite';
import { StaffListPage } from '../pages/StaffListPage';
import { config } from '../utils/config';
import { buildStaff } from '../utils/testData';

allureSuite(test, 'StaffCreation');

/**
 * The whole vendor journey in one browser session: log in, pick the branch,
 * add a delivery staff and find them in the list. Runs in the `Staff Creation` project,
 * which starts logged out and does not depend on auth.setup.ts.
 */
test('Verify that a vendor can log in, switch to the Bluedart_Onboarding branch and add a delivery staff, and the new staff appears in the staff list', async ({ page }) => {
  const staff = buildStaff();
  const staffList = new StaffListPage(page);

  await new LoginPage(page).login(config.vendorNumber);
  await expect(page).toHaveURL(/\/staff/);
  await staffList.switchBranch(config.branch);

  const dialog = await staffList.openAddStaff();
  await dialog.fillBasicInfo(staff);
  await dialog.openWorkInfo();
  await dialog.selectHub(staff.hubName);
  await dialog.selectShift(staff.shiftName);

  await expect(dialog.validationSummary()).toBeHidden();
  await expect(dialog.submitButton()).toBeEnabled();
  await dialog.submit();

  await expect(dialog.root).toBeHidden();
  await staffList.search(staff.contactNumber);
  await expect(staffList.rowFor(staff.name)).toBeVisible();
});
