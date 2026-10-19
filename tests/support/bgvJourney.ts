import { APIRequestContext, Page, expect, test } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';
import { StaffListPage } from '../../pages/StaffListPage';
import { StaffDetailsPage } from '../../pages/StaffDetailsPage';
import { config } from '../../utils/config';
import {
  clearUserBlacklistForContact,
  deactivateTestRiderDocuments,
  getCourtCase,
  getStaffRecord,
  getUserDocument,
  releaseTestKycNumbers,
  StaffRecord,
  waitForBgvStatus,
} from '../../utils/db';
import { acquireKycNumbersLock, releaseKycNumbersLock } from '../../utils/loginLock';
import { CourtCaseResult, RiderApi } from '../../utils/riderApi';
import { reportCourtCaseResult, vendorAuthToken } from '../../utils/authBridge';
import {
  AmazonStaffData,
  buildAmazonStaff,
  buildKycNumbers,
  buildRiderProfile,
  SAMPLE_KYC_DOCUMENTS,
  TEST_PROFILE_IMAGE_FILE,
  TEST_BGV_ADDRESS,
  TEST_SELFIE_IMAGE_FILE,
} from '../../utils/testData';

/** The rider a KYC test created, for its cleanup. */
export interface KycRider {
  userId?: number;
  contactNumber?: string;
}

/**
 * Registers the setup and cleanup every Amazon KYC test file needs - the same
 * steps titanautomation's Amazon BGV tests run around each test:
 *  - beforeAll: take the KYC numbers lock (one KYC test at a time, as they all
 *    save the same test Aadhaar / PAN), then free the numbers - an earlier run
 *    that was killed before its cleanup must not break this one;
 *  - afterAll, pass or fail: deactivate this rider's Aadhaar / PAN, clear any
 *    blacklisting (documents, user_blacklist by Aadhaar and by contact), free
 *    the numbers again, and release the lock.
 * Fill in the returned object as soon as the rider exists.
 */
/** The fixed (reused) numbers to free: the Aadhaar, plus the PAN if one is configured. */
const fixedKycNumbers = () => [buildKycNumbers().aadhaar, config.kycTestNumbers.pan].filter(Boolean);

export function useKycTestNumbers(): KycRider {
  const rider: KycRider = {};
  test.beforeAll(async () => {
    test.setTimeout(16 * 60_000); // may wait for another KYC test to finish
    await acquireKycNumbersLock();
    const freed = await releaseTestKycNumbers(fixedKycNumbers());
    console.info(`Test KYC numbers freed before the test: ${JSON.stringify(freed)}`);
  });
  test.afterAll(async () => {
    try {
      if (rider.userId) {
        const changed = await deactivateTestRiderDocuments(rider.userId, undefined, { unblacklist: true });
        console.info(`Cleanup: ${changed} AADHAR/PANCARD row(s) of user ${rider.userId} deactivated`);
      }
      if (rider.contactNumber) await clearUserBlacklistForContact(rider.contactNumber);
      const freed = await releaseTestKycNumbers(fixedKycNumbers());
      console.info(`Test KYC numbers freed after the test: ${JSON.stringify(freed)}`);
    } finally {
      releaseKycNumbersLock();
    }
  });
  return rider;
}

export interface InitiatedRider {
  staff: AmazonStaffData;
  record: StaffRecord;
}

/**
 * The steps every negative-BGV journey shares: create an Amazon rider, check
 * users / user_info, save their profile picture and selfie (rider app), save
 * Aadhaar and PAN with the sample documents, start BGV (Initiate, unless saving
 * the PAN already did) and check it is INITIATED everywhere.
 * `onCreated` gets the user id as soon as it exists, for the caller's cleanup.
 */
