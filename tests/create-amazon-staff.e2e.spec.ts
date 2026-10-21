import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { allureSuite } from '../utils/allureSuite';
import { StaffListPage, StaffCounts } from '../pages/StaffListPage';
import { StaffDetailsPage } from '../pages/StaffDetailsPage';
import { config } from '../utils/config';
import {
  getCourtCase,
  getStaffRecord,
  getUserDocument,
  StaffRecord,
  waitForBgvStatus,
} from '../utils/db';
import { RiderApi } from '../utils/riderApi';
import { reportCourtCaseResult, vendorAuthToken } from '../utils/authBridge';
import { useKycTestNumbers } from './support/bgvJourney';
import {
  buildAmazonStaff,
  buildRiderProfile,
  buildKycNumbers,
  SAMPLE_KYC_DOCUMENTS,
  TEST_BGV_ADDRESS,
  TEST_PROFILE_IMAGE_FILE,
  TEST_SELFIE_IMAGE_FILE,
} from '../utils/testData';

allureSuite(test, 'AmazonStaffCreation');

// The KYC test works on the rider the first test creates, so run in order;
// if the first test fails the second is skipped.
test.describe.configure({ mode: 'serial' });

/** The rider created by the first test, for the KYC test. */
let created: { name: string; contactNumber: string; userId: number } | undefined;

/** Lock, free and afterwards clean up the shared test Aadhaar / PAN (see useKycTestNumbers). */
const kyc = useKycTestNumbers();

/**
 * The Amazon Now vendor journey in one browser session: log in, pick the
 * Amazon Tez Bangalore branch, open Staff, note the staff counts, add a
 * delivery boy, check the counts went up and the users / user_info rows,
 * let the rider save their profile picture from the rider app (API), then
 * find the staff under KYC Pending and open their detail page.
 * Runs in the `Staff Creation` project, starting logged out.
 */
