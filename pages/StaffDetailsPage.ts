import { Locator, Page, expect } from '@playwright/test';

/** A staff's detail page (/staff/details/<user id>), opened from the staff list. */
export class StaffDetailsPage {
  constructor(private readonly page: Page) {}

  // Locators
  verifyKycButton = (): Locator => this.page.getByText('Verify KYC', { exact: true });
  name = (name: string): Locator => this.page.getByText(name, { exact: true }).first();
  kycStatus = (status: string): Locator => this.page.getByText(status, { exact: true }).first();
  /**
   * One part of the line under the name - "| <staff unique id> | <phone> |
   * <vehicle> | DOB : ...". Each part is its own element.
   */
  summaryPart = (text: string): Locator => this.page.getByText(text).first();

  /**
   * The picture under "Selfie" - the rider-app KYC selfie. Only loads when the
   * page is opened from the staff list: going to /staff/details/<id> directly
   * makes the page ask for /org/staff/undefined/kyc and the section stays "-".
   */
  selfieImage = (imageLink: string): Locator => this.page.locator(`img[src="${imageLink}"]`);

  /** Previews shown in the KYC section once a document image is uploaded. */
  uploadedPreviews = (): Locator => this.page.getByRole('img', { name: 'uploaded-url' });

  /**
   * Uploads the Aadhaar front/back and PAN images in the KYC section.
   * Each box is a hidden <input type=file> (Aadhaar front, Aadhaar back, PAN
   * in page order) that disappears once its file is in, so fill from the last
   * one backwards to keep the indexes stable. The page uploads each file to
   * the restricted KYC bucket (GET /orgs/presigned-urls?flowType=KYC, then PUT).
   * This only uploads - nothing reaches entity_documents until Save (Aadhaar)
   * / Update (PAN), which need a document number.
   * Returns the S3 links, keyed by document.
   */
  async uploadKycDocuments(files: { aadhaarFront: string; aadhaarBack: string; pan: string }): Promise<Record<string, string>> {
    const inputs = this.page.locator('input[type=file]');
    await expect(inputs).toHaveCount(3);
    // The selfie uses the same "uploaded-url" preview, so count from here.
    const previewsBefore = await this.uploadedPreviews().count();
    const links: Record<string, string> = {};
    for (const [index, key] of [[2, 'pan'], [1, 'aadhaarBack'], [0, 'aadhaarFront']] as const) {
      const uploaded = this.page.waitForResponse(
        r => r.request().method() === 'PUT' && /earn-de-docs-restricted\.s3/.test(r.url()),
      );
      await inputs.nth(index).setInputFiles(files[key]);
      const response = await uploaded;
      expect(response.status(), `S3 upload of ${key}`).toBe(200);
      links[key] = response.url().split('?')[0];
    }
    await expect(this.uploadedPreviews()).toHaveCount(previewsBefore + 3);
    await expect(inputs).toHaveCount(0);
    return links;
  }

  /**
   * A KYC card (Aadhaar / Pan Card): the block holding the number label and
   * its action button. Innermost match, so the textbox is that card's own.
   */
  private kycCard = (numberLabel: string, actionButton: string): Locator =>
    this.page
      .locator('div')
      .filter({ has: this.page.getByText(numberLabel) })
      .filter({ has: this.page.getByRole('button', { name: actionButton, exact: true }) })
      .last();

  aadhaarCard = (): Locator => this.kycCard('Enter Aadhaar Number', 'Save');
  panCard = (): Locator => this.kycCard('Enter Pan Card Number', 'Update');

  /** Types the Aadhaar number and clicks Save - this creates the AADHAR row in entity_documents. */
  async saveAadhaarNumber(aadhaarNumber: string): Promise<void> {
    await this.enterNumberAndSubmit(this.aadhaarCard(), aadhaarNumber, 'Save');
  }

  /** Types the PAN and clicks Update - this creates the PANCARD row in entity_documents. */
  async savePanNumber(panNumber: string): Promise<void> {
    await this.enterNumberAndSubmit(this.panCard(), panNumber, 'Update');
  }

