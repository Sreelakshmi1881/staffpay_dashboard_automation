import { test, expect } from '@playwright/test';
import { allureSuite } from '../utils/allureSuite';
import { getCourtCase, getStaffRecord, getUserDocument } from '../utils/db';
import { bgvTextOnPage, createRiderWithBgvInitiated, reopenRider, reportCourtCase, useKycTestNumbers } from './support/bgvJourney';

allureSuite(test, 'AmazonBgvInsufficient');

/** Lock, free and afterwards clean up the shared test Aadhaar / PAN (see useKycTestNumbers). */
const kyc = useKycTestNumbers();

/**
 * BGV journey where AuthBridge can't conclude: rider with BGV initiated (see
 * bgvJourney), then an interim Insufficient court-case result. Insufficient is
 * "more information needed", not a rejection: the court case and BGV read
 * Insufficient, the rider and documents stay approved and nothing is
 * blacklisted.
 */
test('Verify that a rider whose BGV court case comes back Insufficient stays approved with BGV marked Insufficient', async ({ page, request }) => {
  // A full journey with two logins and the BGV round trip - longer than the project's 90s.
  test.setTimeout(240_000);
  const rider = await createRiderWithBgvInitiated(page, request, (id, phone) => Object.assign(kyc, { userId: id, contactNumber: phone }));
  const userId = rider.record.userId;

  await reportCourtCase(page, request, rider, 'Insufficient');

  await test.step('Record what changed after Insufficient', async () => {
    // Observed values first, so the report shows them even if a check below fails.
    await page.waitForTimeout(5_000);
    const user = await getStaffRecord(rider.staff.contactNumber);
    const aadhaar = await getUserDocument(userId, 'AADHAR', undefined, 1_000);
    const pan = await getUserDocument(userId, 'PANCARD', undefined, 1_000);
    const observed = {
      users: { status: user?.status, is_active: user?.isActive },
      user_info: { bgv_status: user?.bgvStatus },
      rider_court_case_check: await getCourtCase(userId),
      entity_documents: {
        AADHAR: aadhaar && { approval_status: aadhaar.approvalStatus, is_active: aadhaar.isActive, dl_case_check: aadhaar.dlCaseCheck },
        PANCARD: pan && { approval_status: pan.approvalStatus, is_active: pan.isActive, dl_case_check: pan.dlCaseCheck },
      },
    };
    console.info('AFTER INSUFFICIENT: ' + JSON.stringify(observed));
    test.info().annotations.push({ type: 'After Insufficient', description: JSON.stringify(observed) });
  });

  await test.step('Verify BGV is Insufficient and the rider stays approved', async () => {
    // rider_court_case_check: AuthBridge's interim result.
    expect(await getCourtCase(userId), 'rider_court_case_check').toMatchObject({
      caseStatus: 'Complete',
      caseSeverity: 'Insufficient',
      state: 'Interim',
    });
    // user_info and the PAN's court-case check: Insufficient.
    await expect
      .poll(async () => (await getStaffRecord(rider.staff.contactNumber))?.bgvStatus, { message: 'user_info.bgv_status', timeout: 20_000 })
      .toBe('Insufficient');
    expect((await getUserDocument(userId, 'PANCARD'))?.dlCaseCheck, 'PANCARD dl_case_check').toBe('Insufficient');
    // Not a rejection: rider and documents stay approved.
    expect(await getStaffRecord(rider.staff.contactNumber), 'users').toMatchObject({ status: 'APPROVED', isActive: 1 });
    for (const docType of ['AADHAR', 'PANCARD']) {
      expect((await getUserDocument(userId, docType))?.approvalStatus, `${docType} approval_status`).toBe('APPROVED');
    }

    await reopenRider(page, rider);
    await expect.soft(page.getByText('Insufficient', { exact: true }).first(), 'BGV timeline shows "Insufficient"').toBeVisible();
    const shown = await bgvTextOnPage(page);
    test.info().annotations.push({ type: 'UI after Insufficient', description: shown || '<nothing>' });
    console.info('UI after Insufficient: ' + (shown || '<nothing>'));
  });
});