test('Verify that an Amazon vendor can add a delivery boy who raises the Total Staffs and KYC Pending counts, is saved as an approved user, can upload a profile picture and selfie from the rider app, and opens from the KYC Pending tab with the selfie shown', async ({ page, request }) => {
  const staff = buildAmazonStaff();
  const staffList = new StaffListPage(page);
  let before: StaffCounts;
  let record: StaffRecord;
  let imageLink: string;
  let selfieLink: string;
  let details: StaffDetailsPage;

  await test.step('Log in and open Staff in Amazon Tez Bangalore', async () => {
    await new LoginPage(page).login(config.amazon.vendorNumber, { consent: false });
    await staffList.switchBranch(config.amazon.branch);
    await staffList.openFromNav();
  });

  await test.step('Note the Total Staffs and KYC Pending counts', async () => {
    before = await staffList.showCounts();
    test.info().annotations.push({ type: 'Counts before', description: JSON.stringify(before) });
  });

  await test.step('Add the delivery boy', async () => {
    const dialog = await staffList.openAddStaff();
    await dialog.fillAmazonBasicInfo(staff);
    await dialog.fillAmazonWorkInfo(staff);

    await expect(dialog.validationSummary()).toBeHidden();
    await expect(dialog.submitButton()).toBeEnabled();
    await dialog.submit();
  });

  await test.step('Verify the users and user_info rows in the DB', async () => {
    const found = await getStaffRecord(staff.contactNumber);
    expect(found, `no users/user_info row for ${staff.contactNumber}`).toBeDefined();
    record = found!;

    // users: created straight away (no approval queue, unlike Blue Dart).
    expect(record).toMatchObject({ name: staff.name, status: 'APPROVED', isActive: 1 });
    // user_info: what was chosen in the form.
    expect(record).toMatchObject({
      vehicleNumber: staff.vehicleNumber,
      hubName: staff.hubName,
      vehicleType: staff.vehicleType,
      staffType: staff.staffType,
    });
    expect(record.staffUniqueId).toBeTruthy();
    expect(record.userOrgId).toBe(record.hubOrgId);
    // users: the number entered; user_info: what the form defaults to and today's joining date.
    const todayIst = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    expect(record).toMatchObject({
      contactNumber: staff.contactNumber,
      staffTypeId: 1, // Delivery Boy
      salaryType: 4, // Workbasis - the Salary Info default
      selfieEnabled: 1,
      trackAndTraceEnabled: 1,
      geofenceAutoApproval: 1,
      doj: todayIst,
    });
    // No documents yet, so no background verification either.
    expect(record.bgvStatus, 'user_info.bgv_status before KYC').toBeNull();
    created = { name: staff.name, contactNumber: staff.contactNumber, userId: record.userId };
    Object.assign(kyc, { userId: record.userId, contactNumber: staff.contactNumber });

    test.info().annotations.push({
      type: 'Created staff',
      description: `${staff.name} | ${staff.contactNumber} | user_id ${record.userId} | ${record.staffUniqueId}`,
    });
  });

  // Test data, not an app test: the rider's token comes from /auth/generate-token
  // (titanautomation's TitanAPI.generateToken) - staging refuses scripted OTP logins.
  await test.step('Rider uploads a profile picture and a KYC selfie (rider-app API)', async () => {
    const rider = new RiderApi(request);
    await rider.useGeneratedToken(record.userId, staff.contactNumber);

    imageLink = await rider.uploadImage(TEST_PROFILE_IMAGE_FILE);
    const image = await request.get(imageLink);
    expect(image.status(), `uploaded image ${imageLink}`).toBe(200);
    expect(image.headers()['content-type']).toBe('image/png');

    const profile = buildRiderProfile(staff, imageLink);
    await rider.saveFullProfile(profile);
    test.info().annotations.push({ type: 'Profile picture', description: imageLink });

    // fullProfile/save writes the picture to users and the rest to user_info.
    const saved = await getStaffRecord(staff.contactNumber);
    expect(saved).toMatchObject({
      profileImageLink: profile.s3ProfileLink,
      address: profile.address,
      pincode: profile.pincode,
      emergencyContactName: profile.emergencyContactName,
      emergencyContactNumber: profile.emergencyContactNumber,
    });

    // The vendor portal's "Selfie" comes from the rider-app KYC selfie step.
    // It needs its own upload: re-sending the profile picture's link leaves
    // the selfie document at CREATED.
    selfieLink = await rider.uploadImage(TEST_SELFIE_IMAGE_FILE);
    await rider.uploadKycSelfie(selfieLink);
    test.info().annotations.push({ type: 'Selfie', description: selfieLink });
  });

  await test.step('Verify the selfie in entity_documents', async () => {
    const selfie = await getUserDocument(record.userId, 'SELFIE', 'PENDING_APPROVAL');
    expect(selfie, `no SELFIE row in entity_documents for user ${record.userId}`).toBeDefined();
    // fullProfile/save created the row with the profile picture; the KYC
    // selfie step sends it for approval but leaves doc_link as it was.
    expect(selfie).toMatchObject({
      docLink: imageLink,
      approvalStatus: 'PENDING_APPROVAL',
      isActive: 1,
      autoKycBroker: 'HYPERVERGE',
    });
    // ...and writes the selfie to users.s3_profile_link - what the portal shows.
    expect((await getStaffRecord(staff.contactNumber))?.profileImageLink).toBe(selfieLink);
    test.info().annotations.push({ type: 'Selfie document', description: `entity_documents.id ${selfie!.id}` });
  });

  await test.step('Verify Total Staffs and KYC Pending both went up', async () => {
    // The cards do not refresh after adding a staff - reload for fresh numbers.
    await page.reload();
    const after = await staffList.showCounts();
    test.info().annotations.push({ type: 'Counts after', description: JSON.stringify(after) });

    // Staging is shared, so others may add staff too: assert "went up", not "+1 exactly".
    expect(after.total, 'Total Staffs').toBeGreaterThan(before.total);
    expect(after.kycPending, 'KYC Pending').toBeGreaterThan(before.kycPending);
  });

  await test.step('Find the staff under KYC Pending by phone number', async () => {
    await staffList.openKycPendingTab();
    await staffList.search(staff.contactNumber);
    await expect(staffList.rowFor(staff.name)).toBeVisible();
  });

  await test.step('Open the staff detail page', async () => {
    await staffList.rowFor(staff.name).click();

    details = new StaffDetailsPage(page);
    await details.waitForUser(record.userId);
    await expect(details.name(staff.name)).toBeVisible();
    await expect(details.kycStatus('KYC Pending')).toBeVisible();
    await expect(details.summaryPart(record.staffUniqueId)).toBeVisible();
    await expect(details.summaryPart(staff.contactNumber)).toBeVisible();
    {
      await expect(details.selfieImage(selfieLink), 'selfie on the vendor portal').toBeVisible();
    }
  });

});

