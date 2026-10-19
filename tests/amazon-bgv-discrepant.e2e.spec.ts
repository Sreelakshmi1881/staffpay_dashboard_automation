import { test, expect } from '@playwright/test';
import { allureSuite } from '../utils/allureSuite';
import { getCourtCase, getStaffRecord, getUserDocument, waitForBgvStatus } from '../utils/db';
import { bgvTextOnPage, createRiderWithBgvInitiated, reopenRider, reportCourtCase, useKycTestNumbers } from './support/bgvJourney';

allureSuite(test, 'AmazonBgvDiscrepant');

/** Lock, free and afterwards clean up the shared test Aadhaar / PAN (see useKycTestNumbers). */
const kyc = useKycTestNumbers();

/**
 * Negative BGV journey: rider with BGV initiated (see bgvJourney), then
 * AuthBridge reports the court case Discrepant - the rider and documents are
 * rejected and the documents blacklisted.
 */
test('Verify that a rider whose BGV court case comes back Discrepant is rejected', async ({ page, request }) => {
  // A full journey with two logins and the BGV round trip - longer than the project's 90s.
  test.setTimeout(240_000);
  const rider = await createRiderWithBgvInitiated(page, request, (id, phone) => Object.assign(kyc, { userId: id, contactNumber: phone }));
  const userId = rider.record.userId;

  await reportCourtCase(page, request, rider, 'Discrepant');

  await test.step('Verify the rider and documents are rejected after Discrepant', async () => {
    expect(await getCourtCase(userId, 'Complete'), 'rider_court_case_check').toMatchObject({
      caseStatus: 'Complete',
      caseSeverity: 'Discrepant',
      state: 'Final',
    });
    expect(await waitForBgvStatus(userId, 'FAILED'), 'user_info.bgv_status').toBe('FAILED');
    for (const docType of ['AADHAR', 'PANCARD']) {
      expect(await getUserDocument(userId, docType, 'REJECTED'), `${docType} row`).toMatchObject({
        approvalStatus: 'REJECTED',
        isActive: 1,
        dlCaseCheck: 'FAILED',
      });
    }
    // users: rejected, the account itself stays active.
    expect(await getStaffRecord(rider.staff.contactNumber), 'users').toMatchObject({ status: 'REJECTED', isActive: 1 });

    await reopenRider(page, rider);
    await expect.soft(page.getByText('Discrepancy', { exact: true }).first(), 'BGV timeline shows "Discrepancy"').toBeVisible();
    await expect.soft(page.getByText('Manually Rejected').first(), 'documents show "Manually Rejected"').toBeVisible();
    const shown = await bgvTextOnPage(page);
    test.info().annotations.push({ type: 'UI after Discrepant', description: shown || '<nothing>' });
    console.info('UI after Discrepant: ' + (shown || '<nothing>'));
  });
});