export async function createRiderWithBgvInitiated(
  page: Page,
  request: APIRequestContext,
  onCreated: (userId: number, contactNumber: string) => void,
): Promise<InitiatedRider> {
  const staff = buildAmazonStaff();
  // The fixed staging test numbers - freed for this test by useKycTestNumbers.
  const numbers = buildKycNumbers();
  const staffList = new StaffListPage(page);
  const details = new StaffDetailsPage(page);
  let record!: StaffRecord;

  await test.step('Log in and open Staff in Amazon Tez Bangalore', async () => {
    await new LoginPage(page).login(config.amazon.vendorNumber, { consent: false });
    await staffList.switchBranch(config.amazon.branch);
    await staffList.openFromNav();
  });

  await test.step('Add the delivery boy', async () => {
    const dialog = await staffList.openAddStaff();
    await dialog.fillAmazonBasicInfo(staff);
    await dialog.fillAmazonWorkInfo(staff);
    await expect(dialog.validationSummary()).toBeHidden();
    await dialog.submit();
  });

  await test.step('Verify the users and user_info rows in the DB', async () => {
    const found = await getStaffRecord(staff.contactNumber);
    expect(found, `no users/user_info row for ${staff.contactNumber}`).toBeDefined();
    record = found!;
    onCreated(record.userId, staff.contactNumber);
    expect(record).toMatchObject({
      name: staff.name,
      contactNumber: staff.contactNumber,
      status: 'APPROVED',
      isActive: 1,
      hubName: staff.hubName,
      vehicleType: staff.vehicleType,
      vehicleNumber: staff.vehicleNumber,
      staffType: staff.staffType,
    });
    expect(record.bgvStatus, 'user_info.bgv_status before KYC').toBeNull();
    test.info().annotations.push({
      type: 'Created staff',
      description: `${staff.name} | ${staff.contactNumber} | user_id ${record.userId} | ${record.staffUniqueId}`,
    });
  });

  // Rider-app login - off unless RIDER_APP_STEPS=true (see config.riderAppSteps).
  await (config.riderAppSteps ? test.step : test.step.skip)('Rider uploads a profile picture and a KYC selfie (rider app)', async () => {
    const rider = new RiderApi(request);
    await rider.login(staff.contactNumber);
    const profileLink = await rider.uploadImage(TEST_PROFILE_IMAGE_FILE);
    await rider.saveFullProfile(buildRiderProfile(staff, profileLink));
    await rider.uploadKycSelfie(await rider.uploadImage(TEST_SELFIE_IMAGE_FILE));
    expect((await getUserDocument(record.userId, 'SELFIE', 'PENDING_APPROVAL'))?.approvalStatus).toBe('PENDING_APPROVAL');
  });

  await test.step('Open the rider and save Aadhaar and PAN with the sample documents', async () => {
    // From the list, not by URL - the KYC section only loads that way.
    await staffList.search(staff.contactNumber);
    await staffList.rowFor(staff.name).click();
    await details.waitForUser(record.userId);

    await details.uploadKycDocuments(SAMPLE_KYC_DOCUMENTS);
    await details.saveAadhaarNumber(numbers.aadhaar);
    // Saving Aadhaar reloads the section and drops the unsaved PAN image.
    if ((await page.locator('input[type=file]').count()) > 0) {
      await details.uploadPanImage(SAMPLE_KYC_DOCUMENTS.pan);
    }
    await details.savePanNumber(numbers.pan);

    expect((await getUserDocument(record.userId, 'AADHAR', 'APPROVED'))?.approvalStatus, 'AADHAR').toBe('APPROVED');
    expect((await getUserDocument(record.userId, 'PANCARD', 'APPROVED'))?.approvalStatus, 'PANCARD - staging answered PAN Update with SUCCESS but stored no PAN; it drops PANs that fail verification, so set PAN_TEST_NUMBER in .env to a staging test PAN that passes (ask the backend team)').toBe('APPROVED');
  });

  await test.step('Start BGV: it comes back Insufficient for want of an address, then Retrigger BGV with one', async () => {
    // Saving Aadhaar + PAN starts BGV at once, but an Aadhaar typed in on the
    // vendor portal carries no address, so the check comes straight back
    // Insufficient without reaching AuthBridge - the same thing
    // titanautomation sees, and fixes with an OPS retrigger plus address.
    expect(await waitForBgvStatus(record.userId, 'Insufficient'), 'user_info.bgv_status right after the PAN save').toBe('Insufficient');

    // The Retrigger BGV button only renders on a freshly opened detail page.
    await staffList.openFromNav();
    await staffList.search(staff.contactNumber);
    await staffList.rowFor(staff.name).click();
    await details.waitForUser(record.userId);
    await details.retriggerBgvWithAddress(TEST_BGV_ADDRESS);

    await expect
      .poll(async () => (await getUserDocument(record.userId, 'PANCARD'))?.dlCaseCheck, {
        message: 'entity_documents PANCARD dl_case_check',
        timeout: 30_000,
      })
      .toBe('INITIATED');
    expect((await getCourtCase(record.userId, 'WorkInProgress'))?.caseStatus, 'rider_court_case_check').toBe('WorkInProgress');
    expect(await waitForBgvStatus(record.userId, 'INITIATED'), 'user_info.bgv_status').toBe('INITIATED');
  });

  return { staff, record };
}

/**
 * Plays AuthBridge: posts the court-case result for the rider's newest case,
 * authenticated with the logged-in vendor's dashboard token.
 */
export async function reportCourtCase(
  page: Page,
  request: APIRequestContext,
  rider: InitiatedRider,
  result: CourtCaseResult,
): Promise<void> {
  await test.step(`AuthBridge reports the court case as ${result}`, async () => {
    const courtCase = (await getCourtCase(rider.record.userId))!;
    test.info().annotations.push({
      type: 'BGV court case',
      description: `rider_court_case_check.id ${courtCase.id}, uniqueID ${courtCase.uniqueId}, requestId ${courtCase.requestId}`,
    });
    await reportCourtCaseResult(request, await vendorAuthToken(page), courtCase, result);
  });
}

/** Back to the staff list and into the rider again - the KYC section only loads that way. */
export async function reopenRider(page: Page, rider: InitiatedRider): Promise<StaffDetailsPage> {
  const staffList = new StaffListPage(page);
  const details = new StaffDetailsPage(page);
  await staffList.openFromNav();
  await staffList.search(rider.staff.contactNumber);
  await staffList.rowFor(rider.staff.name).click();
  await details.waitForUser(rider.record.userId);
  return details;
}

/** What the detail page says about BGV and the documents, for the report. */
export async function bgvTextOnPage(page: Page): Promise<string> {
  return (await page.locator('body').innerText())
    .split('\n')
    .map(l => l.trim())
    .filter(l => /Background Verification|Discrepan|Insufficient|Attention|Rejected|Verified/i.test(l))
    .join(' | ');
}
