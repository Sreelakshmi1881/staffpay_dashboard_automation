---
name: staffpay-automation
description: How the StaffPay vendor dashboard UI automation (Playwright + TypeScript) is built, run and extended - login via DB OTP, branch switch, Add Staff flows for Amazon Now (Amazon Tez Bangalore) and Blue Dart (with BD OPS approval), DB checks on users/user_info, DB secrets, Allure reports and recordings. Use when adding, running, debugging or reviewing tests in this repo.
---

# StaffPay dashboard automation

> **Status (2026-10-19):** both flows run. **Blue Dart**: vendor-created staff
> go through a BD OPS approval, which the Staff Creation journey does in the
> dashboard (see "Blue Dart flow"). **Amazon Now** (org *Amazon Tez Bangalore*):
> staff creation passes; the KYC / BGV journeys stop at the PAN step because
> staging stores no PAN from the vendor portal's Update (see "Amazon KYC test
> numbers").

Playwright + TypeScript UI tests for the StaffPay **vendor dashboard** on staging
(`https://staging.staffpay.in`). Everything goes through the UI; the API is not
used to set up or create data. Staff creation through the API exists in the Java
suite (titanautomation) - that is a different thing and not what this repo tests.

## Layout

```
pages/                    Page objects - all locators live here
  LoginPage.ts            phone -> Get OTP -> OTP from DB -> Login -> T&C consent
  StaffListPage.ts        /staff listing, switchBranch(), openFromNav(), showCounts(), openKycPendingTab(), openAddStaff(), search()
  StaffDetailsPage.ts     /staff/details/<user id> - opened by clicking a staff row
  AddStaffDialog.ts       "Add New Staff" dialog: Basic Info + Work Info tabs; submit() returns the server message,
                          submitForApproval() the Blue Dart BDR- ref
  ApprovalWorkflowPage.ts BD OPS "Approval Workflow" tab: Review -> Addition type -> Approve & Submit
tests/
  auth.setup.ts           logs in once, switches branch, saves .auth/vendor.json
  login.spec.ts           fresh login (starts logged out)
  add-staff.spec.ts       form checks, reuse the saved session
  create-amazon-staff.e2e.spec.ts  Amazon: login -> branch -> Staff tab -> add staff -> list -> DB check
  create-staff.e2e.spec.ts  Blue Dart: vendor adds staff -> OPS approves -> vendor finds staff
  explore.spec.ts         scratch; skipped unless run with --debug
utils/
  config.ts               vendor number, branch, DB host/port/name (env-overridable)
  db.ts                   MySQL pool + getStaffPayOtp(number, timeout, 'STAFFPAY'|'RIDERAPP') and getStaffRecord() (both poll up to 15s)
  riderApi.ts             RiderApi: rider-app login (OTP) + fullProfile/save - acts as the new rider
  secretStore.ts          DB username/password lookup (see "DB credentials")
  testData.ts             buildAmazonStaff() / buildStaff() (Blue Dart) - unique phone per run
  loginLock.ts            one OTP login at a time across workers
  recordingsReporter.ts   copies videos to reports/recordings/<run time>/
```

## Test projects (playwright.config.ts)

| Project    | Runs                         | Session                          | Depends on |
|------------|------------------------------|----------------------------------|------------|
| `setup`    | `*.setup.ts`                 | logs in, writes `.auth/vendor.json` | -       |
| `chromium` | everything except `*.e2e.spec.ts` | reuses `.auth/vendor.json`   | `setup`    |
| `Staff Creation` | `*.e2e.spec.ts`         | starts logged out, logs in itself | -          |

`Staff Creation` has no dependencies on purpose: running
`tests/create-staff.e2e.spec.ts` (from the CLI or the VS Code play button) runs
only that one journey in one browser. It gets a 90s timeout (180s with SLOW_MO).

Two logins for the same number at once would each request an OTP and one would
read the other's and fail. `LoginPage.login` holds a lock (`utils/loginLock.ts`,
a directory in the OS temp folder) so parallel logins take turns.

`chromium` depends on `setup`, and dependency projects ignore CLI filters, so
`-g` on a chromium test still runs the setup login first.

