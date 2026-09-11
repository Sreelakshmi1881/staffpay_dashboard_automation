import { Locator, Page, expect } from '@playwright/test';
import { StaffData } from '../utils/testData';

/** What a server-backed dropdown renders when it has nothing to offer. */
const EMPTY_OPTION = /^(No Data Found|No hub found)$/i;

/**
 * The "Add New Staff" dialog (Basic Info + Work Info tabs).
 *
 * Two things drive the locator strategy here:
 *  - Text inputs have no label association, but they do have stable `name`
 *    attributes, so we select on those.
 *  - Dropdowns are MUI selects rendered as `#mui-component-select-<name>`,
 *    and their options render in a portal *outside* the dialog - so option
 *    clicks are page-scoped, not dialog-scoped.
 */
export class AddStaffDialog {
  readonly root: Locator;

  constructor(private readonly page: Page) {
    this.root = page.getByRole('dialog').filter({ hasText: 'Add New Staff' });
  }

  // Locators
  private field = (name: string) => this.root.locator(`input[name="${name}"]`);
  private select = (name: string) => this.root.locator(`#mui-component-select-${name}`);
  private sccInput = () => this.root.getByRole('textbox', { name: /Service Centre Code/ });
  private basicInfoTab = () => this.root.getByRole('tab', { name: 'Basic Info' });
  private workInfoTab = () => this.root.getByRole('tab', { name: 'Work Info' });

  validationSummary = () => this.root.getByText(/^Please complete:/);
  submitButton = () => this.root.getByRole('button', { name: 'Add Staff' });
  cancelButton = () => this.root.getByRole('button', { name: 'Cancel' });

  /** Picks an option from a MUI select. Options live in a page-level portal. */
  private async choose(selectName: string, option: string): Promise<void> {
    await this.select(selectName).click();
    const list = this.page.getByRole('listbox');
    await expect(list).toBeVisible();

    // A server-backed dropdown that came back empty renders a single
    // placeholder row. Say so, rather than timing out on a missing option.
    const rendered = (await list.getByRole('option').allTextContents()).map((o) => o.trim());
    if (rendered.length === 1 && EMPTY_OPTION.test(rendered[0])) {
      throw new Error(`"${selectName}" has no options to pick from (showed "${rendered[0]}").`);
    }

    await list.getByRole('option', { name: option, exact: true }).click();
    await expect(list).toBeHidden();
  }

  /** The options a MUI select currently offers - handy for asserting on
   *  dependent dropdowns that load their values from the server. */
  async optionsFor(selectName: string): Promise<string[]> {
    await this.select(selectName).click();
    const list = this.page.getByRole('listbox');
    await expect(list).toBeVisible();
    const options = await list.getByRole('option').allTextContents();
    await this.page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    return options.map((o) => o.trim());
  }

  /** Staff Type gates the rest of the form: it loads the Roll Code options
   *  and decides whether MOT is asked for at all. */
  async selectStaffType(staffType: string): Promise<void> {
    await this.choose('staffTypeId', staffType);
  }

  async isFieldVisible(selectName: string): Promise<boolean> {
    return this.select(selectName).isVisible();
  }

  /** The Service Centre is an async autocomplete - type the code, then pick
   *  the single match it narrows down to. */
  async selectServiceCentre(code: string): Promise<void> {
    await this.sccInput().fill(code);
    const option = this.page.getByRole('option', { name: new RegExp(`^${code} - `) });
    await option.click();
    await expect(this.sccInput()).toHaveValue(new RegExp(`^${code} - `));
  }

