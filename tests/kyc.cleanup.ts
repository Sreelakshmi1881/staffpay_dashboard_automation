import { test, expect } from '@playwright/test';
import { allureSuite } from '../utils/allureSuite';
import { deactivateAllTestRiderKycDocuments } from '../utils/db';

allureSuite(test, 'Cleanup');

/**
 * Run on its own with `npm run cleanup:kyc` - not part of the normal suite.
 * The Amazon KYC test cleans up its own rider after every run; use this when
 * a run was interrupted before that, or Aadhaar / PAN come back
 * DUPLICATE_REJECTED ("Documents are linked to another user").
 */
test('Deactivate the Aadhaar and PAN documents of all test riders (numbers starting 421)', async () => {
  // Only via npm run cleanup:kyc - never as part of a full `npm test`, where it
  // could deactivate documents while the Amazon KYC test is using them.
  test.skip(process.env.RUN_KYC_CLEANUP !== 'true', 'run with: npm run cleanup:kyc');
  const changed = await deactivateAllTestRiderKycDocuments();
  console.info(`KYC cleanup: is_active = 0 on ${changed.AADHAR} AADHAR and ${changed.PANCARD} PANCARD row(s)`);
  test.info().annotations.push({ type: 'Rows deactivated', description: JSON.stringify(changed) });
  expect(Object.keys(changed)).toEqual(['AADHAR', 'PANCARD']);
});
