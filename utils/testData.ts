import type { RiderProfile } from './riderApi';
import { config } from './config';
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
  shiftName: string;
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
    // Same hub and shift (11:17 - 23:17) as the QA BD BGV staff.
    hubName: 'tEst BD hub',
    shiftName: 'TEST SHIft',
    ...overrides,
  };
}

/** Shape of one Amazon Now Add-Staff submission (org Amazon Tez Bangalore). */
export interface AmazonStaffData {
  name: string;
  staffType: string;
  contactNumber: string;
  dateOfJoining: Date;
  dateOfBirth: Date;
  vehicleType: string;
  vehicleNumber: string;
  riderSource: string;
  businessType: string;
  business: string;
  hubName: string;
  shiftName: string;
  zone: string;
}

/**
 * The one KYC test identity every Amazon rider is created as - like
 * titanautomation, where one person's details, selfie and documents always go
 * together so face match and name/DOB checks line up. The Aadhaar / PAN
 * numbers on these documents live in .env (AADHAAR_TEST_NUMBER /
 * PAN_TEST_NUMBER), not here.
 */
export const KYC_IDENTITY = {
  name: 'Somesh Mallick',
  dateOfBirth: new Date(1976, 0, 5), // 05/01/1976, as on his Aadhaar and PAN
  selfie: 'test-assets/Somesh_profile.png',
  documents: {
    aadhaarFront: 'test-assets/Somesh_adhaarFront.png',
    aadhaarBack: 'test-assets/Somesh_adhaarBack.png',
    pan: 'test-assets/Somesh_pan.png',
  },
};

/**
 * Amazon staff are created as KYC_IDENTITY (name and DOB) and get a 10-digit
 * number starting 421 - not a real mobile range, and what marks a rider as
 * this suite's for the cleanup. The phone is what must be unique, so its last
 * 7 digits come from the clock. Defaults match a staff created by hand.
 */
export function buildAmazonStaff(overrides: Partial<AmazonStaffData> = {}): AmazonStaffData {
  const contactNumber = `421${String(Date.now()).slice(-7)}`;

  return {
    name: KYC_IDENTITY.name,
    staffType: 'Delivery Boy',
    contactNumber,
    dateOfJoining: new Date(),
    dateOfBirth: KYC_IDENTITY.dateOfBirth,
    vehicleType: 'Bike',
    // Bike is BIKE_AMZ, which requires a vehicle number; manual runs reuse the phone.
    vehicleNumber: contactNumber,
    riderSource: 'Referral',
    businessType: 'FOOD',
    business: 'Amazon',
    hubName: 'TBI1_AMZ HSR Store',
    shiftName: 'TEST Full Day',
    zone: 'Koramangala and HSR',
    ...overrides,
  };
}

/** Profile picture the rider uploads (rider-app API): the identity's photo. */
export const TEST_PROFILE_IMAGE_FILE = process.env.PROFILE_IMAGE ?? KYC_IDENTITY.selfie;

/**
 * The Aadhaar / PAN numbers typed into the vendor portal's KYC cards: those on
 * KYC_IDENTITY's documents, from AADHAAR_TEST_NUMBER / PAN_TEST_NUMBER in .env
 * (gitignored - not committed, logged or reported). Every run reuses the same
 * identity, as titanautomation does: a number held by one rider is
 * DUPLICATE_REJECTED for the next and a Discrepant verdict blacklists it, so the
 * tests take the KYC numbers lock and free them before and after (see
 * useKycTestNumbers). Staging checks both: a made-up Aadhaar fails its checksum
 * and a PAN that fails verification is silently dropped.
 */
export function buildKycNumbers(): { aadhaar: string; pan: string } {
  const { aadhaar, pan } = config.kycTestNumbers;
  if (!aadhaar || !pan) {
    throw new Error(`Set AADHAAR_TEST_NUMBER and PAN_TEST_NUMBER in .env to the numbers on ${KYC_IDENTITY.name}'s Aadhaar and PAN.`);
  }
  return { aadhaar, pan };
}

/**
 * Address typed into "Retrigger BGV" for a rider whose Aadhaar has none.
 * Nothing downstream checks it against the rider - a test address is enough.
 */
export const TEST_BGV_ADDRESS = 'No 42, QA Test Street, HSR Layout, Bengaluru, Karnataka, 560102';

/** KYC document images uploaded on the vendor portal: KYC_IDENTITY's own. */
export const SAMPLE_KYC_DOCUMENTS = {
  aadhaarFront: process.env.AADHAAR_FRONT_IMAGE ?? KYC_IDENTITY.documents.aadhaarFront,
  aadhaarBack: process.env.AADHAAR_BACK_IMAGE ?? KYC_IDENTITY.documents.aadhaarBack,
  pan: process.env.PAN_IMAGE ?? KYC_IDENTITY.documents.pan,
};

/** KYC selfie the rider uploads (rider-app API): the identity's photo. */
export const TEST_SELFIE_IMAGE_FILE = process.env.SELFIE_IMAGE ?? KYC_IDENTITY.selfie;

/**
 * What the new rider fills on the rider app's profile screen. All test values.
 * `s3ProfileLink` is the link RiderApi.uploadImage() returned.
 */
export function buildRiderProfile(staff: AmazonStaffData, s3ProfileLink: string): RiderProfile {
  return {
    name: staff.name,
    contactNumber: staff.contactNumber,
    dob: staff.dateOfBirth
      .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      .replace(/ /g, '-'),
    s3ProfileLink,
    address: 'QA test address, HSR Layout, Bangalore',
    pincode: '560102',
    emergencyContactName: 'QA Auto contact',
    // 421 prefix like the rider numbers - not a real Indian mobile range.
    emergencyContactNumber: `421${staff.contactNumber.slice(-7)}`.replace(/.$/, d => String((Number(d) + 1) % 10)),
  };
}
