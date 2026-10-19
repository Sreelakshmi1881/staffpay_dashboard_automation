import * as dotenv from 'dotenv';
dotenv.config();

/** Test data and environment values - the config.properties equivalent. */
export const config = {
  vendorNumber: process.env.VENDOR_NUMBER ?? '9519519514',
  opsNumber: process.env.OPS_NUMBER ?? '2288777001',
  branch: process.env.BRANCH ?? 'Bluedart_Onboarding',

  /** Amazon Now vendor - org "Amazon Tez Bangalore". No consent screen on login. */
  amazon: {
    vendorNumber: process.env.AMAZON_VENDOR_NUMBER ?? '9843996388',
    branch: process.env.AMAZON_BRANCH ?? 'Amazon Tez Bangalore',
  },

  /**
   * Staging KYC test numbers from the backend team - never a real person's
   * ID. Set them in .env (gitignored); never commit, log or report them.
   * AADHAAR_TEST_NUMBER is required; PAN_TEST_NUMBER is optional (a PAN is
   * generated per run when unset - see buildKycNumbers).
   */
  kycTestNumbers: {
    aadhaar: process.env.AADHAAR_TEST_NUMBER ?? '',
    pan: process.env.PAN_TEST_NUMBER ?? '',
  },

  /**
   * Steps that log in as the rider through the rider-app API (profile picture,
   * KYC selfie). Off by default: this is dashboard automation, and staging's
   * rider-app login now refuses scripted logins ("Please update the Rider app").
   * RIDER_APP_STEPS=true turns them back on.
   */
  riderAppSteps: process.env.RIDER_APP_STEPS === 'true',

  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    database: process.env.DB_NAME ?? 'titan',
  },
};
