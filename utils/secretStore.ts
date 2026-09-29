import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

/**
 * Reads DB credentials from AWS Secrets Manager - the same secret and key names
 * titanautomation's SecretStore.java uses, so both suites share one source.
 *
 * Lookup order per key:
 *   1. an environment variable of the same name (e.g. titan_password=... npx playwright test)
 *   2. ~/.titanautomation-secrets.json - a developer machine without AWS access
 *   3. the Secrets Manager secret
 * Values are fetched once per worker process.
 */
const SECRET_ID = process.env.AWS_SECRET_ID ?? 'secret/application/titanautomation-staging';
const REGION = process.env.AWS_SECRET_REGION ?? 'ap-south-1';
// Kept outside the repo so it cannot be committed; keep it chmod 600.
const LOCAL_FILE = process.env.SECRETS_FILE ?? join(homedir(), '.titanautomation-secrets.json');

let cache: Promise<Record<string, string>> | undefined;

export async function getSecret(key: string): Promise<string> {
  const override = process.env[key];
  if (override?.trim()) return override;

  const value = (await load())[key];
  if (!value?.trim()) {
    throw new Error(
      `Secret '${key}' not found in ${SECRET_ID} or ${LOCAL_FILE}. ` +
        `Add it to one of those, or set ${key}=<value> in the environment for a local run.`,
    );
  }
  return value;
}

function load(): Promise<Record<string, string>> {
  cache ??= fetchSecrets();
  return cache;
}

async function fetchSecrets(): Promise<Record<string, string>> {
  // A local file wins: it only exists on a developer machine, and checking it
  // first skips the AWS round trip.
  if (existsSync(LOCAL_FILE)) {
    try {
      return JSON.parse(readFileSync(LOCAL_FILE, 'utf8'));
    } catch (e) {
      throw new Error(`Found ${LOCAL_FILE} but could not read it as JSON: ${e}`);
    }
  }

  try {
    const client = new SecretsManagerClient({ region: REGION });
    const { SecretString } = await client.send(new GetSecretValueCommand({ SecretId: SECRET_ID }));
    return JSON.parse(SecretString ?? '{}');
  } catch (e) {
    // Usually missing secretsmanager:GetSecretValue on this secret, which the
    // SDK's own AccessDenied does not make obvious.
    throw new Error(
      `Could not read ${SECRET_ID} from AWS Secrets Manager in ${REGION}. Check this machine's ` +
        `AWS credentials carry secretsmanager:GetSecretValue on it. Cause: ${e}`,
    );
  }
}
