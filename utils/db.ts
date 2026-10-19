import mysql from 'mysql2/promise';
import { config } from './config';
import { getSecret } from './secretStore';

// One shared pool for the whole run, rather than a new connection per query.
// Created on first use because the credentials come from Secrets Manager.
let pool: Promise<mysql.Pool> | undefined;

function getPool(): Promise<mysql.Pool> {
  pool ??= (async () =>
    mysql.createPool({
      ...config.db,
      user: await getSecret('titan_username'),
      password: await getSecret('titan_password'),
      connectionLimit: 5,
      ssl: { rejectUnauthorized: false },
    }))();
  return pool;
}

/** Which login an OTP belongs to: the vendor dashboard, or the rider app. */
export type OtpEventType = 'STAFFPAY' | 'RIDERAPP';

/**
 * Latest un-validated OTP for a number - StaffPay (dashboard) by default,
 * RIDERAPP for rider-app logins.
 * ORDER BY id DESC plus the status filter matter - without them you get a
 * stale OTP the moment a number requests a second one.
 * Polls because the row can land a few seconds after "Get OTP" is clicked.
 */
export async function getStaffPayOtp(
  contactNumber: string,
  timeoutMs = 15_000,
  eventType: OtpEventType = 'STAFFPAY',
): Promise<string> {
  const sql = `SELECT otp FROM otp_details
               WHERE contact_number = ?
                 AND event_type = ?
                 AND status != 'OTP_VALIDATED'
               ORDER BY id DESC
               LIMIT 1`;

  const deadline = Date.now() + timeoutMs;
  while (true) {
    const [rows] = await (await getPool()).execute<any[]>(sql, [contactNumber, eventType]);
    const otp = rows[0]?.otp;
    if (otp) return String(otp);
    if (Date.now() > deadline) throw new Error(`No OTP found for ${contactNumber} after ${timeoutMs / 1000}s`);
    await new Promise(r => setTimeout(r, 1000));
  }
}

/** What staff creation writes to `users` and `user_info`, with ids resolved to names. */
export interface StaffRecord {
  userId: number;
  name: string;
  status: string;
  isActive: number;
  userOrgId: number;
  staffUniqueId: string;
  vehicleNumber: string;
  hubName: string;
  hubOrgId: number;
  vehicleType: string;
  staffType: string;
  profileImageLink: string | null;
  address: string | null;
  pincode: string | null;
  emergencyContactName: string | null;
  emergencyContactNumber: string | null;
  contactNumber: string;
  role: number;
  staffTypeId: number;
  salaryType: number;
  selfieEnabled: number;
  trackAndTraceEnabled: number;
  geofenceAutoApproval: number;
  /** user_info.doj as YYYY-MM-DD (IST). */
  doj: string | null;
  bgvStatus: string | null;
}

/**
 * The `users` + `user_info` rows for a staff, joined to the hub, vehicle type
 * and staff type names so tests can compare with what they picked in the UI.
 * Polls because the rows can land just after the dashboard confirms.
 * Returns undefined if nothing appears within the timeout.
 */
export async function getStaffRecord(contactNumber: string, timeoutMs = 15_000): Promise<StaffRecord | undefined> {
  const sql = `SELECT u.id AS userId, u.name, u.status, u.is_active AS isActive,
                      u.organization_id AS userOrgId,
                      ui.staff_unique_id AS staffUniqueId, ui.vehicle_number AS vehicleNumber,
                      h.name AS hubName, h.organization_id AS hubOrgId,
                      vt.display_name AS vehicleType, st.name AS staffType,
                      u.s3_profile_link AS profileImageLink, ui.address,
                      CAST(ui.pincode AS CHAR) AS pincode,
                      ui.emergency_contact_name AS emergencyContactName,
                      CAST(ui.emergency_contact_number AS CHAR) AS emergencyContactNumber,
                      u.contact_number AS contactNumber, u.role, ui.staff_type AS staffTypeId,
                      ui.salary_type AS salaryType,
                      ui.selfie_enabled + 0 AS selfieEnabled,
                      ui.track_and_trace_enabled + 0 AS trackAndTraceEnabled,
                      ui.geofence_auto_approval + 0 AS geofenceAutoApproval,
                      DATE_FORMAT(CONVERT_TZ(ui.doj, '+00:00', '+05:30'), '%Y-%m-%d') AS doj,
                      ui.bgv_status AS bgvStatus
               FROM users u
               JOIN user_info ui ON ui.user_id = u.id
               LEFT JOIN hubs h ON h.id = ui.hub_id
               LEFT JOIN vehicle_types vt ON vt.id = ui.vehicle_type_id
               LEFT JOIN staff_types st ON st.id = ui.staff_type
               WHERE u.contact_number = ?
               ORDER BY u.id DESC
               LIMIT 1`;

  const deadline = Date.now() + timeoutMs;
  while (true) {
    const [rows] = await (await getPool()).execute<any[]>(sql, [contactNumber]);
    // is_active is a BIT(1) column, which mysql2 returns as a one-byte Buffer.
    if (rows[0]) return { ...rows[0], isActive: Number(rows[0].isActive?.[0] ?? rows[0].isActive) } as StaffRecord;
    if (Date.now() > deadline) return undefined;
    await new Promise(r => setTimeout(r, 1000));
  }
}