  /**
   * Date of Birth is a read-only input driven by a calendar widget, so the
   * date has to be clicked out: year list -> month arrows -> day cell.
   * The field swallows the first interaction while the dialog moves focus
   * around, so focus it before clicking or the calendar never opens.
   */
  async selectDateOfBirth(date: Date): Promise<void> {
    const input = this.field('dateOfBirthEpochMillis');
    await input.focus();
    await input.click();

    const picker = this.page.locator('.MuiPickersModal-dialogRoot');
    await picker.locator('button:has(h6)').click();
    await picker.getByRole('button', { name: String(date.getFullYear()), exact: true }).click();

    const header = picker.locator('p').filter({ hasText: /^[A-Za-z]+ \d{4}$/ }).first();
    const target = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const previousMonth = header.locator('xpath=preceding::button[1]');
    const nextMonth = header.locator('xpath=following::button[1]');

    // The picker lands on the chosen year but keeps today's month, so step
    // either way rather than assuming a direction. The outgoing month stays
    // mounted mid-slide, so let each transition finish before the next click.
    for (let i = 0; i < 24; i++) {
      const current = (await header.textContent())?.trim();
      if (current === target) break;
      await (new Date(`1 ${current}`) > date ? previousMonth : nextMonth).click();
      await this.waitForCalendarSettled(picker);
    }
    await expect(header).toHaveText(target);
    await this.waitForCalendarSettled(picker);

    // `MuiPickersDay-hidden` marks the adjacent-month days padding the grid.
    await picker
      .locator('button.MuiPickersDay-day:not(.MuiPickersDay-hidden)')
      .filter({ hasText: new RegExp(`^${date.getDate()}$`) })
      .click();
    await picker.getByRole('button', { name: 'OK', exact: true }).click();

    await expect(picker).toBeHidden();
    await expect(input).not.toHaveValue('');
  }

  /** Only one month grid may be mounted, or day cells match twice over. */
  private async waitForCalendarSettled(picker: Locator): Promise<void> {
    await expect(picker.locator('[class*="MuiPickersSlideTransition-slideExit"]')).toHaveCount(0);
  }

  /**
   * Fills the Basic Info tab. Field order matters: Staff Type is what makes
   * Roll Code and MOT appear, so it has to be set before either.
   */
  async fillBasicInfo(staff: StaffData): Promise<void> {
    await this.field('name').fill(staff.name);
    await this.selectStaffType(staff.staffType);
    await this.field('contactNumber').fill(staff.contactNumber);
    await this.selectDateOfBirth(staff.dateOfBirth);
    await this.choose('gender', staff.gender);
    await this.selectServiceCentre(staff.serviceCentreCode);
    await this.choose('employeeMode', staff.employeeMode);
    await this.choose('rollCode', staff.rollCode);
    await this.choose('vehicleTypeId', staff.mot);
    await this.choose('educationalQualification', staff.educationalQualification);
    await this.field('emailId').fill(staff.emailId);
    await this.choose('shirtSize', staff.shirtSize);
    await this.choose('trouserSize', staff.trouserSize);
    await this.choose('shoeSize', staff.shoeSize);
    await this.root.getByRole('checkbox', { name: /Interview Taken/ }).check();
    await this.root.getByRole('checkbox', { name: /Document Validated/ }).check();
  }

  async openWorkInfo(): Promise<void> {
    await this.workInfoTab().click();
    await expect(this.root.getByText('Add Hubs & Shifts')).toBeVisible();
  }

  async openBasicInfo(): Promise<void> {
    await this.basicInfoTab().click();
  }

  /** Hub is the only select on the Work Info tab until one is chosen. */
  async selectHub(hubName: string): Promise<void> {
    await this.root.locator('[role="tabpanel"]:not([hidden]) [role="button"]').first().click();
    const list = this.page.getByRole('listbox');
    await expect(list).toBeVisible();
    await list.getByRole('option', { name: hubName, exact: true }).click();
    await expect(list).toBeHidden();
  }

  async availableHubs(): Promise<string[]> {
    await this.root.locator('[role="tabpanel"]:not([hidden]) [role="button"]').first().click();
    const list = this.page.getByRole('listbox');
    await expect(list).toBeVisible();
    const hubs = await list.getByRole('option').allTextContents();
    await this.page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    return hubs.map((h) => h.trim());
  }

  async submit(): Promise<void> {
    await this.submitButton().click();
  }

  async cancel(): Promise<void> {
    await this.cancelButton().click();
    await expect(this.root).toBeHidden();
  }
}
