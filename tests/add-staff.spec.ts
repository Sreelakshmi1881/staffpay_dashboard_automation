import { test, expect } from '@playwright/test';
import { StaffListPage } from '../pages/StaffListPage';
import { AddStaffDialog } from '../pages/AddStaffDialog';
import { buildStaff } from '../utils/testData';

let staffList: StaffListPage;
let dialog: AddStaffDialog;

test.beforeEach(async ({ page }) => {
  staffList = new StaffListPage(page);
  await staffList.goto();
  dialog = await staffList.openAddStaff();
});

test('add staff dialog opens on the Basic Info tab', async () => {
  await expect(dialog.root.getByRole('tab', { name: 'Basic Info' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(dialog.root.getByRole('tab', { name: 'Work Info' })).toBeVisible();
});

test('submit stays disabled and lists every required field when the form is empty', async () => {
  await expect(dialog.submitButton()).toBeDisabled();
  await expect(dialog.validationSummary()).toContainText('Staff Name is required');
  await expect(dialog.validationSummary()).toContainText('Phone Number is required');
  await expect(dialog.validationSummary()).toContainText(
    'At least one shift timing must be selected on WorkInfo Tab',
  );
});

test('Roll Code options load once a Staff Type is chosen', async () => {
  const staff = buildStaff();

  expect(await dialog.isFieldVisible('rollCode')).toBe(false);
  await expect(dialog.validationSummary()).toContainText('Roll Code is required');

  await dialog.selectStaffType(staff.staffType);

  expect(await dialog.isFieldVisible('rollCode')).toBe(true);
  expect(await dialog.optionsFor('rollCode')).toContain(staff.rollCode);
});

test('MOT is asked for delivery staff only', async () => {
  await dialog.selectStaffType('In House Staff');
  expect(await dialog.isFieldVisible('vehicleTypeId')).toBe(false);

  await dialog.selectStaffType('Delivery Staff');
  expect(await dialog.isFieldVisible('vehicleTypeId')).toBe(true);
});

test('cancel closes the dialog without adding anyone', async () => {
  await dialog.cancel();
  await expect(staffList.addStaffButton()).toBeVisible();
});

/**
 * BUG (staging): the app requests MOT and hubs with a literal `undefined`
 * customer id - GET /common/vehicleTypesv2/undefined and
 * POST /org/hubs/list/undefined/all/v2 both return 400. The same calls with
 * the real customer id (221) return data, so this is a front-end defect.
 * Both fields are mandatory, which makes the whole flow unsubmittable.
 */
test('MOT options load for delivery staff', async () => {
  const staff = buildStaff();
  await dialog.selectStaffType(staff.staffType);

  expect(await dialog.optionsFor('vehicleTypeId')).toContain(staff.mot);
});

test('hubs load on the Work Info tab', async () => {
  await dialog.openWorkInfo();

  expect(await dialog.availableHubs()).not.toEqual(['No hub found']);
});

test('a delivery staff can be added end to end', async () => {
  const staff = buildStaff();

  await dialog.fillBasicInfo(staff);
  await dialog.openWorkInfo();
  await dialog.selectHub(staff.hubName);

  await expect(dialog.validationSummary()).toBeHidden();
  await expect(dialog.submitButton()).toBeEnabled();
  await dialog.submit();

  await expect(dialog.root).toBeHidden();
  await staffList.search(staff.contactNumber);
  await expect(staffList.rowFor(staff.name)).toBeVisible();
});