  /**
   * Save / Update stay disabled until a number is typed. Wait for the write
   * the button triggers and fail with the server's message - the API reports
   * errors as HTTP 200 with status.code in the body. Never logs the number.
   */
  private async enterNumberAndSubmit(card: Locator, value: string, buttonName: string): Promise<void> {
    const input = card.getByRole('textbox').first();
    const button = card.getByRole('button', { name: buttonName, exact: true });
    // Saving the Aadhaar reloads the KYC section; a number typed while that
    // reload is still landing (easy under SLOW_MO) is wiped and the button
    // stays disabled. Type it again until it sticks.
    await expect(async () => {
      if ((await input.inputValue()) !== value) await input.fill(value);
      await expect(input).toHaveValue(value, { timeout: 2_000 });
      await expect(button).toBeEnabled({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await this.submit(button, buttonName);
  }

  private async submit(button: Locator, buttonName: string): Promise<void> {
    await expect(button, `${buttonName} button`).toBeEnabled();
    const saved = this.page
      .waitForResponse(
        r => /api-staging\.staffpay\.in/.test(r.url()) && ['POST', 'PUT'].includes(r.request().method()),
        { timeout: 30_000 },
      )
      .catch(() => {
        throw new Error(`${buttonName} was clicked but the page sent no save request within 30s`);
      });
    await button.click();
    const response = await saved;
    const body = await response.json().catch(() => undefined);
    expect(response.ok(), `${buttonName}: HTTP ${response.status()}`).toBe(true);
    expect(body?.status?.code, `${buttonName}: ${body?.status?.message}`).toBe(200);
  }

  /**
   * Re-uploads the PAN image. Saving the Aadhaar number reloads the KYC
   * section, which drops an unsaved PAN number and image - the PAN box is
   * then the only (last) file input left. Returns the S3 link.
   */
  async uploadPanImage(file: string): Promise<string> {
    const uploaded = this.page.waitForResponse(
      r => r.request().method() === 'PUT' && /earn-de-docs-restricted\.s3/.test(r.url()),
    );
    await this.page.locator('input[type=file]').last().setInputFiles(file);
    const response = await uploaded;
    expect(response.status(), 'S3 upload of pan').toBe(200);
    return response.url().split('?')[0];
  }

  approveButton = (card: Locator): Locator => card.getByRole('button', { name: 'Approve', exact: true });

  /** Clicks Approve on a KYC card and waits for the write it triggers. */
  async approve(card: Locator): Promise<void> {
    await this.submit(this.approveButton(card), 'Approve');
  }

  /**
   * The Pan Card's "Initiate" button. Despite the name it calls
   * /dl/verification/existing/user (a DL check) - it does not start BGV.
   */
  initiateButton = (): Locator => this.panCard().getByRole('button', { name: 'Initiate', exact: true });

  async initiateBgv(): Promise<void> {
    await this.submit(this.initiateButton(), 'Initiate');
  }

  retriggerBgvButton = (): Locator => this.page.getByRole('button', { name: 'Retrigger BGV', exact: true });

  /**
   * "Retrigger BGV" -> address -> "Initiate BGV". Saving Aadhaar + PAN starts
   * BGV at once, but a rider whose Aadhaar has no address (any rider whose
   * Aadhaar is typed in on the vendor portal) comes straight back
   * Insufficient without reaching AuthBridge. Supplying the address here sends
   * it on - the dashboard form of titanautomation's
   * triggerManualBgvWithAddress (POST /org/staff/bgv/manual/trigger).
   */
  async retriggerBgvWithAddress(address: string): Promise<void> {
    await this.retriggerBgvButton().scrollIntoViewIfNeeded();
    await this.retriggerBgvButton().click();
    const dialog = this.page.getByRole('dialog').filter({ hasText: 'Retrigger Background Verification' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox').fill(address);
    await this.submit(dialog.getByRole('button', { name: 'Initiate BGV', exact: true }), 'Initiate BGV');
    await expect(dialog).toBeHidden();
  }

  /**
   * BGV on the detail page. The timeline labels don't say "BGV": an initiated
   * check reads "Background Verification Initiated"; AuthBridge's Final + Clear
   * adds "Verified" (also the Pan Card's badge once dl_case_check is VERIFIED).
   */
  bgvInitiated = (): Locator => this.page.getByText('Background Verification Initiated', { exact: true }).first();
  bgvVerified = (): Locator => this.page.getByText('Verified', { exact: true }).first();

  /** Waits for the page of this user to load. */
  async waitForUser(userId: number | string): Promise<void> {
    await this.page.waitForURL(new RegExp(`/staff/details/${userId}$`));
    await expect(this.verifyKycButton()).toBeVisible();
  }
}
