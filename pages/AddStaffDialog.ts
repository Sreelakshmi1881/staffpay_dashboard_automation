import { Locator, Page, expect } from '@playwright/test';
import { AmazonStaffData, StaffData } from '../utils/testData';

/**
 * What a server-backed dropdown renders when it has nothing to offer. Each
 * one words it differently - "No Data Found", "No hub found", "No Roll Codes
 * Found" - so match the shape rather than listing them.
 */
const EMPTY_OPTION = /^No\s.+\sfound$/i;

/** How long to let a dropdown's options arrive before believing it is empty. */
const OPTIONS_TIMEOUT_MS = 8_000;

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

  /** Opens a MUI select and returns its option list, which renders in a
   *  page-level portal rather than inside the dialog. */
  private async openOptions(selectName: string): Promise<Locator> {
    await this.select(selectName).click();
    const list = this.page.getByRole('listbox');
    await expect(list).toBeVisible();
    await this.waitForOptionsToArrive(list);
    return list;
  }

  /**
   * These dropdowns fetch their contents when opened, and render the empty
   * placeholder in the meantime - so an empty menu may simply not have
   * loaded yet. Give it a moment before taking it at face value, otherwise a
   * slow staging response reads as "no options" and fails the wrong thing.
   */
  private async waitForOptionsToArrive(list: Locator): Promise<void> {
    await expect(async () => {
      expect(await this.renderedOptions(list)).not.toEqual([expect.stringMatching(EMPTY_OPTION)]);
    })
      .toPass({ timeout: OPTIONS_TIMEOUT_MS, intervals: [200, 300, 500, 1000] })
      .catch(() => undefined); // genuinely empty - the caller reports it
  }

  private async renderedOptions(list: Locator): Promise<string[]> {
    return (await list.getByRole('option').allTextContents()).map((o) => o.trim());
  }

  /** Picks an option from a MUI select. */
  private async choose(selectName: string, option: string): Promise<void> {
    const list = await this.openOptions(selectName);

    const rendered = await this.renderedOptions(list);
    if (rendered.length === 1 && EMPTY_OPTION.test(rendered[0])) {
      throw new Error(`"${selectName}" has no options to pick from (showed "${rendered[0]}").`);
    }

    await list.getByRole('option', { name: option, exact: true }).click();
    await expect(list).toBeHidden();
  }

  /** The options a MUI select currently offers - handy for asserting on
   *  dependent dropdowns that load their values from the server. */
  async optionsFor(selectName: string): Promise<string[]> {
    const list = await this.openOptions(selectName);
    const options = await this.renderedOptions(list);
    await this.page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    return options;
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

  async selectDateOfBirth(date: Date): Promise<void> {
    await this.selectDate('dateOfBirthEpochMillis', date);
  }

  /** Amazon asks for a joining date; Blue Dart does not show the field. */
  async selectDateOfJoining(date: Date): Promise<void> {
    await this.selectDate('joiningDateEpochMillis', date);
  }

  /**
   * Date fields are read-only inputs driven by a calendar widget, so the
   * date has to be clicked out: year list -> month arrows -> day cell.
   * The field swallows the first interaction while the dialog moves focus
   * around, so focus it before clicking or the calendar never opens.
   */
  private async selectDate(fieldName: string, date: Date): Promise<void> {
    const input = this.field(fieldName);
    const picker = this.page.locator('.MuiPickersModal-dialogRoot');
    // The first click is sometimes swallowed while the dialog moves focus
    // around - retry until the calendar is actually open.
    await expect(async () => {
      if (!(await picker.isVisible())) {
        await input.focus();
        await input.click();
      }
      await expect(picker).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    // The header button shows the year the calendar is on. When that is
    // already the target (e.g. a joining date of today), skip the year list -
    // the year then matches twice, the header and the list entry.
    const yearButton = picker.locator('button:has(h6)');
    const year = String(date.getFullYear());
    if ((await yearButton.textContent())?.trim() !== year) {
      await yearButton.click();
      await picker.getByRole('button', { name: year, exact: true }).click();
    }

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
    // Document Validated reveals these two, and both are required.
    await this.root.getByRole('checkbox', { name: /Aadhaar/ }).check();
    await this.root.getByRole('checkbox', { name: /PAN/ }).check();
  }

  /**
   * Amazon's Basic Info is shorter than Blue Dart's - no SCC, roll code or
   * uniform sizes - but asks for a joining date, vehicle number and the
   * rider's source. Work Info stays locked until the source is chosen.
   */
  async fillAmazonBasicInfo(staff: AmazonStaffData): Promise<void> {
    await this.field('name').fill(staff.name);
    await this.selectStaffType(staff.staffType);
    await this.field('contactNumber').fill(staff.contactNumber);
    await this.selectDateOfJoining(staff.dateOfJoining);
    await this.selectDateOfBirth(staff.dateOfBirth);
    await this.choose('vehicleTypeId', staff.vehicleType);
    // Appears once a vehicle type is chosen.
    await this.field('vehicleNumber').fill(staff.vehicleNumber);
    await this.choose('userCreationSource', staff.riderSource);
  }

  /**
   * Amazon's Work Info: business type -> business (the client) -> hub, then
   * shift and zone. Each choice reveals the next field.
   */
  async fillAmazonWorkInfo(staff: AmazonStaffData): Promise<void> {
    await this.openWorkInfo();
    await this.chooseByButton('Select Business Type*', staff.businessType);
    await this.chooseByButton('Select Business*', staff.business);
    // The Business select collapses into "Business Name: <business>" text; until
    // it has, it is still the first unlabelled select and would be opened instead
    // of Hub Name.
    await expect(this.root.getByText(new RegExp(`Business Name:\\s*${staff.business}`))).toBeVisible();
    await this.selectHub(staff.hubName);
    await this.selectShift(staff.shiftName);
    await this.selectZone(staff.zone);
  }

  /** Work Info selects are labelled by their placeholder rather than a name attribute. */
  private async chooseByButton(buttonName: string, option: string): Promise<void> {
    await this.root.getByRole('button', { name: buttonName, exact: true }).click();
    const list = this.page.getByRole('listbox');
    await expect(list).toBeVisible();
    await this.waitForOptionsToArrive(list);
    await list.getByRole('option', { name: option, exact: true }).click();
    await expect(list).toBeHidden();
  }

  /** Zones is a multi-select autocomplete; close it with Escape once picked. */
  async selectZone(zone: string): Promise<void> {
    const zones = this.root
      .getByRole('combobox')
      .filter({ has: this.page.getByRole('textbox', { name: 'Select Zones*' }) });
    await zones.getByRole('button', { name: 'Open' }).click();
    const list = this.page.getByRole('listbox');
    await expect(list).toBeVisible();
    await list.getByRole('option').filter({ hasText: zone }).first().click();
    await this.page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await expect(zones.getByRole('button', { name: zone })).toBeVisible();
  }

  async openWorkInfo(): Promise<void> {
    await this.workInfoTab().click();
    await expect(this.root.getByText('Add Hubs & Shifts')).toBeVisible();
  }

  async openBasicInfo(): Promise<void> {
    await this.basicInfoTab().click();
  }

  /** Hub is the only select on the Work Info tab until one is chosen. */
  private async openHubOptions(): Promise<Locator> {
    // The unlabelled Hub select - not the empty "Select Business Type" one
    // Amazon adds next to it.
    const hubSelect = this.root
      .locator('[role="tabpanel"]:not([hidden]) [role="button"]')
      .filter({ hasNotText: /Select Business Type/ })
      .first();
    const list = this.page.getByRole('listbox');
    // The click is sometimes swallowed - retry until the menu is open.
    await expect(async () => {
      if (!(await list.isVisible())) await hubSelect.click();
      await expect(list).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await this.waitForOptionsToArrive(list);
    return list;
  }

  /**
   * Staging sometimes renders the hub list without the hub we want even
   * though it is active - close the menu and reopen it a few times before
   * giving up, and then say which hubs were offered.
   */
  async selectHub(hubName: string): Promise<void> {
    let rendered: string[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const list = await this.openHubOptions();
      rendered = await this.renderedOptions(list);
      if (rendered.length === 1 && EMPTY_OPTION.test(rendered[0])) {
        throw new Error(`No hubs to pick from (showed "${rendered[0]}").`);
      }

      const option = list.getByRole('option', { name: hubName, exact: true });
      if (await option.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await option.click();
        await expect(list).toBeHidden();
        return;
      }
      await this.page.keyboard.press('Escape');
      await expect(list).toBeHidden();
    }
    throw new Error(`Hub "${hubName}" not offered after 3 tries. Offered: ${rendered.join(', ')}`);
  }

  /**
   * The shift picker appears once a hub is chosen, and allows several picks.
   * Dedicated-slot hubs (Amazon) label it "Rider will choose from rider app".
   */
  async selectShift(shiftName: string): Promise<void> {
    await this.root
      .getByRole('combobox')
      .filter({
        has: this.page.getByRole('textbox', { name: /^(Select Shift\*|Rider will choose from rider app)$/ }),
      })
      .getByRole('button', { name: 'Open' })
      .click();
    const list = this.page.getByRole('listbox');
    await expect(list).toBeVisible();
    await list.getByRole('option').filter({ has: this.page.getByText(shiftName, { exact: true }) }).click();
    await this.page.keyboard.press('Escape');
    await expect(list).toBeHidden();
  }

  async availableHubs(): Promise<string[]> {
    const list = await this.openHubOptions();
    const hubs = await this.renderedOptions(list);
    await this.page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    return hubs;
  }

  /**
   * Clicks Add Staff and waits for the create call itself. Staging can take
   * well over the default 5s to answer, and the API reports rejections in
   * the body with HTTP 200 - so fail with the server's message, not a vague
   * "dialog still visible". Returns that message (e.g. "SUCCESS", or Blue
   * Dart's "PENDING_REQUEST_APPROVAL — BDR-...").
   */
  async submit(timeoutMs = 60_000): Promise<string> {
    const created = this.page.waitForResponse(
      r => r.request().method() === 'POST' && /\/org\/staff\/$/.test(r.url()),
      { timeout: timeoutMs },
    );
    await this.submitButton().click();
    const response = await created;
    const text = await response.text();
    let body: { status?: { code?: number; message?: string } } | undefined;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Add Staff got a non-JSON reply (HTTP ${response.status()}): ${text.slice(0, 200) || '<empty>'}`);
    }
    const { code, message } = body?.status ?? {};
    if (code !== 200) throw new Error(`Add Staff was rejected (${code}): ${message}`);
    await expect(this.root).toBeHidden({ timeout: 15_000 });
    return message;
  }

  /**
   * Blue Dart: Add Staff does not create the staff, it raises an approval
   * request ("PENDING_REQUEST_APPROVAL — BDR-...") for BD OPS. Returns the ref.
   */
  async submitForApproval(): Promise<string> {
    const message = await this.submit();
    const ref = message.match(/BDR-[A-Z0-9]+/)?.[0];
    if (!ref) throw new Error(`Add Staff did not raise an approval request: "${message}"`);
    return ref;
  }

  async cancel(): Promise<void> {
    await this.cancelButton().click();
    await expect(this.root).toBeHidden();
  }
}
