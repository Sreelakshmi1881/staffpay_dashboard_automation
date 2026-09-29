import { test, expect } from '@playwright/test';
import { StaffListPage } from '../pages/StaffListPage';
import { AddStaffDialog } from '../pages/AddStaffDialog';
import { allureSuite } from '../utils/allureSuite';
import { buildStaff } from '../utils/testData';

allureSuite(test, 'AddStaff');

let staffList: StaffListPage;
let dialog: AddStaffDialog;

test.beforeEach(async ({ page }) => {
  staffList = new StaffListPage(page);
  await staffList.goto();
  dialog = await staffList.openAddStaff();
});

test('Verify that the Add Staff dialog opens on the Basic Info tab with a Work Info tab available', async () => {
  await expect(dialog.root.getByRole('tab', { name: 'Basic Info' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(dialog.root.getByRole('tab', { name: 'Work Info' })).toBeVisible();
});

test('Verify that on an empty Add Staff form the Add Staff button stays disabled and every required field is listed', async () => {
  await expect(dialog.submitButton()).toBeDisabled();
  await expect(dialog.validationSummary()).toContainText('Staff Name is required');
  await expect(dialog.validationSummary()).toContainText('Phone Number is required');
  await expect(dialog.validationSummary()).toContainText(
    'At least one shift timing must be selected on WorkInfo Tab',
  );
});

test('Verify that the Roll Code field appears and loads options only after a Staff Type is chosen', async () => {
  const staff = buildStaff();

  expect(await dialog.isFieldVisible('rollCode')).toBe(false);
  await expect(dialog.validationSummary()).toContainText('Roll Code is required');

  await dialog.selectStaffType(staff.staffType);

  expect(await dialog.isFieldVisible('rollCode')).toBe(true);
  expect(await dialog.optionsFor('rollCode')).toContain(staff.rollCode);
});

test('Verify that the MOT field is shown for Delivery Staff and hidden for In House Staff', async () => {
  await dialog.selectStaffType('In House Staff');
  expect(await dialog.isFieldVisible('vehicleTypeId')).toBe(false);

  await dialog.selectStaffType('Delivery Staff');
  expect(await dialog.isFieldVisible('vehicleTypeId')).toBe(true);
});

test('Verify that Cancel closes the Add Staff dialog without adding a staff', async () => {
  await dialog.cancel();
  await expect(staffList.addStaffButton()).toBeVisible();
});

/**
 * MOT and hubs only load once a branch is picked from the header's org menu -
 * a fresh login asks for them with `undefined`. auth.setup.ts picks the branch
 * before saving the session.
 */
test('Verify that the MOT dropdown loads its options, including Driver-Delivery Boy, for Delivery Staff', async () => {
  const staff = buildStaff();
  await dialog.selectStaffType(staff.staffType);

  expect(await dialog.optionsFor('vehicleTypeId')).toContain(staff.mot);
});

test('Verify that the Hub dropdown on the Work Info tab loads the branch hubs', async () => {
  await dialog.openWorkInfo();

  expect(await dialog.availableHubs()).not.toEqual(['No hub found']);
});
