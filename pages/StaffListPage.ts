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
