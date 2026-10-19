import { mkdirSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Cross-worker locks. mkdir is atomic, so the directory itself is the lock.
 * A lock older than its stale time is from a killed run and is taken over.
 */
const lockPath = (name: string) => join(tmpdir(), `staffpay-${name}.lock`);

export async function acquireLock(name: string, staleMs: number): Promise<void> {
  const lock = lockPath(name);
  while (true) {
    try {
      mkdirSync(lock);
      return;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > staleMs) rmSync(lock, { recursive: true, force: true });
      } catch {
        // released between the two calls - just try again
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

export function releaseLock(name: string): void {
  rmSync(lockPath(name), { recursive: true, force: true });
}

/**
 * Lets only one worker at a time go through OTP login for a number. Two logins
 * for the same number at once each request an OTP, and one reads the other's
 * and fails.
 */
export async function withLoginLock<T>(contactNumber: string, fn: () => Promise<T>): Promise<T> {
  const name = `login-${contactNumber}`;
  await acquireLock(name, 90_000);
  try {
    return await fn();
  } finally {
    releaseLock(name);
  }
}

/**
 * The Amazon KYC tests all save the same fixed staging Aadhaar / PAN, and a
 * number held by one rider is rejected for the next - so only one of them may
 * run at a time, from first save to cleanup. Taken in beforeAll, released in
 * afterAll after the cleanup. Stale after 15 minutes (a killed run).
 */
export const KYC_NUMBERS_LOCK = 'kyc-test-numbers';
export const acquireKycNumbersLock = () => acquireLock(KYC_NUMBERS_LOCK, 15 * 60_000);
export const releaseKycNumbersLock = () => releaseLock(KYC_NUMBERS_LOCK);
