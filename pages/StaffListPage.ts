import { Locator, Page, expect } from '@playwright/test';
import { AddStaffDialog } from './AddStaffDialog';

/** The staff listing - the landing page after vendor login. */
export class StaffListPage {
  constructor(private readonly page: Page) {}

  // Locators
  private searchBox = () => this.page.getByRole('textbox', { name: 'search' });
  private searchButton = () => this.page.getByRole('button', { name: 'Search' });
  addStaffButton = (): Locator => this.page.getByRole('button', { name: 'Add Staff', exact: true });

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
    await expect(this.addStaffButton()).toBeVisible();
    await this.page.waitForLoadState('networkidle');
    const switcher = this.page.getByRole('dialog').filter({ hasText: 'Switch Branches' });
    // The popup opens empty and fills from /orgs/all - wait for the entry.
    const entry = switcher.getByText(branch, { exact: true });

    for (let attempt = 1; ; attempt++) {
      await expect(async () => {
        if (!(await switcher.isVisible())) await this.page.getByText(branch.slice(0, 15)).first().click();
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

  async search(term: string): Promise<void> {
    await this.searchBox().fill(term);
    await this.searchButton().click();
  }

  /** Staff rows are paragraphs in the listing, not a real table. */
  rowFor(staffName: string): Locator {
    return this.page.getByRole('navigation').getByText(staffName, { exact: true });
  }
}
