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
    await this.page.getByText(branch.slice(0, 15)).first().click();
    const switcher = this.page.getByRole('dialog').filter({ hasText: 'Switch Branches' });
    // Listen before clicking - under SLOW_MO the PUT can finish before a
    // listener added after the click is attached.
    const switched = this.page.waitForResponse(
      r => r.request().method() === 'PUT' && /\/orgs\/\d+$/.test(r.url()),
    );
    await switcher.getByText(branch, { exact: true }).click();
    await switched;
    await expect(switcher).toBeHidden();
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