/** A rider's KYC document row in titan.entity_documents. */
export interface EntityDocument {
  id: number;
  docType: string;
  docLink: string;
  approvalStatus: string;
  isActive: number;
  autoKycBroker: string | null;
  /** BGV court-case check on the PANCARD row: INITIATED -> VERIFIED. */
  dlCaseCheck: string | null;
}

/**
 * The newest active document of a type for a user (entity_type USER).
 * Polls until it exists and, if given, reaches `status`.
 * Returns the last row seen (or undefined) on timeout so the test can show it.
 */
export async function getUserDocument(
  userId: number,
  docType: string,
  status?: string,
  timeoutMs = 15_000,
): Promise<EntityDocument | undefined> {
  const sql = `SELECT id, doc_type AS docType, doc_link AS docLink,
                      approval_status AS approvalStatus, is_active AS isActive,
                      auto_kyc_broker AS autoKycBroker, dl_case_check AS dlCaseCheck
               FROM entity_documents
               WHERE entity_id = ? AND entity_type = 'USER' AND doc_type = ? AND is_active = 1
               ORDER BY id DESC
               LIMIT 1`;

  const deadline = Date.now() + timeoutMs;
  let doc: EntityDocument | undefined;
  while (true) {
    const [rows] = await (await getPool()).execute<any[]>(sql, [userId, docType]);
    // is_active is BIT(1) - a one-byte Buffer.
    doc = rows[0] && { ...rows[0], isActive: Number(rows[0].isActive?.[0] ?? rows[0].isActive) };
    if (doc && (!status || doc.approvalStatus === status)) return doc;
    if (Date.now() > deadline) return doc;
    await new Promise(r => setTimeout(r, 1000));
  }
}

/** The documents a test run deactivates afterwards - Aadhaar and PAN only; the selfie stays active. */
export const TEST_RIDER_DOC_TYPES = ['AADHAR', 'PANCARD'];

/**
 * Test cleanup: marks a test rider's KYC documents inactive (is_active = 0) so
 * the fixed Aadhaar / PAN numbers in .env can be saved again next run instead
 * of coming back DUPLICATE_REJECTED. Only touches riders created by this suite
 * (name "Auto QA amzuser ..."), never anyone else. Returns the rows changed.
 */
export async function deactivateTestRiderDocuments(
  userId: number,
  docTypes: string[] = TEST_RIDER_DOC_TYPES,
  { unblacklist = false }: { unblacklist?: boolean } = {},
): Promise<number> {
  // A BGV Discrepant result blacklists the documents (is_blacklisted = 1), and
  // any later rider saving the same numbers is rejected - `unblacklist` clears
  // that too, so the fixed test numbers stay usable.
  const sql = `UPDATE entity_documents ed
               JOIN users u ON u.id = ed.entity_id
               SET ed.is_active = 0${unblacklist ? ', ed.is_blacklisted = 0' : ''}
               WHERE ed.entity_id = ?
                 AND ed.entity_type = 'USER'
                 AND ed.doc_type IN (${docTypes.map(() => '?').join(', ')})
                 AND (ed.is_active = 1${unblacklist ? ' OR ed.is_blacklisted = 1' : ''})
                 AND u.name LIKE 'Auto QA amzuser %'`;
  const [result] = await (await getPool()).execute<mysql.ResultSetHeader>(sql, [userId, ...docTypes]);
  return result.affectedRows;
}

/**
 * Standalone cleanup (npm run cleanup:kyc): deactivates every active AADHAR /
 * PANCARD row on this suite's test riders ("Auto QA amzuser ..."), e.g. after
 * a run was interrupted before its own afterAll cleanup. Frees the fixed
 * Aadhaar / PAN numbers in .env for reuse. Never touches other riders.
 * Returns the rows changed, per document type.
 */
export async function deactivateAllTestRiderKycDocuments(): Promise<Record<string, number>> {
  const changed: Record<string, number> = {};
  for (const docType of TEST_RIDER_DOC_TYPES) {
    const [result] = await (await getPool()).execute<mysql.ResultSetHeader>(
      `UPDATE entity_documents ed
       JOIN users u ON u.id = ed.entity_id
       SET ed.is_active = 0
       WHERE ed.entity_type = 'USER'
         AND ed.doc_type = ?
         AND ed.is_active = 1
         AND u.name LIKE 'Auto QA amzuser %'`,
      [docType],
    );
    changed[docType] = result.affectedRows;
  }
  return changed;
}

