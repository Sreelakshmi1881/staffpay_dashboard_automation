import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { allureSuite } from '../utils/allureSuite';
import { StaffListPage } from '../pages/StaffListPage';
import { ApprovalWorkflowPage } from '../pages/ApprovalWorkflowPage';
import { config } from '../utils/config';
import { buildStaff } from '../utils/testData';

allureSuite(test, 'StaffCreation');

/**
 * The whole journey in one browser session. A vendor-created staff is only an
 * approval request (BDR-...) until BD OPS approves it, so the test logs in as
 * the vendor, then as OPS to approve, then as the vendor again to find the
 * staff - the same flow titanautomation runs for Bluedart riders.
 * Runs in the `Staff Creation` project, which starts logged out.
 */
test('Verify that a staff added by the vendor is raised for approval, and once BD OPS approves it the new staff appears in the vendor staff list', async ({ page }) => {
  const staff = buildStaff();
  const login = new LoginPage(page);
  const staffList = new StaffListPage(page);
  let requestRef = '';

  await test.step('Vendor logs in and switches to the Bluedart_Onboarding branch', async () => {
    await login.login(config.vendorNumber);
    await expect(page).toHaveURL(/\/staff/);
    await staffList.switchBranch(config.branch);
  });

  await test.step('Vendor adds a delivery staff, which raises an approval request', async () => {
    const dialog = await staffList.openAddStaff();
    await dialog.fillBasicInfo(staff);
    await dialog.openWorkInfo();
    await dialog.selectHub(staff.hubName);
    await dialog.selectShift(staff.shiftName);

    await expect(dialog.validationSummary()).toBeHidden();
    await expect(dialog.submitButton()).toBeEnabled();
    requestRef = await dialog.submit();
    await expect(dialog.root).toBeHidden();
    test.info().annotations.push({ type: 'approval request', description: requestRef });
  });

  await test.step('BD OPS logs in and approves the request as a New Addition', async () => {
    await login.logout();
    await login.loginAsOps(config.opsNumber);
    const approvals = new ApprovalWorkflowPage(page);
    await approvals.open();
    await approvals.approve(requestRef, 'New Addition');
  });

  await test.step('Vendor logs in again and finds the new staff in the list', async () => {
    await login.logout();
    await login.login(config.vendorNumber);
    await staffList.switchBranch(config.branch);
    await staffList.search(staff.contactNumber);
    await expect(staffList.rowFor(staff.name)).toBeVisible();
  });
});
