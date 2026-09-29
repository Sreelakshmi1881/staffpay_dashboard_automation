import { mkdirSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Lets only one worker at a time go through OTP login for a number. Two logins
 * for the same number at once each request an OTP, and one reads the other's
 * and fails. mkdir is atomic, so the directory itself is the lock.
 * A lock older than STALE_MS is from a killed run and is taken over.
 */
const STALE_MS = 90_000;

export async function withLoginLock<T>(contactNumber: string, fn: () => Promise<T>): Promise<T> {
  const lock = join(tmpdir(), `staffpay-login-${contactNumber}.lock`);

  while (true) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > STALE_MS) rmSync(lock, { recursive: true, force: true });
      } catch {
        // released between the two calls - just try again
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }

  try {
    return await fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
