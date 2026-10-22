---
name: staffpay-automation
description: How the StaffPay vendor dashboard UI automation (Playwright + TypeScript) is built, run and extended - login via DB OTP, branch switch, Add Staff flows for Amazon Now (Amazon Tez Bangalore) and Blue Dart (with BD OPS approval), one KYC identity (Somesh) for Amazon KYC/BGV, selfie via the rider-app API, document cleanup, BGV cost rules, DB secrets, Allure reports and recordings. Use when adding, running, debugging or reviewing tests in this repo.
---

# StaffPay dashboard automation

> **Status (2026-10-21):**
> - **Blue Dart** runs end to end: vendor adds staff -> BD OPS approves in
>   Approval Workflow -> vendor finds the staff (see "Blue Dart flow").
> - **Amazon Now** (org *Amazon Tez Bangalore*): staff creation, selfie (via
>   the rider-app API) and Aadhaar save work with one consistent identity,
>   **Somesh Mallick** (`tests/amazon-kyc-upload.e2e.spec.ts`). The BGV journeys
>   (Clear, Discrepant, Insufficient, Attention Required) ran on 2026-10-19 with
>   mismatched sample data; they need re-running with the Somesh identity -
>   **ask first, they cost money** (see "BGV costs money").
> - Open with the devs: uploaded KYC images are not linked to the saved
>   document row (`doc_link` null), so face match reports "Face Match Failed".

Playwright + TypeScript UI tests for the StaffPay **vendor dashboard** on staging
(`https://staging.staffpay.in`). Scope (agreed with the lead): **dashboard only -
user creation, KYC documents being visible for each scenario, and the BGV
dashboard.** The app is not tested here. The rider-app API is used only to put
*test data* in place (the rider's selfie), never as a test step.

## BGV costs money - read before running anything

Every BGV that reaches **AuthBridge** (third party) is charged **Rs 20**.

| Action | Starts a BGV? | Reaches AuthBridge (charged)? |
|---|---|---|
| Saving the Aadhaar only | no | no |
| Saving Aadhaar **and** PAN (PAN "Update") | yes, automatically | normally no: a vendor-typed Aadhaar has no address, so it comes back **Insufficient at once** with no AuthBridge `request_id` |
| **Retrigger BGV -> Address -> Initiate BGV** | yes | **yes - charged** |
| The tests' "AuthBridge reports ..." step (`POST /webhook/authbridge/courtcase`) | no | no - it is a simulated result posted into staging |

Rules:
- **Never** run a BGV test, a probe, or the PAN Update without telling the user
  what will be triggered, showing the screen and getting an explicit yes.
- Tests that trigger a charged BGV: `amazon-bgv-*.e2e.spec.ts` and the 2nd test
  in `create-amazon-staff.e2e.spec.ts`. Plain `npm test` / `test:watch` /
  `test:amazon` run them, so don't run those casually either.
- To check whether a BGV was charged: `rider_court_case_check` (entity_type
  'USER', entity_value = users.id) - a row **with a `request_id`** reached AuthBridge.
- Safe for verifying unrelated changes: the Blue Dart tests and
  `tests/amazon-kyc-upload.e2e.spec.ts` (stops before the PAN Update).

## Layout

```
pages/                    Page objects - all locators live here
  LoginPage.ts            phone -> Get OTP -> OTP from DB -> Login -> T&C consent; loginAsOps(); logout()
  StaffListPage.ts        /staff listing, switchBranch(), openFromNav(), showCounts(), openKycPendingTab(), openAddStaff(), search()
  StaffDetailsPage.ts     /staff/details/<user id>: uploadKycDocuments(), saveAadhaarNumber(), savePanNumber(),
                          retriggerBgvWithAddress() - opened by clicking a staff row
  AddStaffDialog.ts       "Add New Staff" dialog: Basic Info + Work Info tabs; submit() returns the server message,
                          submitForApproval() the Blue Dart BDR- ref
  ApprovalWorkflowPage.ts BD OPS "Approval Workflow" tab: Review -> Addition type -> Approve & Submit
tests/
  auth.setup.ts           logs in once, switches branch, saves .auth/vendor.json
  login.spec.ts           fresh login (starts logged out)
  add-staff.spec.ts       Blue Dart form checks, reuse the saved session
  amazon-kyc-upload.e2e.spec.ts    Amazon happy path, NO BGV: create Somesh -> selfie (API) -> Aadhaar + PAN images -> save Aadhaar
  create-amazon-staff.e2e.spec.ts  Amazon: create + counts + DB + KYC Pending + detail page; 2nd test does KYC + BGV Clear (charged)
  amazon-bgv-{discrepant,insufficient,attention-required}.e2e.spec.ts   BGV scenarios (charged)
  support/bgvJourney.ts   shared BGV steps + useKycTestNumbers() (lock + document cleanup)
  kyc.cleanup.ts          manual cleanup, `npm run cleanup:kyc`
  bluedart-onboarding-approval.e2e.spec.ts  Blue Dart: vendor adds -> super admin approves (with remark) -> before/after DB checks -> vendor sees rider
  explore.spec.ts         scratch; skipped unless run with --debug
utils/
  config.ts               vendor / OPS numbers, branches, KYC numbers (from .env), DB host/port/name
  db.ts                   MySQL pool, OTP lookup, getStaffRecord(), getUserDocument(), getCourtCase(),
                          releaseTestKycNumbers() / deactivateTestRiderDocuments() / clearUserBlacklistForContact()
  riderApi.ts             RiderApi: useGeneratedToken(), uploadImage(), uploadKycSelfie(), saveFullProfile() - test data only
  authBridge.ts           simulated AuthBridge court-case result (webhook) with the vendor's token
  testData.ts             KYC_IDENTITY (Somesh), buildAmazonStaff(), buildStaff() (Blue Dart), buildKycNumbers()
  secretStore.ts          DB username/password lookup (see "DB credentials")
  loginLock.ts            cross-worker locks: one OTP login per number, one KYC test at a time
  recordingsReporter.ts   copies videos to reports/recordings/<run time>/
test-assets/              Somesh_adhaarFront.png, Somesh_adhaarBack.png, Somesh_pan.png, Somesh_profile.png
```

## Test projects (playwright.config.ts)

| Project    | Runs                         | Session                          | Depends on |
|------------|------------------------------|----------------------------------|------------|
| `setup`    | `*.setup.ts`                 | logs in, writes `.auth/vendor.json` | -       |
| `chromium` | everything except `*.e2e.spec.ts` | reuses `.auth/vendor.json`   | `setup`    |
| `Staff Creation` | `*.e2e.spec.ts`         | starts logged out, logs in itself | -          |
| `KYC Cleanup` | `*.cleanup.ts`            | no browser                       | -          |

`Staff Creation` has no dependencies on purpose: running one `*.e2e.spec.ts`
file (CLI or the VS Code play button) runs only that journey in one browser.
Timeout 180s (360s with SLOW_MO); actions time out after 15s (30s with SLOW_MO).

Two logins for the same number at once would each request an OTP and one would
read the other's and fail. `LoginPage.login` holds a lock (`utils/loginLock.ts`,
a directory in the OS temp folder) so parallel logins take turns. A second
lock, `kyc-test-numbers`, lets only one Amazon KYC test use the identity's
numbers at a time (stale after 15 min).

