import { Locator, Page, expect } from '@playwright/test';
import { AddStaffDialog } from './AddStaffDialog';

/** The numbers on the summary cards above the staff list. */
export interface StaffCounts {
  total: number;
  kycPending: number;
  kycCompleted: number;
}

/** The staff listing - the landing page after vendor login. */
export class StaffListPage {
  constructor(private readonly page: Page) {}

  // Locators
  private searchBox = () => this.page.getByRole('textbox', { name: 'search' });
  private searchButton = () => this.page.getByRole('button', { name: 'Search' });
  addStaffButton = (): Locator => this.page.getByRole('button', { name: 'Add Staff', exact: true });

  /** Amazon vendors land on the EV page after login, so reach Staff through the header tab. */
  async openFromNav(): Promise<void> {
    await this.page.getByText('Staff', { exact: true }).first().click();
    await this.page.waitForURL(/\/staff/);
    await expect(this.addStaffButton()).toBeVisible();
  }

  async goto(): Promise<void> {
    await this.page.goto('/staff');
    await expect(this.addStaffButton()).toBeVisible();
  }

  /**
   * Picks a branch from the org menu in the header. A fresh login has no org
   * loaded, so Add Staff asks for MOT and hubs with `undefined` and gets
   * nothing back - choosing the branch loads it.
   */
  async switchBranch(branch: string): Promise<void> {
    // Right after login the header can ignore a click, or the popup can close
    // without switching - so wait for the page, and check each step worked.
    // Wait on the header's org name, not Add Staff - Amazon vendors land on
    // the EV page, which has no Add Staff button.
    const orgMenu = this.page.getByText(branch.slice(0, 15)).first();
    await expect(orgMenu).toBeVisible();
    await this.page.waitForLoadState('networkidle');
    const switcher = this.page.getByRole('dialog').filter({ hasText: 'Switch Branches' });
    // The popup opens empty and fills from /orgs/all - wait for the entry.
    const entry = switcher.getByText(branch, { exact: true });

    for (let attempt = 1; ; attempt++) {
      await expect(async () => {
        if (!(await switcher.isVisible())) await orgMenu.click();
        await expect(entry).toBeVisible({ timeout: 3_000 });
      }).toPass({ timeout: 20_000 });
      // Listen before clicking - under SLOW_MO the PUT can finish before a
      // listener added after the click is attached.
      const switched = this.page
        .waitForResponse(r => r.request().method() === 'PUT' && /\/orgs\/\d+$/.test(r.url()), {
          timeout: 15_000,
        })
        .then(() => true, () => false);
      await entry.click();
      const ok = await switched;
      await expect(switcher).toBeHidden();
      if (ok) return;
      if (attempt === 2) throw new Error(`Switching to branch "${branch}" never reached the server.`);
    }
  }

  async openAddStaff(): Promise<AddStaffDialog> {
    await this.addStaffButton().click();
    const dialog = new AddStaffDialog(this.page);
    await expect(dialog.root).toBeVisible();
    return dialog;
  }

  /**
   * The summary cards hide their numbers behind a "Show Count" button; one
   * click loads all three from /org/staff/all/count/v2. Reload the page to
   * get fresh numbers - the cards do not refresh after a staff is added.
   */
  async showCounts(): Promise<StaffCounts> {
    const loaded = this.page.waitForResponse(
      r => r.request().method() === 'POST' && /\/org\/staff\/all\/count\/v2/.test(r.url()),
    );
    await this.page.getByRole('button', { name: 'Show Count' }).first().click();
    await loaded;
    await expect(this.page.getByRole('button', { name: 'Show Count' })).toHaveCount(0);
    return {
      total: await this.countOn('Total Staffs'),
      kycPending: await this.countOn('KYC Pending'),
      kycCompleted: await this.countOn('KYC Completed'),
    };
  }

  /** Each card is a label paragraph followed by its number. */
  private async countOn(card: string): Promise<number> {
    const value = this.cardLabel(card).locator('xpath=following-sibling::p[1]');
    await expect(value).toHaveText(/^\d+$/);
    return Number(await value.textContent());
  }

  private cardLabel = (card: string) => this.page.locator('p').filter({ hasText: new RegExp(`^${card}$`) }).first();

  /** The KYC Pending card doubles as a tab: clicking it filters the list. */
  async openKycPendingTab(): Promise<void> {
    const filtered = this.page.waitForResponse(
      r => /\/org\/staff\/all\/v2$/.test(r.url()) && /"filterStatus":"KYC PENDING"/.test(r.request().postData() ?? ''),
    );
    await this.cardLabel('KYC Pending').click();
    await filtered;
  }

  async search(term: string): Promise<void> {
    await this.searchBox().fill(term);
    await this.searchButton().click();
  }

  /** Staff rows are paragraphs in the listing, not a real table. */
  rowFor(staffName: string): Locator {
    return this.page.getByRole('navigation').getByText(staffName, { exact: true });
  }
}
