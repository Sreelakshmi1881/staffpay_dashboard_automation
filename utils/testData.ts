/** Shape of one Add-Staff form submission. */
export interface StaffData {
  name: string;
  staffType: string;
  contactNumber: string;
  dateOfBirth: Date;
  gender: string;
  serviceCentreCode: string;
  employeeMode: string;
  rollCode: string;
  mot: string;
  educationalQualification: string;
  emailId: string;
  shirtSize: string;
  trouserSize: string;
  shoeSize: string;
  hubName: string;
}

/**
 * Phone number and email have to be unique per run or the API rejects the
 * staff as a duplicate, so both are seeded from the clock.
 */
export function buildStaff(overrides: Partial<StaffData> = {}): StaffData {
  const seed = String(Date.now()).slice(-7);

  return {
    name: `QA Auto ${seed}`,
    staffType: 'Delivery Staff',
    contactNumber: `9${seed}${seed.slice(0, 2)}`.slice(0, 10),
    dateOfBirth: new Date(1995, 0, 15),
    gender: 'Male',
    serviceCentreCode: 'AAG',
    employeeMode: 'MPC',
    rollCode: 'Delivery - All Products',
    mot: 'Driver-Delivery Boy',
    educationalQualification: '12th Pass (Higher Secondary / PUC)',
    emailId: `qa.auto.${seed}@example.com`,
    shirtSize: 'L',
    trouserSize: '32',
    shoeSize: '9',
    hubName: '',
    ...overrides,
  };
}
