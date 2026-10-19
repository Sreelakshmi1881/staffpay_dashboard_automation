import { Page, expect } from '@playwright/test';
import { getStaffPayOtp } from '../utils/db';
import { withLoginLock } from '../utils/loginLock';

/** All login-screen locators live here - if the UI changes, only this file does. */
export class LoginPage {
  constructor(private readonly page: Page) {}

  // Locators
  private mobileInput = () => this.page.getByRole('textbox');
  private getOtpButton = () => this.page.getByRole('button', { name: 'Get OTP', exact: true });
  private firstOtpBox = () => this.page.getByRole('textbox', { name: 'Please enter verification' });
  private loginButton = () => this.page.getByRole('button', { name: 'Login' });
  private consentHeading = () => this.page.getByText('Terms & conditions');
  private consentCheckbox = () => this.page.getByRole('checkbox', { name: 'I acknowledge that I have' });
  private proceedButton = () => this.page.getByRole('button', { name: 'Proceed' });

  // Actions
  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  async requestOtp(contactNumber: string): Promise<void> {
    await this.mobileInput().fill(contactNumber);
    await this.getOtpButton().click();
  }

  /** Reads the OTP from staging and submits it. Typing into the first box lets
   *  the component advance focus, so this works for 4 or 6 digits. */
  async submitOtp(contactNumber: string): Promise<void> {
    const otp = await getStaffPayOtp(contactNumber);
    await this.firstOtpBox().click();
    await this.page.keyboard.type(otp);
    await this.loginButton().click();
  }

  /** Blue Dart vendors get this on every login. */
  async acceptConsent(): Promise<void> {
    await expect(this.consentHeading()).toBeVisible();
    await this.consentCheckbox().check();
    await this.proceedButton().click();
  }

  /**
   * Held under a lock so parallel tests never request OTPs for one number at once.
   * Only Blue Dart vendors are shown the consent screen - pass `consent: false`
   * for other orgs (Amazon lands straight on the dashboard).
   */
  async login(contactNumber: string, { consent = true }: { consent?: boolean } = {}): Promise<void> {
    await withLoginLock(contactNumber, async () => {
      await this.goto();
      await this.requestOtp(contactNumber);
      await this.submitOtp(contactNumber);
      if (consent) await this.acceptConsent();
    });
  }

  /** BD OPS: no consent screen, and it lands on Rider Management. */
  async loginAsOps(contactNumber: string): Promise<void> {
    await withLoginLock(contactNumber, async () => {
      await this.goto();
      await this.requestOtp(contactNumber);
      await this.submitOtp(contactNumber);
      await this.page.waitForURL(/\/rider-management/);
    });
  }

  /** The session lives in localStorage, so clearing it is a full log out. */
  async logout(): Promise<void> {
    await this.page.evaluate(() => localStorage.clear());
    await this.page.context().clearCookies();
    await this.goto();
    await expect(this.getOtpButton()).toBeVisible();
  }
}