## Running

Prerequisites:
- `npm install`
- **SSH tunnel to staging MySQL on `127.0.0.1:3306`** - login reads the OTP
  from the `titan` DB. Tunnel down -> `ECONNREFUSED 127.0.0.1:3306` in setup and
  every dependent test is skipped.
- DB credentials available (see below).
- Don't log in with the test vendor number in your own browser during a run -
  it can consume the OTP.

| Command | What it does |
|---|---|
| `npm test` | Full suite, headless |
| `npm run test:watch` | Headed, one window, `SLOW_MO=600` so you can follow along |
| `npm run test:amazon-staff-creation` | Only the Amazon create-staff journey, headed + slow |
| `npm run test:staff-creation` | The Blue Dart journey (vendor adds -> OPS approves -> vendor finds), headed + slow |
| `npm run test:amazon` | All Amazon journeys, one worker, then builds the Allure report (keeps the test exit code) |
| `npm run test:no-auth` | `chromium` project only, reusing the saved session instead of logging in again (`login.spec.ts` still needs the tunnel) |
| `npx playwright test -g "<name>"` | One test by name |
| `npx playwright test -g "<name>" --debug` | Step through with the inspector |
| `npm run test:amazon-bgv-discrepant` | Only the negative BGV (Discrepant) journey, headed + slow |
| `npm run test:amazon-bgv-insufficient` | Only the Insufficient BGV journey, headed + slow |
| `npm run test:amazon-bgv-attention-required` | Only the Attention Required BGV journey, headed + slow |
| `npm run cleanup:kyc` | Deactivate Aadhaar / PAN rows of all Auto QA test riders |
| `npm run allure` | Generate + open the Allure report of the last run |
| `npm run report` | Open Playwright's HTML report |

`SLOW_MO` raises the per-test timeout from 30s to 120s automatically.

## Reports and recordings

Everything a run produces goes under `reports/` (gitignored):

```
reports/
  allure-results/     raw Allure data - cleared before every npm test script (pre* hooks)
  allure-report/      generated by `npm run allure` / `npm run allure:generate`
  html-report/        Playwright HTML report
  recordings/<YYYY-MM-DD_HH-MM-SS>/<project>__<test>__<status>.webm   kept across runs
  test-output/        Playwright's raw output (wiped each run)
```

Video is recorded for every test (`video: 'on'`), screenshots on failure. The
Allure report has the video attached to each test as well. Allure CLI needs
Java; `allure` is installed via Homebrew.

## DB credentials

`utils/secretStore.ts` mirrors titanautomation's `SecretStore.java` so both
suites share one source. Per key (`titan_username`, `titan_password`), first hit wins:

1. environment variable of the same name
2. `~/.titanautomation-secrets.json` (chmod 600, outside the repo) - how local runs work
3. AWS Secrets Manager `secret/application/titanautomation-staging` in `ap-south-1`

Human AWS users are explicitly denied that secret by `LSN-Human-Baseline`, so on a
laptop you need the local file. Jenkins nodes (the rider-app-automation job) read it
through their instance role. `.env` only needs `DB_HOST`/`DB_PORT`/`DB_NAME` if
they differ from the defaults - never put credentials in the repo.

## Amazon Now flow (active)

Vendor **`9843996388`**, branch **Amazon Tez Bangalore** (org id
162002152849268) - both in `config.amazon`, overridable with
`AMAZON_VENDOR_NUMBER` / `AMAZON_BRANCH`. Test: `tests/create-amazon-staff.e2e.spec.ts`.

Journey, as done by hand:

1. Log in with OTP. **No Terms & conditions screen** for Amazon, so call
   `login(number, { consent: false })`. Login lands on **`/ev-sp`**, not `/staff`.
2. Click the org name top-left ("Amazon Tez Bang...") -> Switch Branches ->
   **Amazon Tez Bangalore** (`StaffListPage.switchBranch`, waits for PUT `/orgs/<id>`).
