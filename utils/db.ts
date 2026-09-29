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

/**
 * Latest un-validated StaffPay OTP for a number.
 * ORDER BY id DESC plus the status filter matter - without them you get a
 * stale OTP the moment a number requests a second one.
 * Polls because the row can land a few seconds after "Get OTP" is clicked.
 */
export async function getStaffPayOtp(contactNumber: string, timeoutMs = 15_000): Promise<string> {
  const sql = `SELECT otp FROM otp_details
               WHERE contact_number = ?
                 AND event_type = 'STAFFPAY'
                 AND status != 'OTP_VALIDATED'
               ORDER BY id DESC
               LIMIT 1`;

  const deadline = Date.now() + timeoutMs;
  while (true) {
    const [rows] = await (await getPool()).execute<any[]>(sql, [contactNumber]);
    const otp = rows[0]?.otp;
    if (otp) return String(otp);
    if (Date.now() > deadline) throw new Error(`No OTP found for ${contactNumber} after ${timeoutMs / 1000}s`);
    await new Promise(r => setTimeout(r, 1000));
  }
}

export async function closeDb(): Promise<void> {
  if (pool) await (await pool).end();
}