`chromium` depends on `setup`, and dependency projects ignore CLI filters, so
`-g` on a chromium test still runs the setup login first.

## Running

Prerequisites:
- `npm install`
- **SSH tunnel to staging MySQL on `127.0.0.1:3306`** - login reads the OTP
  from the `titan` DB. Tunnel down -> `ECONNREFUSED 127.0.0.1:3306`; stale ->
  `ETIMEDOUT`. Restart it.
- DB credentials available (see below).
- `cp .env.example .env` - it has the DB host/port/name and the KYC identity's
  (Somesh's) `AADHAAR_TEST_NUMBER` / `PAN_TEST_NUMBER`. `.env` itself is
  gitignored; DB credentials never go in either file.
- `~/.titanautomation-secrets.json` (DB credentials, shared privately - same
  file titanautomation uses). Never commit it.
- Don't log in with a test number in your own browser during a run - it can
  consume the OTP.
- Don't run this suite and titanautomation at the same time if both use the
  same identity: each run deactivates the identity's documents on every rider.

| Command | What it does |
|---|---|
| `npm test` | Full suite, headless - **includes the charged BGV tests** |
| `npm run test:watch` | Same, headed, one window, `SLOW_MO=600` - **includes BGV tests** |
| `npm run test:bluedart` / `test:bluedart:headed` | Blue Dart journey (vendor adds -> super admin approves -> vendor finds) with before/after DB checks |
| `npx playwright test tests/amazon-kyc-upload.e2e.spec.ts --headed` | Amazon happy path without BGV (safe) |
| `npm run test:amazon` / `test:amazon:headed` | All Amazon journeys, one worker, then the Allure report - **charged** |
| `npm run test:amazon-bgv-discrepant` / `-insufficient` / `-attention-required` | One BGV scenario - **charged** |
| `npm run test:no-auth` | `chromium` project only, reusing the saved session |
| `npx playwright test -g "<name>"` / `--debug` | One test by name / step through with the inspector |
| `npm run cleanup:kyc` | Deactivate Aadhaar / PAN rows of all test riders (numbers starting 421) |
| `npm run allure` / `npm run report` | Allure report / Playwright HTML report of the last run |
| `npm run test:bluedart` / `test:bluedart:headed` | Blue Dart: vendor adds staff -> super admin approves -> vendor sees rider |

Headless is the default (Chrome doesn't open); add `--headed` or use the
`test:watch` / `test:*` scripts to watch.

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

Video for every test, screenshots on failure, both attached in Allure.
`amazon-kyc-upload` also attaches a numbered screenshot per step (01 ... 07).
Allure CLI needs Java (`allure` via Homebrew).

## DB credentials

`utils/secretStore.ts` mirrors titanautomation's `SecretStore.java`. Per key
(`titan_username`, `titan_password`), first hit wins:

1. environment variable of the same name
2. `~/.titanautomation-secrets.json` (chmod 600, outside the repo) - how local runs work
3. AWS Secrets Manager `secret/application/titanautomation-staging` in `ap-south-1`

Human AWS users are denied that secret by `LSN-Human-Baseline`, so laptops use
the local file; Jenkins nodes read it through their instance role.

## Logins

| Login | Number | Lands on |
|---|---|---|
| Blue Dart vendor | `9519519514` (`VENDOR_NUMBER`) | Bluedart_Onboarding (org 579), staff list, T&C consent every login |
| BD OPS | `2288777001` (`OPS_NUMBER`) | `/rider-management`, Approval Workflow tab, no consent |
| Amazon Now vendor | `9843996388` (`AMAZON_VENDOR_NUMBER`) | Amazon Tez Bangalore (org 162002152849268), `/ev-sp`, no consent |

OTPs come from `otp_details` (newest non-validated row, `event_type` STAFFPAY).

## Amazon KYC identity - Somesh

Like titanautomation, one person's details, selfie and documents always go
together, so name / DOB / face line up. `KYC_IDENTITY` in `utils/testData.ts`:

- **Somesh Mallick**, DOB **05/01/1976** (as on his Aadhaar and PAN), male.
- Selfie `test-assets/Somesh_profile.png`; documents `Somesh_adhaarFront.png`,
  `Somesh_adhaarBack.png`, `Somesh_pan.png`.
- Aadhaar / PAN numbers: `.env` (`AADHAAR_TEST_NUMBER`, `PAN_TEST_NUMBER`, copied from `.env.example`);
  `buildKycNumbers()` throws if either is missing.
- Every Amazon rider (`buildAmazonStaff()`) is created as Somesh with a unique
  10-digit phone starting **421** (not a real mobile range). The 421 prefix is
  what marks a rider as this suite's for the per-rider cleanup.

History: Charles (titanautomation's identity) was tried first and removed;
before that, generated "SAMPLE" images and the team test numbers were used -
staging approved them, but rider and documents didn't match and the selfie step
never ran, so the tests passed without testing anything real.

## Amazon Now flow

Test: `tests/amazon-kyc-upload.e2e.spec.ts` (happy path, no BGV). Steps:

1. Log in as `9843996388` (`login(number, { consent: false })`), switch branch
   to **Amazon Tez Bangalore**, open the **Staff** tab (`openFromNav`).
2. **Add Staff** -> Basic Info (`fillAmazonBasicInfo`): name + DOB from
   KYC_IDENTITY, Staff Type Delivery Boy, phone 421..., Date of Join today,
   Vehicle Type Bike (vehicle number = phone), Source Referral. Work Info is
   locked until Source is chosen.
3. Work Info (`fillAmazonWorkInfo`): Business Type FOOD -> Business Amazon ->
   Hub **TBI1_AMZ HSR Store** -> Shift **TEST Full Day** -> Zone
   **Koramangala and HSR**. Submit waits for `POST /org/staff/`.
4. DB: `users` APPROVED / active, name matches (`getStaffRecord`). Amazon staff
   are created immediately (no approval queue) and start as **KYC Pending**.
5. **Selfie (test data, rider-app API)** - the titanautomation way:
   `RiderApi.useGeneratedToken(userId, phone)` -> `POST /auth/generate-token`
   `{ userId, leadId: 0, contactNumber }` returns the rider's token with **no
   OTP and no app-version check** (titanautomation `TitanAPI.generateToken`).
   Then `uploadImage(Somesh_profile.png)` (presigned S3 PUT) and
   `uploadKycSelfie(link)` -> `POST /de/user/kyc` step SELFIE_UPLOAD (body as
   titanautomation `fixtures/titan/selfie_upload.json`). Result: SELFIE row in
   `entity_documents` (PENDING_APPROVAL, HYPERVERGE) and `users.s3_profile_link`
   set; the detail page shows the selfie.
   - The OTP login (`/auth/sendOtp` + `/auth/login`, titanautomation
     `SelfieUploadAPI.signUpAndLoginViaAPI`) is **refused by staging** ("Please
     update the Rider app to the latest version") whatever `appv` is sent
     (12.25, 12.34, even 99.0) - don't use it.
   - Inserting the SELFIE row straight into the DB also works but skips the
     backend; use the API.
6. Open the rider **from the list** (search the phone, click the row) - going to
   `/staff/details/<id>` directly leaves every KYC section empty.
7. Upload Aadhaar front, back and PAN images (`uploadKycDocuments`): three
   hidden `<input type=file>` that disappear once filled - fill from the last
   backwards. Uploads go to the restricted S3 bucket; nothing reaches
   `entity_documents` until a number is saved.
8. Type the Aadhaar number -> **Save** (`saveAadhaarNumber`). Expect an
   `AADHAR` row **APPROVED** ("Manually Verified"). The test fails on
   `DUPLICATE_REJECTED` ("Documents are linked to another user").
9. **Stop.** The PAN Update would start a BGV (see "BGV costs money").

Behaviour seen on staging:
- **Face match runs on the vendor path.** Saving the Aadhaar runs a HyperVerge
  face match against the selfie. Saved **without a selfie**, the Aadhaar row
  is deactivated about 20s later ("Face Match Failed"). With a selfie it stays
  active, but still says "Face Match Failed" with no score - because the
  uploaded images are never linked to the saved row (`doc_link` null), so
  there is no document photo to compare. **Dev bug.**
- Saving the Aadhaar reloads the KYC section and drops an unsaved PAN image
  and number - re-upload / retype before Update (`enterNumberAndSubmit`
  retypes until the button is enabled).
- Save / Update approve the document straight away; Approve may look enabled
  but sends nothing, so tests only click it for a document not yet APPROVED.

## Document cleanup (duplicates and blacklisting)

Staging rejects a save when the number is **active on another rider**
(`DUPLICATE_REJECTED`) or **blacklisted** (after a Discrepant verdict). Every
Amazon KYC test therefore frees the identity's numbers - the same cleanup as
titanautomation's `DbConnect.updateEntityDocsKYC` + `clear_the_blacklisted_documents`.

`releaseTestKycNumbers([aadhaar, pan])` (utils/db.ts):

| Table | Change |
|---|---|
| `entity_documents` | `is_active = 0` on **every** active row with these `doc_number`s, **whoever holds them** (manual riders like "test 123", other suites) - the duplicate check only looks at active rows; `is_blacklisted = 0` |
| `user_blacklist` | `is_black_listed = 0` by `aadhaar_number` (a Discrepant leaves rows that block the Aadhaar for every future rider) |
| `entity_document_logs` | **not touched** - history only, no part in the check |

Where it runs:
- `amazon-kyc-upload`: `beforeAll` (lock + free). Leaves the rider's documents
  in place afterwards so they can be checked on the dashboard.
- BGV files: `useKycTestNumbers()` (tests/support/bgvJourney.ts) - `beforeAll`
  lock + free; `afterAll` (pass or fail) deactivates + un-blacklists the
  rider's own AADHAR/PANCARD (`deactivateTestRiderDocuments`, 421 riders only),
  clears `user_blacklist` by its contact, frees the numbers again, releases the lock.
- `npm run cleanup:kyc`: deactivate AADHAR/PANCARD on all 421 riders.

`doc_number` is plain text, so rows match by number. Tables that hold these
numbers on staging: `entity_documents`, `entity_document_logs`, `user_blacklist`.

## Amazon BGV (charged - ask first)

- BGV starts as soon as Aadhaar + PAN are saved, but a vendor-typed Aadhaar
  has no address, so it comes back **Insufficient at once** (court case
  `Insufficient`, `bgv_status = 'Insufficient'`, no `request_id`) without
  reaching AuthBridge - titanautomation's "Aadhaar has no address" case.
- **Retrigger BGV** on a freshly opened detail page -> "Retrigger Background
  Verification" dialog -> Address* -> **Initiate BGV** sends it to AuthBridge
  (**charged**): PAN `dl_case_check = INITIATED`, court case `WorkInProgress`,
  `bgv_status = INITIATED` (`retriggerBgvWithAddress`, `TEST_BGV_ADDRESS`).
  titanautomation does the same via `POST /org/staff/bgv/manual/trigger`.
- The Pan Card's **Initiate** button is not BGV - it calls
  `/dl/verification/existing/user`.
- The tests then post a simulated AuthBridge result
  (`reportCourtCaseResult`, `POST /webhook/authbridge/courtcase` with the
  case's uniqueID / requestId and the vendor's token):
  - **Clear** -> court case Complete/Final/Clear, `dl_case_check` and
    `bgv_status` VERIFIED, UI "Verified".
  - **Discrepant** -> `users.status` REJECTED, `bgv_status` FAILED, AADHAR +
    PANCARD REJECTED, documents **blacklisted**, UI "Discrepancy" / "Manually Rejected".
  - **Insufficient** (interim) -> stored on the court case
    (Complete/Insufficient/Interim) but BGV stays `INITIATED`, rider stays
    approved, UI still "Background Verification Initiated" (confirm with
    product whether Insufficient should show).
  - **Attention Required** -> court case Complete/Final/Attention Required.
- Shared steps: `tests/support/bgvJourney.ts` (`createRiderWithBgvInitiated`,
  `reportCourtCase`, `reopenRider`).

## Blue Dart flow

Blue Dart (`9519519514`, Bluedart_Onboarding, org 579) puts new staff in
**`titan.bluedart_approval_request`** as `PENDING` / `ONBOARDING` with a
`request_ref` like `BDR-XXXXXXXXXXXX`, returned in the create reply
(`PENDING_REQUEST_APPROVAL — BDR-...`, `AddStaffDialog.submitForApproval()`).
There is no `titan.users` row, and so nothing in the staff list, until BD OPS
(`2288777001`) approves it in **Approval Workflow -> Review -> Addition type
"New Addition" -> Approve & Submit** (`ApprovalWorkflowPage`).
`bluedart-onboarding-approval.e2e.spec.ts` is the only Blue Dart journey test
(see below). titanautomation approves the
same request via `POST /bluedart/approval-requests/{ref}/approve`.
After the OPS login, Rider Management loads behind a full-page spinner that
can swallow clicks - `ApprovalWorkflowPage.open` retries for 60s. Status filter
buttons carry a live count ("Pending 45") - match by prefix.

Test data (`buildStaff()`): Delivery Staff, MOT "Driver-Delivery Boy", SCC
"AAG", MPC, "Delivery - All Products", hub **"tEst BD hub"**, shift
**"TEST SHIft" (11:17 - 23:17)** - the same as the QA BD BGV staff. Phone and
email seeded from the clock. Every run creates a real "QA Auto <seed>"
Delivery Staff in Bluedart_Onboarding.

## Blue Dart onboarding with super-admin approval - before/after checks

Test: `tests/bluedart-onboarding-approval.e2e.spec.ts`
(`npm run test:bluedart`, `npm run test:bluedart:headed`). The Blue Dart
journey test - it replaced the old `create-staff.e2e.spec.ts`. Uses a remark,
separate vendor / super-admin browser sessions and DB checks before and after
approval.

1. **Vendor** `9519519514` (org Bluedart_Onboarding, id 579) logs in - T&C
   consent screen every login - switches branch, Show Count, adds a
   Delivery Staff (`buildStaff()`: hub **tEst BD hub** = store
   `TESTBDHUB123`, shift **TEST SHIft**). Add Staff answers
   `PENDING_REQUEST_APPROVAL — BDR-XXXXXXXXXXXX` (HTTP 200, code 200).
2. **Before approval** - `titan.bluedart_approval_request`: `request_type
   ONBOARDING`, `status PENDING`, `request_ref` = the BDR ref, org_id 579,
   `requester_role BLUEDART_VENDOR`, `subject_user_id`, `addition_type`,
   `decided_by`, `decided_by_role` all NULL. **No `users` row**, and the rider
   is not in the vendor's staff list.
3. **Super admin** `2288777001` ("Test BD Super Admin", role 30, org 579; no
   consent screen) lands on `/rider-management`. Tab **Approval Workflow**
   (`/approval-workflow`, `ApprovalWorkflowPage`) -> **Onboarding** ->
   **Pending N** list (`POST /bluedart/approval-requests/list` {requestType
   ONBOARDING, status PENDING, pageSize 20}, newest first). No phone search;
   find the row by phone. **Review** dialog: header "ONBOARDING · PENDING",
   **Addition type \*** select (options **New Addition** / **Replacement**),
   **Remark (optional)**, buttons Close / Reject / **Approve & Submit**
   (disabled until an addition type is picked).
4. **After approval** - request `status APPROVED`, `addition_type
   NEW_ADDITION`, `decided_by_role BLUEDART_SUPER_ADMIN`, `decision_remark` =
   the remark, `decided_by` / `decided_at` set, `subject_user_id` = the new
   `users.id`. `users` row created: `status CREATED`, is_active 1, org 579,
   `user_info.hub_id` 1123. Row in the **Approved** list with Last Action
   "Test BD Super Admin  Super Admin · <time>" (role label, not the DB value) and a View button.
5. **Vendor** again: Show Count - Total Staffs and KYC Pending both up;
   search the phone under Total and under the KYC Pending card -> row found.

The test drives two browser contexts (vendor + super admin). Other people's
suites also create and approve "QA Auto" Blue Dart riders on staging, so
counts are asserted as "went up", not "+1".

## Things that are not obvious

- **Branch switch is required after login.** A fresh session has
  `customerId: null`, so Add Staff asks for MOT / hubs with `undefined` and the
  dropdowns are empty. `StaffListPage.switchBranch` waits for the header org
  name, opens Switch Branches (retries if the click is ignored), waits for the
  branch entry, and waits for `PUT /orgs/<id>` (listener attached before the click).
- **Blue Dart Basic Info order matters:** Staff Type reveals Roll Code and MOT.
  Document Validated reveals Aadhaar and PAN checkboxes, both required. Work
  Info: hub, then at least one shift (close the listbox with Escape).
- **Dropdowns are server-backed;** an empty one shows one option like "No Data
  Found". `AddStaffDialog` waits for options and throws a clear error.
- **Date pickers** sometimes swallow the click - `selectDate` re-clicks, and
  skips the year list when already on the target year.
- **Submit waits for `POST /org/staff/`** (up to 60s); rejections come back as
  HTTP 200 with `status.code` 400 and fail with the server's message.
- **Hub dropdown** sometimes doesn't open or lacks an active hub -
  `openHubOptions` re-clicks, `selectHub` reopens up to 3 times. Hubs can be
  switched off by hand (`titan.hubs.is_active`).
- **OTP lookup** polls for 15s; "No OTP found" is usually a slow staging or a
  stale tunnel - rerun.
- **Probing the DB:** add a throwaway `debugQuery` export to `utils/db.ts` and a
  `tests/_*.cleanup.ts` (project "KYC Cleanup"), then remove both. Never
  print ID numbers - mask them.
- **Staff list search twice:** after a search the Search button turns into
  **Reset**; `StaffListPage.search()` doesn't handle that, so the Blue Dart
  approval test clicks Reset first (its `searchVendorList` helper). The Review
  dialog remark is also filled in that test - `ApprovalWorkflowPage.approve()`
  doesn't take a remark. Shared page objects are left as Sreelakshmi wrote them.

## Adding a test

1. Locators and actions go in a page object under `pages/`, not in the spec.
2. Tests that start already logged in go in a normal `*.spec.ts` (project `chromium`).
3. A full journey that must log in itself goes in `*.e2e.spec.ts` (project `Staff Creation`).
4. Use `buildAmazonStaff()` (Amazon, Somesh identity) or `buildStaff()` (Blue
   Dart) for data that must be unique. Any Amazon KYC test must free the
   identity's numbers first (`useKycTestNumbers()` or `releaseTestKycNumbers`)
   and take the KYC lock.
5. Match titanautomation's Allure layout: name the test "Verify that ...", call
   `allureSuite(test, '<Area>')` once at the top of the file.
6. If the test saves Aadhaar **and** PAN or clicks Retrigger BGV, it costs
   money - say so in its doc comment, and get approval before every run.
7. Run it headed (`--headed`, or `npm run test:watch -- -g "<name>"` for
   non-BGV tests).
