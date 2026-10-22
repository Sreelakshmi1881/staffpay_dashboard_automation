import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { StaffListPage, StaffCounts } from '../pages/StaffListPage';
import { ApprovalWorkflowPage } from '../pages/ApprovalWorkflowPage';
import { allureSuite } from '../utils/allureSuite';
import { config } from '../utils/config';
import { getBluedartApprovalRequest, getUserByContact } from '../utils/db';
import { buildStaff } from '../utils/testData';

allureSuite(test, 'BluedartOnboardingApproval');

/**
 * Blue Dart onboarding with super-admin approval. A Blue Dart vendor's new
 * staff doesn't become a user straight away: it waits in
 * titan.bluedart_approval_request (PENDING) until the Blue Dart super admin
 * approves it on the Approval Workflow tab.
 *
 * Vendor 9519519514 (Bluedart_Onboarding) adds a delivery staff -> request
 * PENDING, no users row, not in the vendor's list -> super admin 2288777001
 * reviews it (Addition type "New Addition", remark "new user") -> request
 * APPROVED / NEW_ADDITION, users row created, rider in the Approved list and
 * in the vendor's Total / KYC Pending lists.
 */
test('Verify that a Blue Dart rider added by the vendor waits for super admin approval and shows for the vendor once approved', async ({ browser }) => {
  test.setTimeout(300_000);
  const staff = buildStaff();
  const remark = 'new user';

  // Two people, two sessions.
  const vendorContext = await browser.newContext();
  const adminContext = await browser.newContext();
  const vendorPage = await vendorContext.newPage();
  const adminPage = await adminContext.newPage();
  const staffList = new StaffListPage(vendorPage);
  const approvals = new ApprovalWorkflowPage(adminPage);
  let before: StaffCounts;
  let requestRef = '';

  // After a search the Search button turns into Reset - press it first so
  // StaffListPage.search() finds its Search button on the next search.
  const searchVendorList = async (term: string) => {
    const reset = vendorPage.getByRole('button', { name: 'Reset', exact: true });
    if (await reset.isVisible()) {
      await reset.click();
      await expect(vendorPage.getByRole('button', { name: 'Search', exact: true })).toBeVisible();
    }
    await staffList.search(term);
  };

  try {
    await test.step('Vendor logs in and opens Staff in Bluedart_Onboarding', async () => {
      await new LoginPage(vendorPage).login(config.vendorNumber); // Blue Dart shows T&C consent
      await vendorPage.waitForURL(/\/staff/);
      await staffList.switchBranch(config.branch);
      await staffList.goto();
    });

    await test.step('Note the Total Staffs and KYC Pending counts', async () => {
      before = await staffList.showCounts();
      test.info().annotations.push({ type: 'Counts before', description: JSON.stringify(before) });
    });

    await test.step('Vendor adds a delivery staff - it goes for approval', async () => {
      const dialog = await staffList.openAddStaff();
      await dialog.fillBasicInfo(staff);
      await dialog.openWorkInfo();
      await dialog.selectHub(staff.hubName);
      await dialog.selectShift(staff.shiftName);
      await expect(dialog.validationSummary()).toBeHidden();
      const message = await dialog.submit();
      // e.g. "PENDING_REQUEST_APPROVAL — BDR-16DDDF590097"
      expect(message, 'Add Staff response').toMatch(/PENDING_REQUEST_APPROVAL/);
      requestRef = message.match(/BDR-[A-Z0-9]+/)?.[0] ?? '';
      expect(requestRef, 'request ref in the response').toBeTruthy();
      test.info().annotations.push({ type: 'Created staff', description: `${staff.name} | ${staff.contactNumber} | ${requestRef}` });
    });

    await test.step('Before approval: request PENDING, no user yet, not in the vendor list', async () => {
      const request = await getBluedartApprovalRequest(staff.contactNumber, 'PENDING');
      expect(request, `no bluedart_approval_request row for ${staff.contactNumber}`).toBeDefined();
      expect(request).toMatchObject({
        requestRef,
        requestType: 'ONBOARDING',
        status: 'PENDING',
        contactNumber: staff.contactNumber,
        orgId: 579,
        requesterRole: 'BLUEDART_VENDOR',
        subjectUserId: null,
        additionType: null,
        decidedBy: null,
        decidedByRole: null,
      });
      expect(await getUserByContact(staff.contactNumber), 'users row before approval').toBeUndefined();

      await searchVendorList(staff.contactNumber);
      await expect(staffList.rowFor(staff.name), 'rider in the vendor list before approval').toHaveCount(0);
    });

    await test.step('Super admin logs in and finds the request under Approval Workflow > Onboarding > Pending', async () => {
      await new LoginPage(adminPage).loginAsOps(config.opsNumber);
      await approvals.open();
      await approvals.showStatus('Pending');
      // The request can land a moment after the vendor's create call - refresh until it shows.
      await expect(async () => {
        await adminPage.getByRole('button', { name: 'Refresh' }).click();
        await expect(approvals.rowFor(requestRef)).toBeVisible({ timeout: 3_000 });
      }).toPass({ timeout: 30_000 });
      await expect(approvals.rowFor(requestRef)).toContainText(staff.contactNumber);
      await expect(approvals.rowFor(requestRef)).toContainText(staff.name);
    });

    await test.step('Super admin reviews: Addition type "New Addition", remark "new user", Approve & Submit', async () => {
      // Same steps as ApprovalWorkflowPage.approve(), plus the "Remark (optional)" box
      // (saved as decision_remark), which approve() doesn't fill.
      await approvals.rowFor(requestRef).getByRole('button', { name: 'Review' }).click();
      const dialog = adminPage.getByRole('dialog').filter({ hasText: requestRef });
      await expect(dialog).toBeVisible();
      await dialog.locator('[aria-haspopup="listbox"]').first().click();
      await adminPage.getByRole('listbox').getByRole('option', { name: 'New Addition', exact: true }).click();
      await dialog.getByRole('textbox').last().fill(remark);

      const approved = adminPage.waitForResponse(
        r => r.request().method() === 'POST' && r.url().includes(`/approval-requests/${requestRef}/approve`),
      );
      await dialog.getByRole('button', { name: 'Approve & Submit' }).click();
      const body = await (await approved).json();
      expect(body.status?.code, `approve ${requestRef}: ${JSON.stringify(body.status)}`).toBe(200);
      expect(body.response?.status, `approve ${requestRef}`).toBe('APPROVED');
      await expect(dialog).toBeHidden();
    });

    await test.step('After approval: request APPROVED, user created, rider in the Approved list', async () => {
      const request = await getBluedartApprovalRequest(staff.contactNumber, 'APPROVED');
      expect(request, 'bluedart_approval_request').toMatchObject({
        requestRef,
        status: 'APPROVED',
        additionType: 'NEW_ADDITION',
        decidedByRole: 'BLUEDART_SUPER_ADMIN',
        decisionRemark: remark,
      });
      expect(request!.decidedBy, 'decided_by').toBeTruthy();
      expect(request!.decidedAt, 'decided_at').toBeTruthy();

      const user = await getUserByContact(staff.contactNumber);
      expect(user, 'users row after approval').toBeDefined();
      expect(user).toMatchObject({ name: staff.name, isActive: 1, orgId: 579 });
      expect(request!.subjectUserId, 'subject_user_id = the new users.id').toBe(user!.id);
      test.info().annotations.push({ type: 'After approval', description: `user_id ${user!.id}, users.status ${user!.status}` });

      await approvals.showStatus('Approved');
      const row = approvals.rowFor(requestRef);
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row).toContainText(staff.contactNumber);
      // The UI shows the role label ("Super Admin"), not decided_by_role.
      await expect(row).toContainText('Super Admin');
    });

    await test.step('Vendor sees the rider: counts went up, listed under Total and KYC Pending', async () => {
      await vendorPage.reload();
      const after = await staffList.showCounts();
      test.info().annotations.push({ type: 'Counts after', description: JSON.stringify(after) });
      // Staging is shared - "went up", not "+1 exactly".
      expect(after.total, 'Total Staffs').toBeGreaterThan(before.total);
      expect(after.kycPending, 'KYC Pending').toBeGreaterThan(before.kycPending);

      await searchVendorList(staff.contactNumber);
      await expect(staffList.rowFor(staff.name), 'rider under Total').toBeVisible();

      await staffList.openKycPendingTab();
      await searchVendorList(staff.contactNumber);
      await expect(staffList.rowFor(staff.name), 'rider under KYC Pending').toBeVisible();
    });
  } finally {
    await vendorContext.close();
    await adminContext.close();
  }
});