/** A rider's AuthBridge court-case (BGV) check in rider_court_case_check. */
export interface CourtCase {
  id: number;
  uniqueId: string;
  requestId: string;
  caseStatus: string;
  caseSeverity: string | null;
  state: string | null;
}

/**
 * The newest court case for a user (entity_type USER, entity_value = users.id).
 * Polls until one exists and, if given, reaches `status`; returns the last
 * row seen (or undefined) on timeout.
 */
export async function getCourtCase(userId: number, status?: string, timeoutMs = 20_000): Promise<CourtCase | undefined> {
  const sql = `SELECT id, unique_id AS uniqueId, request_id AS requestId, case_status AS caseStatus,
                      case_severity AS caseSeverity, state
               FROM rider_court_case_check
               WHERE entity_type = 'USER' AND entity_value = ?
               ORDER BY id DESC LIMIT 1`;
  const deadline = Date.now() + timeoutMs;
  let row: CourtCase | undefined;
  while (true) {
    const [rows] = await (await getPool()).execute<any[]>(sql, [userId]);
    row = rows[0] && { ...rows[0], uniqueId: String(rows[0].uniqueId), requestId: String(rows[0].requestId) };
    if (row && (!status || row.caseStatus === status)) return row;
    if (Date.now() > deadline) return row;
    await new Promise(r => setTimeout(r, 1000));
  }
}

/** Polls user_info.bgv_status until it equals `status` (or times out); returns the last value. */
export async function waitForBgvStatus(userId: number, status: string, timeoutMs = 20_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const [rows] = await (await getPool()).execute<any[]>('SELECT bgv_status FROM user_info WHERE user_id = ?', [userId]);
    const value: string | null = rows[0]?.bgv_status ?? null;
    if (value === status || Date.now() > deadline) return value;
    await new Promise(r => setTimeout(r, 1000));
  }
}

/**
 * Frees the fixed staging test numbers (Aadhaar first, then a fixed PAN if one
 * is configured) for the next rider - the same
 * cleanup titanautomation runs before and after its Amazon BGV tests
 * (clear_the_blacklisted_documents / clear_the_blacklisting_this_test_caused):
 *  - entity_documents: clears is_blacklisted on rows with these numbers, and
 *    deactivates active rows still held by this suite's test riders (else the
 *    next save is DUPLICATE_REJECTED, "Documents are linked to another user");
 *  - user_blacklist: clears the row Discrepant writes against the Aadhaar,
 *    which otherwise blocks that Aadhaar for every future rider.
 * Only ever called with the configured test numbers, never a real ID. Each
 * rider's own rows are also cleaned by deactivateTestRiderDocuments.
 */
export async function releaseTestKycNumbers(numbers: string[]): Promise<Record<string, number>> {
  const aadhaar = numbers[0];
  const marks = numbers.map(() => '?').join(', ');
  const db = await getPool();
  const [unblacklisted] = await db.execute<mysql.ResultSetHeader>(
    `UPDATE entity_documents SET is_blacklisted = 0
     WHERE doc_number IN (${marks}) AND is_blacklisted = 1`,
    numbers,
  );
  const [deactivated] = await db.execute<mysql.ResultSetHeader>(
    `UPDATE entity_documents ed
     JOIN users u ON u.id = ed.entity_id
     SET ed.is_active = 0
     WHERE ed.entity_type = 'USER' AND ed.doc_number IN (${marks}) AND ed.is_active = 1
       AND u.name LIKE 'Auto QA amzuser %'`,
    numbers,
  );
  const [userBlacklist] = await db.execute<mysql.ResultSetHeader>(
    `UPDATE user_blacklist SET is_black_listed = 0
     WHERE aadhaar_number = ? AND is_black_listed = 1`,
    [aadhaar],
  );
  return {
    unblacklisted: unblacklisted.affectedRows,
    deactivated: deactivated.affectedRows,
    userBlacklist: userBlacklist.affectedRows,
  };
}

/** Clears the user_blacklist row a Discrepant verdict puts on the rider's own number. */
export async function clearUserBlacklistForContact(contactNumber: string): Promise<number> {
  const [result] = await (await getPool()).execute<mysql.ResultSetHeader>(
    `UPDATE user_blacklist SET is_black_listed = 0 WHERE user_contact = ? AND is_black_listed = 1`,
    [contactNumber],
  );
  return result.affectedRows;
}

export async function closeDb(): Promise<void> {
  if (pool) await (await pool).end();
}
