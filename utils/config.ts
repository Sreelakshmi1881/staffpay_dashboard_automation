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
   * The Aadhaar / PAN numbers on the KYC identity's documents (KYC_IDENTITY in
   * testData.ts). Both required. Set them in .env (gitignored); never commit,
   * log or report them.
   */
  kycTestNumbers: {
    aadhaar: process.env.AADHAAR_TEST_NUMBER ?? '',
    pan: process.env.PAN_TEST_NUMBER ?? '',
  },

  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    database: process.env.DB_NAME ?? 'titan',
  },
};