3. Click the **Staff** tab in the header (`StaffListPage.openFromNav`).
4. **Add Staff** -> Basic Info (`AddStaffDialog.fillAmazonBasicInfo`):

   | Field | Value | API field in `POST /org/staff/` |
   |---|---|---|
   | Staff Name | `Auto QA amzuser <3 random digits>` | name |
   | Staff Type | Delivery Boy (other option: Security) | staffType 1 |
   | Phone Number | 10 digits starting **421** (last 7 from the clock) | contactNumber |
   | Date of Join | today - required; empty shows "Invalid date format" | joiningDateEpochMillis |
   | Date of Birth | 15 Jan 1995 | dateOfBirthEpochMillis |
   | Vehicle Type | Bike (BIKE_AMZ, vehicle number mandatory) | vehicleTypeId 18 |
   | Vehicle Number | same as phone (appears after Vehicle Type) | vehicleNumber |
   | Source | Referral | userCreationSourceId 33 |

   Selfie / Track & Trace / Geofence checkboxes are pre-ticked - leave them.
   **Work Info is locked until Source is chosen** (a "Source of Delivery Boy"
   popup blocks the dialog otherwise).
5. Work Info (`fillAmazonWorkInfo`) - each choice reveals the next field:

   | Field | Value | API field |
   |---|---|---|
   | Select Business Type | FOOD (also ECOM, STORE) | - |
   | Select Business | Amazon (the client) | - |
   | Hub Name (unlabelled select) | **TBI1_AMZ HSR Store** (Dedicated Slot) | hubId 1048 |
   | Shift ("Rider will choose from rider app") | **TEST Full Day** 18:00-23:59 - optional for dedicated-slot hubs, picked to match manual runs | shiftTimingIds [1719] |
   | Select Zones* | **Koramangala and HSR** - required | zoneId [16866] |

   Salary Info defaults (Workbasis) are fine - not touched.
   **Before adding**, click **Show Count** on the summary cards and note
   Total Staffs and KYC Pending (`StaffListPage.showCounts`).
6. Submit (waits for `POST /org/staff/`).
7. **DB check** (`getStaffRecord`, joins users + user_info + hubs +
   vehicle_types + staff_types). Also: contact_number, staff_type 1,
   salary_type 4 (Workbasis), selfie / track & trace / geofence = 1,
   doj = today (IST), bgv_status NULL before KYC:
   - `titan.users`: `status = 'APPROVED'`, `is_active = 1`, name matches.
     `is_active` is BIT(1) - mysql2 returns a Buffer, read byte 0.
   - `titan.user_info` (on `user_id`): hub = TBI1_AMZ HSR Store, vehicle type
     Bike, vehicle number = phone, staff type Delivery Boy, `staff_unique_id` set.
   - user org id == hub org id.
   - The test adds a **"Created staff"** annotation (name, phone, user_id,
     staff_unique_id) to the Playwright/Allure report.

