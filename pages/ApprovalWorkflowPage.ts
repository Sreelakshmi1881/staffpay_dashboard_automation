import { Locator, Page, expect } from '@playwright/test';

export type AdditionType = 'New Addition' | 'Replacement';

/**
 * BD OPS "Approval Workflow" tab. Since staging started gating vendor-created
 * staff behind approval, a new staff is only an ONBOARDING request (BDR-...)
 * here until OPS approves it - same flow titanautomation drives through
 * POST /bluedart/approval-requests/{ref}/approve.
 */
export class ApprovalWorkflowPage {
  constructor(private readonly page: Page) {}

  private tab = () => this.page.getByRole('tab', { name: 'Approval Workflow' });
  // Labels carry a live count once loaded ("Pending 45"), so match the start.
  private statusFilter = (status: 'Pending' | 'Rejected' | 'Approved') =>
    this.page.getByRole('button', { name: new RegExp(`^${status}\\b`) });
  rowFor = (requestRef: string): Locator => this.page.getByRole('row').filter({ hasText: requestRef });
  private reviewDialog = (requestRef: string) => this.page.getByRole('dialog').filter({ hasText: requestRef });

  async open(): Promise<void> {
    // Right after the OPS login, Rider Management loads behind a full-page
    // spinner backdrop that swallows clicks - on a slow staging it can stay
    // up for well over the 15s action timeout, so keep trying for a minute.
    await expect(async () => {
      await this.tab().click({ timeout: 5_000 });
      await expect(this.tab()).toHaveAttribute('aria-selected', 'true', { timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
  }

  async showStatus(status: 'Pending' | 'Rejected' | 'Approved'): Promise<void> {
    await this.statusFilter(status).click();
  }

  /** Opens Review on the request, picks the addition type and approves it. */
  async approve(requestRef: string, additionType: AdditionType = 'New Addition'): Promise<void> {
    await this.showStatus('Pending');
    // The request row can land a moment after the vendor's create call returns.
    await expect(async () => {
      await this.page.getByRole('button', { name: 'Refresh' }).click();
      await expect(this.rowFor(requestRef)).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });

    await this.rowFor(requestRef).getByRole('button', { name: 'Review' }).click();
    const dialog = this.reviewDialog(requestRef);
    await expect(dialog).toBeVisible();

    await dialog.locator('[aria-haspopup="listbox"]').first().click();
    await this.page.getByRole('listbox').getByRole('option', { name: additionType, exact: true }).click();

    const approved = this.page.waitForResponse(
      r => r.request().method() === 'POST' && r.url().includes(`/approval-requests/${requestRef}/approve`),
    );
    await dialog.getByRole('button', { name: 'Approve & Submit' }).click();
    const body = await (await approved).json();
    // A 200 only says the call was accepted - the request itself must be APPROVED.
    expect(body.status?.code, `approve ${requestRef}: ${JSON.stringify(body.status)}`).toBe(200);
    expect(body.response?.status, `approve ${requestRef}`).toBe('APPROVED');
    await expect(dialog).toBeHidden();
  }
}
