import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { StaffListPage } from '../pages/StaffListPage';
import { StaffDetailsPage } from '../pages/StaffDetailsPage';
import { allureSuite } from '../utils/allureSuite';
import { config } from '../utils/config';
import { getStaffRecord, getUserDocument, releaseTestKycNumbers } from '../utils/db';
import { acquireKycNumbersLock, releaseKycNumbersLock } from '../utils/loginLock';
import { RiderApi } from '../utils/riderApi';
import { buildAmazonStaff, buildKycNumbers, KYC_IDENTITY, SAMPLE_KYC_DOCUMENTS } from '../utils/testData';

allureSuite(test, 'AmazonStaffCreation');

/**
 * Happy path with one consistent identity (KYC_IDENTITY): the Amazon vendor
 * creates the rider with the identity's name and DOB, the rider's KYC selfie is
 * uploaded through the rider-app API as test data (token from
 * /auth/generate-token, as titanautomation's TitanAPI.generateToken), then the
 * vendor opens the rider, uploads the identity's Aadhaar (front, back) and PAN
 * images and saves the Aadhaar number.
 *
 * Deliberately stops BEFORE the PAN Update: Aadhaar + PAN saved together start
 * a BGV, and a Retrigger BGV reaches AuthBridge, which is charged. No Update,
 * Initiate or Retrigger BGV here. The rider's documents are left in place
 * afterwards so they can be checked on the dashboard.
 */
test.beforeAll(async () => {
  test.setTimeout(16 * 60_000); // may wait for another KYC test to finish
  await acquireKycNumbersLock();
  const { aadhaar, pan } = buildKycNumbers();
  // An earlier rider still holding the identity's numbers would make the save a duplicate.
  console.info(`KYC numbers freed before the test: ${JSON.stringify(await releaseTestKycNumbers([aadhaar, pan]))}`);
});
test.afterAll(() => releaseKycNumbersLock());

test(`Verify that an Amazon vendor can create ${KYC_IDENTITY.name}, the rider's selfie is uploaded, and the vendor can upload the Aadhaar and PAN images and save the Aadhaar - without starting BGV`, async ({ page, request }) => {
  const staff = buildAmazonStaff();
  const numbers = buildKycNumbers();
  const staffList = new StaffListPage(page);
  const details = new StaffDetailsPage(page);
  let userId = 0;
  const snap = async (name: string) =>
    test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

  await test.step('Vendor logs in and opens Staff in Amazon Tez Bangalore', async () => {
    await new LoginPage(page).login(config.amazon.vendorNumber, { consent: false });
    await staffList.switchBranch(config.amazon.branch);
    await staffList.openFromNav();
    await snap('01 staff list');
  });

  await test.step(`Vendor adds ${staff.name}`, async () => {
    const dialog = await staffList.openAddStaff();
    await dialog.fillAmazonBasicInfo(staff);
    await snap('02 add staff - basic info');
    await dialog.fillAmazonWorkInfo(staff);
    await snap('03 add staff - work info');
    await dialog.submit();

    const record = await getStaffRecord(staff.contactNumber);
    expect(record, `no users row for ${staff.contactNumber}`).toBeDefined();
    expect(record).toMatchObject({ name: staff.name, status: 'APPROVED', isActive: 1 });
    userId = record!.userId;
    test.info().annotations.push({ type: 'Created staff', description: `${staff.name} | ${staff.contactNumber} | user_id ${userId}` });
  });

  await test.step('The rider uploads the KYC selfie through the rider-app API', async () => {
    const rider = new RiderApi(request);
    await rider.useGeneratedToken(userId, staff.contactNumber);
    const selfieLink = await rider.uploadImage(KYC_IDENTITY.selfie);
    await rider.uploadKycSelfie(selfieLink);
    const selfie = await getUserDocument(userId, 'SELFIE');
    test.info().annotations.push({
      type: 'Selfie row',
      description: selfie ? `entity_documents.id ${selfie.id}, ${selfie.approvalStatus}` : 'none',
    });
    expect(selfie, `no SELFIE row in entity_documents for user ${userId}`).toBeDefined();
  });

  await test.step('Vendor opens the rider, uploads the Aadhaar (front, back) and PAN images, and saves the Aadhaar', async () => {
    await staffList.search(staff.contactNumber);
    await snap('04 search result');
    await staffList.rowFor(staff.name).click();
    await details.waitForUser(userId);
    await snap('05 detail page with selfie');

    await details.uploadKycDocuments(SAMPLE_KYC_DOCUMENTS);
    await snap('06 aadhaar and pan images uploaded');

    await details.saveAadhaarNumber(numbers.aadhaar);
    await page.waitForTimeout(3_000);
    await snap('07 aadhaar saved - pan not updated');
    const aadhaar = await getUserDocument(userId, 'AADHAR');
    test.info().annotations.push({
      type: 'Aadhaar row',
      description: aadhaar ? `entity_documents.id ${aadhaar.id}, ${aadhaar.approvalStatus}, active ${aadhaar.isActive}` : 'none',
    });
    expect(aadhaar, 'AADHAR row after Save').toBeDefined();
    // DUPLICATE_REJECTED ("Documents are linked to another user") means another
    // rider outside this suite still holds the identity's Aadhaar - free it first.
    expect(aadhaar!.approvalStatus, 'AADHAR approval_status after Save').toBe('APPROVED');
  });

  await test.step('Nothing has started a BGV', async () => {
    // PAN not updated, so no PANCARD row and no BGV.
    const record = await getStaffRecord(staff.contactNumber);
    expect(record?.bgvStatus, 'user_info.bgv_status').toBeNull();
    expect(await getUserDocument(userId, 'PANCARD', undefined, 1_000), 'PANCARD row').toBeUndefined();
  });
});