7b. **Rider saves a profile picture (rider-app API)** - `RiderApi`:
   `GET /auth/sendOtp/<phone>?source=RiderApp&paramType=installParams` ->
   OTP from `otp_details` with **`event_type = 'RIDERAPP'`** -> `POST /auth/login`
   (`loginFrom: RiderApp`, `referenceId` from sendOtp) -> `response.token` ->
   **upload** (`RiderApi.uploadImage`): `GET /orgs/presigned-urls?fileName=&fileType=png&contentType=image/png`
   (rider `authtoken`) -> `response.presignedUrl` -> `PUT` the file there with only
   `Content-Type` -> image link = presignedUrl without the query string (server
   picks the key, e.g. `earn-de-docs.s3.../1790861171476_4d200e6bb5d3.png`) ->
   `POST /de/user/fullProfile/save` with `authtoken` + `userid` headers and
   name, dob (`15-Jan-1995`), `s3ProfileLink`, address, pincode, emergency contact.
   DB: `users.s3_profile_link` = the link; `user_info.address / pincode /
   emergency_contact_*` = what was sent; the link answers 200 image/png. Login
   follows titanautomation's `SelfieUploadAPI`. The image is
   `test-assets/qa-test-profile.png` (`TEST_PROFILE_IMAGE_FILE`), a generated
   placeholder - **never a real rider's picture, never a token from a pasted curl.**
   OTP lookup: staging updates the OTP row in place on resend, so take the newest
   non-validated row - don't filter on "id newer than before".
   **KYC selfie (what the vendor portal shows under "Selfie"):** upload a
   *second* image - `TEST_SELFIE_IMAGE_FILE`: the placeholder unless
   `SELFIE_IMAGE=<path>` is set for that run (only a face whose owner agreed;
   `test-assets/private/` is gitignored for such files, nothing there is
   picked up automatically) - then `RiderApi.uploadKycSelfie(link)` -> `POST /de/user/kyc`
   step `SELFIE_UPLOAD` (body as titanautomation `fixtures/titan/selfie_upload.json`).
   DB check (`getUserDocument(userId, 'SELFIE', 'PENDING_APPROVAL')`):
   - `titan.entity_documents` row: `entity_type = 'USER'`, `entity_id = users.id`,
     `doc_type = 'SELFIE'`, `is_active = 1`, `auto_kyc_broker = 'HYPERVERGE'`.
     **fullProfile/save creates it** (`CREATED`, `doc_link` = profile picture);
     the KYC selfie moves it to **`PENDING_APPROVAL`** and leaves `doc_link` alone.
   - `users.s3_profile_link` is overwritten with the **selfie** link.
   - History is in `entity_document_logs` (by `entity_document_id`).
   - Re-sending the profile picture's link as the selfie leaves the row at
     `CREATED` - the selfie must be its own upload.
   Portal: the detail page shows `<img src="<selfie link>">` under Selfie
   (`StaffDetailsPage.selfieImage`). **Open the detail page from the staff list** -
   going to `/staff/details/<id>` directly calls `/org/staff/undefined/kyc`
   and every KYC section shows "-".
