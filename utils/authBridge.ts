import { APIRequestContext, Page, expect } from '@playwright/test';
import type { CourtCaseResult } from './riderApi';

const BASE_URL = 'https://api-staging.staffpay.in';

/**
 * The logged-in vendor's authtoken, read off a request the dashboard itself
 * makes (it sends `authtoken` on every API call). Reloads the page to trigger
 * one. No rider-app login needed.
 */
export async function vendorAuthToken(page: Page): Promise<string> {
  const request = page.waitForRequest(r => /api-staging\.staffpay\.in/.test(r.url()) && !!r.headers()['authtoken']);
  await page.reload();
  return (await request).headers()['authtoken'];
}

/**
 * Plays AuthBridge reporting a BGV court-case result: POST
 * /webhook/authbridge/courtcase with the case's uniqueID / requestId from
 * rider_court_case_check. Clear / Discrepant / Attention Required are final;
 * Insufficient is interim (State Interim, check severity empty). Attention
 * Required reports its single check as Clear. Never use a token from a pasted curl.
 */
export async function reportCourtCaseResult(
  request: APIRequestContext,
  authToken: string,
  caseIds: { uniqueId: string; requestId: string },
  result: CourtCaseResult,
): Promise<void> {
  const interim = result === 'Insufficient';
  const response = await request.post(`${BASE_URL}/webhook/authbridge/courtcase`, {
    headers: { 'Content-Type': 'application/json', authtoken: authToken },
    data: {
      uniqueID: caseIds.uniqueId,
      requestId: caseIds.requestId,
      caseStatus: 'Complete',
      State: interim ? 'Interim' : 'Final',
      caseSeverity: result,
      checks: [
        {
          checkName: 'India Criminal Litigation Database Check',
          checkID: 'CHK-001',
          severity: interim ? '' : result === 'Attention Required' ? 'Clear' : result,
          disposition: '',
          status: 'Completed',
          comments: null,
        },
      ],
    },
  });
  expect(response.ok(), `court case webhook: HTTP ${response.status()}`).toBe(true);
  const body = await response.json();
  expect(body?.status?.code, `court case webhook: ${body?.status?.message}`).toBe(200);
}