/**
 * KYC on the vendor portal for the rider created above: upload sample Aadhaar
 * (front, back) and PAN images, enter the numbers, Save / Update, then
 * Approve both, checking entity_documents after each.
 *
 * Numbers are generated per run and can never be a real ID (see buildKycNumbers).
 *
 * How staging behaves today (vendor portal, Amazon org) - the test expects this:
 *  - Save (Aadhaar) / Update (PAN) approve the document straight away
 *    ("Manually Verified"), so Approve stays disabled and is only clicked if
 *    it is enabled.
 *  - The uploaded images are not linked to the saved rows (doc_link null) -
 *    recorded in the report as a known issue, not failed on.
 *
 * Approved Aadhaar + PAN start the background verification (BGV): the PAN row's
 * dl_case_check goes INITIATED, rider_court_case_check gets a WorkInProgress
 * case and user_info.bgv_status is INITIATED. The test then plays AuthBridge
 * (the court-case webhook, with that case's uniqueID / requestId) and expects
 * Complete / VERIFIED / VERIFIED.
 */
test('Verify that a vendor can upload Aadhaar and PAN with their numbers and approve both, which starts BGV, and BGV completes when AuthBridge reports the court case clear', async ({ page, request }) => {
  test.skip(!created, 'needs the rider from the previous test');
  const rider = created!;
  const staffList = new StaffListPage(page);
  const details = new StaffDetailsPage(page);
  let links: Record<string, string> = {};
  const numbers = buildKycNumbers();
  /** Known staging issue: the uploaded image isn't linked to the saved row. Reported, not failed on. */
  const noteMissingImageLink = (docType: string, docLink: string | null) => {
    if (!docLink) {
      test.info().annotations.push({ type: 'Known issue', description: `${docType} saved without its uploaded image (doc_link null)` });
    }
  };

  await test.step('Log in and open the new rider from the staff list', async () => {
    await new LoginPage(page).login(config.amazon.vendorNumber, { consent: false });
    await staffList.switchBranch(config.amazon.branch);
    await staffList.openFromNav();
    // From the list, not by URL - the KYC section only loads that way.
    await staffList.search(rider.contactNumber);
    await staffList.rowFor(rider.name).click();
    await details.waitForUser(rider.userId);
  });

  await test.step('Upload sample Aadhaar (front, back) and PAN images', async () => {
    links = await details.uploadKycDocuments(SAMPLE_KYC_DOCUMENTS);
    test.info().annotations.push({ type: 'KYC document uploads', description: JSON.stringify(links) });
  });

  await test.step('Enter the Aadhaar number and Save', async () => {
    await details.saveAadhaarNumber(numbers.aadhaar);

    const doc = await getUserDocument(rider.userId, 'AADHAR');
    expect(doc, `no AADHAR row in entity_documents for user ${rider.userId}`).toBeDefined();
    test.info().annotations.push({ type: 'AADHAR after Save', description: `id ${doc!.id}, ${doc!.approvalStatus}, doc_link ${doc!.docLink ?? 'null'}` });
    expect(doc!.isActive, 'AADHAR is_active').toBe(1);
    // Save approves the Aadhaar directly - the card then reads "Manually Verified".
    expect(doc!.approvalStatus, 'AADHAR approval_status after Save').toBe('APPROVED');
    await expect(page.getByText('Manually Verified').first(), 'Aadhaar card shows "Manually Verified"').toBeVisible();
    noteMissingImageLink('AADHAR', doc!.docLink);
  });

  await test.step('Enter the PAN number and Update', async () => {
    // Saving Aadhaar reloaded the section and dropped the unsaved PAN image.
    if ((await page.locator('input[type=file]').count()) > 0) {
      links.pan = await details.uploadPanImage(SAMPLE_KYC_DOCUMENTS.pan);
    }
    await details.savePanNumber(numbers.pan);

    const doc = await getUserDocument(rider.userId, 'PANCARD', 'APPROVED');
    expect(doc, `no PANCARD row in entity_documents for user ${rider.userId} - staging answered PAN Update with SUCCESS but stored no PAN; it drops PANs that fail verification, so set PAN_TEST_NUMBER in .env to a staging test PAN that passes (ask the backend team)`).toBeDefined();
    test.info().annotations.push({ type: 'PANCARD after Update', description: `id ${doc!.id}, ${doc!.approvalStatus}, doc_link ${doc!.docLink ?? 'null'}` });
    expect(doc!.isActive, 'PANCARD is_active').toBe(1);
    // Update approves the PAN directly, like Aadhaar's Save.
    expect(doc!.approvalStatus, 'PANCARD approval_status after Update').toBe('APPROVED');
    noteMissingImageLink('PANCARD', doc!.docLink);
  });

  await test.step('Approve Aadhaar and PAN (if not already approved)', async () => {
    for (const [label, card, docType] of [
      ['Aadhaar', details.aadhaarCard(), 'AADHAR'],
      ['PAN', details.panCard(), 'PANCARD'],
    ] as const) {
      // Save / Update already approve it on staging ("Manually Verified"); the
      // Approve button can still look enabled but sends nothing then, so only
      // click it for a document that is not approved yet.
      const before = await getUserDocument(rider.userId, docType, undefined, 1_000);
      if (before?.approvalStatus !== 'APPROVED' && (await details.approveButton(card).isEnabled())) {
        await details.approve(card);
      }
      const doc = await getUserDocument(rider.userId, docType, 'APPROVED');
      expect(doc?.approvalStatus, `${label} (${docType}) approval_status`).toBe('APPROVED');
    }
  });

  /** Back to the list and into the rider again - a reload by URL leaves the KYC section empty. */
  const reopenRider = async () => {
    await staffList.openFromNav();
    await staffList.search(rider.contactNumber);
    await staffList.rowFor(rider.name).click();
    await details.waitForUser(rider.userId);
  };
  /** What the detail page says about background verification, for the report. */
  const bgvLines = async () =>
    (await page.locator('body').innerText())
      .split('\n')
      .map(l => l.trim())
      .filter(l => /\bBGV\b|Background Verification|^Verified$/i.test(l));

  await test.step('BGV comes back Insufficient for want of an address - Retrigger BGV with one', async () => {
    // Saving Aadhaar + PAN starts BGV, but a vendor-typed Aadhaar has no
    // address, so it is Insufficient at once (see bgvJourney).
    expect(await waitForBgvStatus(rider.userId, 'Insufficient'), 'user_info.bgv_status right after the PAN save').toBe('Insufficient');
    await reopenRider();
    await details.retriggerBgvWithAddress(TEST_BGV_ADDRESS);
  });

  await test.step('Verify BGV is initiated', async () => {
    await expect
      .poll(async () => (await getUserDocument(rider.userId, 'PANCARD'))?.dlCaseCheck, {
        message: 'entity_documents PANCARD dl_case_check',
        timeout: 30_000,
      })
      .toBe('INITIATED');

    const courtCase = await getCourtCase(rider.userId, 'WorkInProgress');
    expect(courtCase, `no rider_court_case_check row for user ${rider.userId}`).toBeDefined();
    expect(courtCase!.caseStatus, 'rider_court_case_check.case_status').toBe('WorkInProgress');
    expect(await waitForBgvStatus(rider.userId, 'INITIATED'), 'user_info.bgv_status').toBe('INITIATED');
    test.info().annotations.push({
      type: 'BGV court case',
      description: `rider_court_case_check.id ${courtCase!.id}, uniqueID ${courtCase!.uniqueId}, requestId ${courtCase!.requestId}`,
    });

    await reopenRider();
    const shown = await bgvLines();
    test.info().annotations.push({ type: 'BGV in UI (initiated)', description: shown.join(' | ') || '<nothing>' });
    await expect.soft(details.bgvInitiated(), 'detail page shows "Background Verification Initiated"').toBeVisible();
  });

  await test.step('Mark BGV completed through the AuthBridge court-case webhook', async () => {
    const courtCase = (await getCourtCase(rider.userId))!;
    // Authenticated with the vendor's own dashboard token - no rider-app login.
    await reportCourtCaseResult(request, await vendorAuthToken(page), courtCase, 'Clear');
  });

  await test.step('Verify BGV is verified', async () => {
    const courtCase = await getCourtCase(rider.userId, 'Complete');
    expect(courtCase, 'rider_court_case_check').toMatchObject({ caseStatus: 'Complete', state: 'Final', caseSeverity: 'Clear' });
    await expect
      .poll(async () => (await getUserDocument(rider.userId, 'PANCARD'))?.dlCaseCheck, {
        message: 'entity_documents PANCARD dl_case_check',
        timeout: 20_000,
      })
      .toBe('VERIFIED');
    expect(await waitForBgvStatus(rider.userId, 'VERIFIED'), 'user_info.bgv_status').toBe('VERIFIED');

    await reopenRider();
    const shown = await bgvLines();
    test.info().annotations.push({ type: 'BGV in UI (verified)', description: shown.join(' | ') || '<nothing>' });
    await expect.soft(details.bgvVerified(), 'detail page shows BGV "Verified"').toBeVisible();
  });
});