8. **Counts went up:** reload `/staff` (the cards don't refresh themselves),
   Show Count again - Total Staffs and KYC Pending must both be higher. Asserted
   as "greater than", not "+1", because staging is shared; in practice it's +1.
9. **KYC Pending tab:** click the KYC Pending card - it filters the list
   (`filterStatus: "KYC PENDING"` on `/org/staff/all/v2`). Search the phone ->
   the new staff row appears.
10. **Detail page:** click the row -> `/staff/details/<users.id>`. Check the
    name, "KYC Pending", the staff_unique_id, the phone and the selfie image. Each part of the
    `| <staff_unique_id> | <phone> | BIKE_AMZ | DOB : ...` line is its own element.

11. **Sample Aadhaar / PAN upload** on the detail page
    (`StaffDetailsPage.uploadKycDocuments(SAMPLE_KYC_DOCUMENTS)`): three hidden
    `<input type=file>` (Aadhaar front, Aadhaar back, PAN, in page order) that
    disappear once filled - fill from the last backwards. The page uploads to the
    **restricted** bucket: `GET /orgs/presigned-urls?...&flowType=KYC` -> PUT to
    `earn-de-docs-restricted`. Check: each PUT is 200 and 3 more
    `img[alt=uploaded-url]` previews appear (the selfie uses the same alt).
    **Nothing reaches entity_documents yet** - that needs the number + Save
    (Aadhaar) / Update (PAN), which wait for staging test numbers from the
    backend team. Images are `test-assets/sample-*.png`, generated "SAMPLE - TEST
    ONLY" cards; never real ID images or numbers.

12. **KYC test** (2nd test in the file, `describe.configure({ mode: 'serial' })`,
    works on the rider test 1 created via module-level `created`): log in, open
    the rider from the list, upload the 3 samples, type the Aadhaar number ->
    **Save**, re-upload PAN (Aadhaar Save reloads the section and drops the
    unsaved PAN image/number) -> type PAN -> **Update**, then **Approve** both.
    Save/Update stay disabled with files only - a number is required. Writes go
    to `POST /org/staff/<id>/kyc`. Numbers: `buildKycNumbers()` - see "Amazon KYC
    test numbers" below. Soft assertions.
    **Fails on staging today (bugs, 2026-10-07):** Aadhaar Save -> `AADHAR`
    row straight to `APPROVED` ("Manually Verified"), `doc_link` null, later
    `reject_reason = 'Face Match Failed'` while still APPROVED; Approve stays
    disabled. PAN Update -> API says SUCCESS but no `PANCARD` row. No DOB /
    Father's Name fields exist for this org (those are Blue Dart).
    **Setup / cleanup:** every KYC file calls `useKycTestNumbers()`
    (tests/support/bgvJourney.ts) - see "Amazon KYC test numbers".
    **BGV** (same KYC test, after Approve): approved Aadhaar + PAN start the
    background verification. Checks, INITIATED stage: `entity_documents`
    PANCARD `dl_case_check = 'INITIATED'`; `rider_court_case_check` row
    (`entity_type='USER'`, `entity_value=users.id`) `case_status='WorkInProgress'`;
    `user_info.bgv_status='INITIATED'`; UI timeline "Background Verification
    Initiated". Then `RiderApi.completeCourtCase()` plays AuthBridge:
    `POST /webhook/authbridge/courtcase` {uniqueID, requestId (from that row),
    caseStatus Complete, State Final, caseSeverity Clear, checks[...]} with the
    **rider's own authtoken** (no token -> 401 "Token not found"). VERIFIED
    stage: court case Complete/Final/Clear, `dl_case_check='VERIFIED'`,
    `bgv_status='VERIFIED'`, UI shows "Verified". The cleanup must run after
    this - an inactive PAN row is not updated to VERIFIED. Org-level
    `/bgv-tracking` page exists for some orgs ("BGV Tracking" tab).
    **Negative BGV test** (`tests/amazon-bgv-discrepant.e2e.spec.ts`,
    `npm run test:amazon-bgv-discrepant`): new rider -> profile + selfie ->
    Aadhaar/PAN saved -> Initiate (PAN card button; only enabled while
    dl_case_check is empty / INITIATION_FAILED - the PAN Update normally starts
    BGV itself, so it's usually disabled) -> INITIATED checks -> webhook with
    `caseSeverity: 'Discrepant'` (`completeCourtCase(ids, 'Discrepant')`).
    After Discrepant: `users.status = 'REJECTED'` (is_active stays 1),
    `user_info.bgv_status = 'FAILED'`, court case Complete/Discrepant/Final,
    AADHAR + PANCARD `approval_status = 'REJECTED'`, `dl_case_check = 'FAILED'`,
    UI "Discrepancy" + "Manually Rejected".
    **Discrepant blacklists the documents** (`entity_documents.is_blacklisted
    = 1`, reject_reason "Blacklisted document"): any later rider saving the same
    numbers is REJECTED at once. Its afterAll therefore also clears
    is_blacklisted (`deactivateTestRiderDocuments(.., { unblacklist: true })`).
    Staging only accepts known test Aadhaar numbers ("Please enter valid Aadhar
    number" for others, even checksum-failing look-alikes) - use the .env ones.
    **Insufficient test** (`tests/amazon-bgv-insufficient.e2e.spec.ts`,
    `npm run test:amazon-bgv-insufficient`): same journey, then the webhook
    with `caseStatus Complete, State Interim, caseSeverity Insufficient`,
    check severity "" (`completeCourtCase(ids, 'Insufficient')`). Expected
    (from staging data + UI code, not yet seen end-to-end): court case
    Complete/Insufficient/Interim, `bgv_status` and PAN `dl_case_check`
    'Insufficient', rider + documents stay APPROVED, nothing blacklisted, UI
    "Insufficient". The test records the observed values before asserting.
    **Attention Required test** (`tests/amazon-bgv-attention-required.e2e.spec.ts`,
    `npm run test:amazon-bgv-attention-required`): webhook `Complete / Final /
    caseSeverity "Attention Required"`, check severity Clear. Dashboard: BGV
    Tracking bucket ATTENTION_REQUIRED with an "Override" button. Staging's two
    older cases disagree (hand-edited), so the test asserts the court case
    (Complete / Attention Required / Final), bgv_status no longer INITIATED and
    the UI label, and records users / user_info / documents for review.
    Severities covered: Clear (flow 1), Discrepant, Insufficient, Attention Required.
    Shared steps for the negative tests: `tests/support/bgvJourney.ts`
    (`createRiderWithBgvInitiated`, `reportCourtCase`, `reopenRider`).
    **BGV needs a PAN staging accepts.** With made-up PANs, Update returns
    SUCCESS but no PANCARD row is saved - `kyc_error_logs` shows
    `REGEX_FAILED` "PAN regex validation failed" (4th letter must be a holder
    type P/C/H/F/A/T/B/L/J/G; our safe PAN uses E) - so BGV never starts - every BGV step
    (flow 1 KYC test, Discrepant, Insufficient) needs staging test numbers from
    the backend team / HyperVerge in .env. Never a real person's numbers.
    Image paths can be overridden per run: PROFILE_IMAGE, SELFIE_IMAGE,
    AADHAAR_FRONT_IMAGE, AADHAAR_BACK_IMAGE, PAN_IMAGE.
    **Cleanup deactivates AADHAR and PANCARD only** (`TEST_RIDER_DOC_TYPES` in
    utils/db.ts) - every test's afterAll and `npm run cleanup:kyc`. The SELFIE
    row stays active on purpose.
    `npm run test:amazon` runs all 5 Amazon tests one at a time with the safe
    numbers / images baked in, then generates the Allure report.
    **No rider-app login by default** (this is dashboard automation):
    `config.riderAppSteps` (RIDER_APP_STEPS=true to enable) gates the profile
    picture + KYC selfie steps; otherwise they're skipped. The AuthBridge
    webhook uses the **vendor's** dashboard token (`utils/authBridge.ts`:
    `vendorAuthToken(page)` reads `authtoken` off a dashboard request,
    `reportCourtCaseResult(...)` posts the result).
    **Rider-app version:** staging refuses sendOtp from old app versions
    ("Please update the Rider app to the latest version", 400). `RiderApi`
    sends appv 12.34 / build 345 (12.33 and below refused on 2026-10-16);
    override with RIDER_APP_VERSION / RIDER_APP_BUILD. Recent versions in use:
    `SELECT app_version, COUNT(*) FROM user_device_details WHERE updated_at >
    NOW() - INTERVAL 3 DAY GROUP BY 1`.
    **Standalone:** `npm run cleanup:kyc` (project "KYC Cleanup",
    `tests/kyc.cleanup.ts`, `deactivateAllTestRiderKycDocuments()`) deactivates
    every active AADHAR / PANCARD row on any "Auto QA amzuser" rider - use after
    an interrupted run or a DUPLICATE_REJECTED. Skips unless RUN_KYC_CLEANUP=true
    (the npm script sets it), so a full `npm test` never runs it mid-suite.
    `doc_number` is stored in plain text, so rows can be matched by number.

Show Count: one click loads all three cards from `POST /org/staff/all/count/v2`;
the buttons are then replaced by numbers (label `<p>` followed by number `<p>`).
The test annotates "Counts before" / "Counts after" in the report.

Amazon staff are created immediately - no approval queue, and they start as **KYC Pending**. Every run creates a
real "Auto QA amzuser NNN" delivery boy on staging.

Reference manual request (from the browser, 2026-09-30):
`POST https://api-staging.staffpay.in/org/staff/` with the fields above plus
`selfieEnabled/trackAndTraceEnabled/geofenceAutoApproval: true`, `salaryType: 4`,
`staffCreatedSoruce: "CREATE_STAFF"`. List: `POST /org/staff/all/v2`
`{"pageNo":1,"pageSize":10,"searchText":"<phone>"}`. Never copy an `authtoken`
from a pasted curl into the repo - the tests log in through the UI.

## Blue Dart flow

Blue Dart (`9519519514`, Bluedart_Onboarding, org 579) puts new staff in
**`titan.bluedart_approval_request`** as `PENDING` / `ONBOARDING` with a
`request_ref` like `BDR-XXXXXXXXXXXX`, returned in the create reply
(`PENDING_REQUEST_APPROVAL — BDR-...`, `AddStaffDialog.submitForApproval()`).
There is no `titan.users` row, and so nothing in the staff list, until BD OPS
(`2288777001`, `OPS_NUMBER`) approves it in **Approval Workflow -> Review ->
Addition type "New Addition" -> Approve & Submit** (`ApprovalWorkflowPage`).
`create-staff.e2e.spec.ts` does vendor -> OPS -> vendor in one browser, logging
out between (`LoginPage.logout`, `loginAsOps`). titanautomation approves the
same request via `POST /bluedart/approval-requests/{ref}/approve`.
Hub "tEst BD hub" / shift "TEST SHIft" work again (2026-10-19); on 2026-09-30
staging briefly rejected that hub ("Could not resolve the store for this rider").
After the OPS login, Rider Management loads behind a full-page spinner that
can swallow clicks for a while - `ApprovalWorkflowPage.open` retries for 60s.

## Amazon KYC test numbers

Mirrors titanautomation's Amazon BGV tests (one fixed test identity per run,
blacklisting cleared before and after):

- **Aadhaar:** the team's fixed staging test number, `AADHAAR_TEST_NUMBER` in
  `.env` (gitignored; never commit, log or report it). Made-up numbers fail
  staging's checksum check ("Please enter valid Aadhar number").
- **PAN:** `PAN_TEST_NUMBER` from `.env` if set, else generated per run (4th
  letter E - no such holder type, so never a real PAN). **Known staging issue
  (since ~2026-10-08, still on 2026-10-19):** the vendor portal's PAN Update
  answers `SUCCESS` but writes no `PANCARD` row, for the old team test PAN and
  for generated ones, so every KYC/BGV journey stops at the PAN check with a
  message saying so. It looks like PANs that fail verification are dropped;
  a staging test PAN that passes is needed from the backend team.
- **`useKycTestNumbers()`** (in each KYC file): `beforeAll` takes the
  `kyc-test-numbers` lock (`utils/loginLock.ts`; one KYC test at a time across
  workers, stale after 15 min) and frees the fixed numbers
  (`releaseTestKycNumbers`: `entity_documents.is_blacklisted = 0` by
  `doc_number`, deactivate rows still held by "Auto QA amzuser %" riders,
  `user_blacklist.is_black_listed = 0` by `aadhaar_number`). `afterAll`, pass or
  fail: deactivate and un-blacklist the rider's own AADHAR/PANCARD rows, clear
  `user_blacklist` by its contact, free the numbers again, release the lock.
  The `user_blacklist` part is what titanautomation's
  `clear_the_blacklisted_documents` does; without it a Discrepant run blocks
  the test Aadhaar for every later rider.
- KYC sample images: `test-assets/sample-aadhaar-front.png`,
  `sample-aadhaar-back.png`, `sample-pan.png` - generated, marked
  "SAMPLE - TEST ONLY", masked numbers. Override with `AADHAAR_FRONT_IMAGE` /
  `AADHAAR_BACK_IMAGE` / `PAN_IMAGE`.

## Things that are not obvious

- **Vendor-created staff needs BD OPS approval** (staging change, Oct 2026). Add
  Staff no longer creates the staff: the POST `/org/staff/` reply is
  `PENDING_REQUEST_APPROVAL — BDR-...` and nothing appears in the vendor list.
  BD OPS (`2288777001`, `OPS_NUMBER`) approves it in **Approval Workflow →
  Review → Addition type "New Addition" → Approve & Submit**; only then does the
  staff exist. titanautomation does the same step via
  `POST /bluedart/approval-requests/{ref}/approve`. The OPS login has no consent
  screen and lands on `/rider-management` (`LoginPage.loginAsOps`).
- **Branch switch is required after login.** The header already shows
  "Bluedart_Onboarding", but a fresh session has `customerId: null` in its org
  info. Add Staff then calls `/common/vehicleTypesv2/undefined` and
  `/org/hubs/list/undefined/all/v2` and MOT/Hub dropdowns come up empty.
  Choosing the branch in **Switch Branches** (`StaffListPage.switchBranch`) loads
  the org and they fill. A personal browser often works without it because a
  branch was picked there before.
- **Wait for the PUT `/orgs/<id>` before the click, not after** - under
  `SLOW_MO` it finishes before a listener added afterwards is attached.
- **Field order in Basic Info matters.** Staff Type is what makes Roll Code and
  MOT appear; MOT only exists for "Delivery Staff".
- **Document Validated reveals Aadhaar and PAN checkboxes**, both required.
- **Work Info:** choose a hub, then a shift (multi-select listbox, close with
  Escape). At least one shift is mandatory.
- **Dropdowns are server-backed.** An empty one renders a single option like
  "No Data Found" / "No hub found". `AddStaffDialog` waits for options before
  deciding a menu is empty and throws a clear error instead of timing out.
- **OTP lookup** takes the newest non-validated `STAFFPAY` row and polls,
  because the row can land a few seconds after Get OTP.
- **Blue Dart vendors get a Terms & conditions consent screen on every login;**
  Amazon vendors do not (`login(number, { consent: false })`).
- **Date pickers:** the field sometimes swallows the click and the calendar
  never opens - `selectDate` re-clicks until it is visible. It also skips the year list when the calendar is
  already on the target year - otherwise the current year matches twice
  (header + list), which bit the Date of Join = today case.
- **Submit waits for `POST /org/staff/` itself** (`AddStaffDialog.submit`, up to
  60s): staging can take >5s, and rejections come back as HTTP 200 with
  `status.code` 400 in the body. A rejection fails with the server's message.
- **Hubs can be switched off by hand.** If a hub vanishes from the dropdown,
  check `titan.hubs.is_active` (TBI1_AMZ HSR Store / 1048 was deactivated and
  re-activated from the Amazon vendor account on 2026-09-30).
- **KYC documents (Aadhaar / PAN) are not automated.** Never use a real
  person's documents or ID numbers (e.g. screenshots from production) as test
  data. Generated "SAMPLE - TEST ONLY" images are fine; ID numbers need
  staging test values approved by the backend team / KYC provider.
- **Hub dropdown:** the click sometimes doesn't open it and the list
  sometimes lacks an active hub - `openHubOptions` re-clicks until open and
  `selectHub` reopens up to 3 times, then lists the hubs it saw.
- **SSM tunnels drop** after idle time or a long session; symptoms are
  `ETIMEDOUT` or `ECONNREFUSED 127.0.0.1:3306`. Restart the tunnel.
- Every Staff Creation run creates a real "QA Auto <seed>" Delivery Staff in
  Bluedart_Onboarding on staging.

## Test data (utils/testData.ts)

Amazon: `buildAmazonStaff()` - see the tables in "Amazon Now flow".

Blue Dart: vendor `9519519514` (org Bluedart_Onboarding, id 579), BD OPS
`2288777001`. Defaults in `buildStaff()`: Delivery Staff, MOT "Driver-Delivery
Boy", SCC "AAG", MPC, "Delivery - All Products", hub **"tEst BD hub"**, shift
**"TEST SHIft" (11:17 - 23:17)** - the same as the QA BD BGV staff. Phone and email are seeded from the clock so
each run is unique. Override per test: `buildStaff({ hubName: '...' })`.

## Adding a test

1. Locators and actions go in a page object under `pages/`, not in the spec.
2. Tests that start already logged in go in a normal `*.spec.ts` (project `chromium`).
3. A full journey that must log in itself goes in `*.e2e.spec.ts` (project `Staff Creation`).
4. Use `buildAmazonStaff()` (or `buildStaff()` for Blue Dart) for any data that must be unique.
   For a new org: add its vendor/branch to `config`, a `build<Org>Staff()` with
   its own name prefix and phone prefix, `fill<Org>...Info` methods on
   `AddStaffDialog`, and its own `*.e2e.spec.ts` + npm script.
5. Match titanautomation's Allure layout: name the test as a sentence starting
   "Verify that ...", and call `allureSuite(test, '<Area>')` (from
   `utils/allureSuite.ts`) once at the top of the file. Allure then shows
   Default Suite > staffpay-automation > Login / AddStaff / StaffCreation.
6. Run it headed with `npm run test:watch -- -g "<name>"`, then the full suite.
