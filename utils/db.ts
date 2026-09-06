import mysql from 'mysql2/promise';
import { config } from './config';

// One shared pool for the whole run, rather than a new connection per query.
const pool = mysql.createPool({
  ...config.db,
  connectionLimit: 5,
  ssl: { rejectUnauthorized: false },
});

/**
 * Latest un-validated StaffPay OTP for a number.
 * ORDER BY id DESC plus the status filter matter - without them you get a
 * stale OTP the moment a number requests a second one.
 */
export async function getStaffPayOtp(contactNumber: string): Promise<string> {
  const sql = `SELECT otp FROM otp_details
               WHERE contact_number = ?
                 AND event_type = 'STAFFPAY'
                 AND status != 'OTP_VALIDATED'
               ORDER BY id DESC
               LIMIT 1`;

  const [rows] = await pool.execute<any[]>(sql, [contactNumber]);
  const otp = rows[0]?.otp;
  if (!otp) throw new Error(`No OTP found for ${contactNumber}`);
  return String(otp);
}

export async function closeDb(): Promise<void> {
  await pool.end();
}