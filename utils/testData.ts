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
 * Amazon staff are named "Auto QA amzuser <3 random digits>" and get a
 * 10-digit number starting 421. The name suffix is only for reading the
 * list; the phone is what must be unique, so its last 7 digits come from
 * the clock. Defaults match a staff created by hand in the dashboard.
 */
export function buildAmazonStaff(overrides: Partial<AmazonStaffData> = {}): AmazonStaffData {
  const contactNumber = `421${String(Date.now()).slice(-7)}`;

  return {
    name: `Auto QA amzuser ${Math.floor(100 + Math.random() * 900)}`,
    staffType: 'Delivery Boy',
    contactNumber,
    dateOfJoining: new Date(),
    dateOfBirth: new Date(1995, 0, 15),
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

/**
 * Profile picture the test rider uploads: a generated placeholder (grey and
 * purple shapes), not anyone's photo. Never use a real rider's picture.
 */
export const TEST_PROFILE_IMAGE_FILE = process.env.PROFILE_IMAGE ?? 'test-assets/qa-test-profile.png';

/**
 * The Aadhaar / PAN numbers typed into the vendor portal's KYC cards.
 *
 * Aadhaar: the team's fixed staging test number (AADHAAR_TEST_NUMBER in .env,
 * gitignored - never committed, logged or reported). Like titanautomation's
 * Amazon BGV tests, every run reuses that one test identity: staging checks the
 * Aadhaar checksum ("Please enter valid Aadhar number"), so a made-up number
 * cannot be saved. A number held by one rider is DUPLICATE_REJECTED for the next
 * and a Discrepant verdict blacklists it, so the tests take the KYC numbers lock
 * and free it before and after (see useKycTestNumbers).
 *
 * PAN: PAN_TEST_NUMBER from .env if set (freed like the Aadhaar), otherwise
 * generated per run - 4th letter E, a holder type that does not exist, so it
 * can never be a real person's PAN. As of 2026-10-19 staging answers the
 * vendor portal's PAN Update with "SUCCESS" but stores no PANCARD row for
 * either the old team test PAN or a generated one (generated ones were still
 * stored on 2026-10-08) - it appears to drop PANs that fail verification, so a
 * PAN that passes staging's check is needed from the backend team.
 */
export function buildKycNumbers(): { aadhaar: string; pan: string } {
  const aadhaar = config.kycTestNumbers.aadhaar;
  if (!aadhaar) {
    throw new Error(
      'Set AADHAAR_TEST_NUMBER in .env to the staging test Aadhaar from the backend team ' +
        "(never a real person's ID).",
    );
  }
  return { aadhaar, pan: config.kycTestNumbers.pan || fakePan() };
}

function fakePan(): string {
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
  const letters = (n: number) =>
    Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
  return `${letters(3)}E${letters(1)}${digits(4)}${letters(1)}`;
}

/**
 * KYC document images: generated samples marked "SAMPLE - TEST ONLY" with
 * made-up names and masked numbers. Never use real Aadhaar / PAN images.
 */
export const SAMPLE_KYC_DOCUMENTS = {
  aadhaarFront: process.env.AADHAAR_FRONT_IMAGE ?? 'test-assets/sample-aadhaar-front.png',
  aadhaarBack: process.env.AADHAAR_BACK_IMAGE ?? 'test-assets/sample-aadhaar-back.png',
  pan: process.env.PAN_IMAGE ?? 'test-assets/sample-pan.png',
};

/**
 * Selfie the test rider uploads for KYC: the placeholder, unless a run is
 * pointed at a real face explicitly with SELFIE_IMAGE=<path>. Nothing is
 * picked up from disk automatically - a real face must be one its owner has
 * agreed to, and chosen on purpose for that run. Never commit one.
 */
export const TEST_SELFIE_IMAGE_FILE = process.env.SELFIE_IMAGE ?? TEST_PROFILE_IMAGE_FILE;

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
