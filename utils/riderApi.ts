import { APIRequestContext, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { getStaffPayOtp } from './db';

const BASE_URL = 'https://api-staging.staffpay.in';

/**
 * Headers the rider app sends. Location is the Amazon test hub (HSR Layout);
 * the API only needs it to be present.
 */
const RIDER_APP_HEADERS = {
  accept: 'application/json',
  'content-type': 'application/json',
  source: 'RiderApp',
  // Staging rejects old app versions on sendOtp ("Please update the Rider app
  // to the latest version") - 12.33 and below were refused on 2026-10-16.
  // Override with RIDER_APP_VERSION / RIDER_APP_BUILD when staging moves again.
  appv: process.env.RIDER_APP_VERSION ?? '12.34',
  appbuild: process.env.RIDER_APP_BUILD ?? '345',
  omsbroker: 'HERMES',
  vendorname: 'AMAZON',
  lat: '12.9185',
  lng: '77.6491',
};

/** AuthBridge court-case severities the webhook is exercised with. */
export type CourtCaseResult = 'Clear' | 'Discrepant' | 'Insufficient' | 'Attention Required';

/** Body of POST /de/user/fullProfile/save - the rider app's profile screen. */
export interface RiderProfile {
  name: string;
  contactNumber: string;
  /** e.g. "15-Jan-1995" */
  dob: string;
  /** An image in the earn-de-docs bucket - from uploadImage(). */
  s3ProfileLink: string;
  address: string;
  pincode: string;
  emergencyContactName: string;
  emergencyContactNumber: string;
}

/**
 * Acts as a rider through the rider-app API - the parts of onboarding the
 * vendor dashboard can't do, like the rider's own profile picture.
 * Logs in the way the app does: OTP to the rider's number, read back from
 * otp_details (event_type RIDERAPP), then /auth/login. Mirrors
 * titanautomation's SelfieUploadAPI. Never reuse a token from a pasted curl.
 */
export class RiderApi {
  private token?: string;
  private userId?: string;

  constructor(private readonly request: APIRequestContext) {}

  async login(contactNumber: string): Promise<void> {
    const sent = await this.request.get(`${BASE_URL}/auth/sendOtp/${contactNumber}`, {
      headers: RIDER_APP_HEADERS,
      params: { source: 'RiderApp', paramType: 'installParams', latitude: '12.9185', longitude: '77.6491' },
    });
    const sentBody = await this.ok(sent, 'sendOtp');

    const otp = await getStaffPayOtp(contactNumber, 15_000, 'RIDERAPP');
    const loggedIn = await this.request.post(`${BASE_URL}/auth/login`, {
      headers: RIDER_APP_HEADERS,
      data: {
        number: contactNumber,
        otp,
        loginFrom: 'RiderApp',
        referenceId: sentBody.response?.referenceId,
        latitude: 12.9185,
        longitude: 77.6491,
      },
    });
    const body = await this.ok(loggedIn, 'login');
    this.token = body.response.token;
    this.userId = String(body.response.userBO?.id ?? '');
  }

  /**
   * Gets the rider's token without the app's OTP login, the way titanautomation
   * does (TitanAPI.generateToken, fixtures/generate_token.json): POST
   * /auth/generate-token with the rider's user id and number. Staging refuses
   * scripted /auth/sendOtp ("Please update the Rider app"), whatever appv is sent.
   */
  async useGeneratedToken(userId: string | number, contactNumber: string): Promise<void> {
    const res = await this.request.post(`${BASE_URL}/auth/generate-token`, {
      headers: { 'Content-Type': 'application/json' },
      data: { userId: String(userId), leadId: 0, contactNumber },
    });
    const body = await this.ok(res, 'generate-token');
    this.token = body.response.token;
    this.userId = String(userId);
  }

  /**
   * Uploads an image the way the apps do: GET /orgs/presigned-urls for a
   * signed S3 PUT URL, PUT the file there, and use the URL without its query
   * string as the image link. The server picks the S3 key itself.
   * Returns the image link.
   */
  async uploadImage(filePath: string): Promise<string> {
    expect(this.token, 'call login() first').toBeTruthy();
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const contentType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;

    const signed = await this.request.get(`${BASE_URL}/orgs/presigned-urls`, {
      headers: { ...RIDER_APP_HEADERS, authtoken: this.token! },
      params: { fileName: path.basename(filePath, path.extname(filePath)), fileType: ext, contentType },
    });
    const presignedUrl: string = (await this.ok(signed, 'presigned-urls')).response.presignedUrl;
    expect(presignedUrl, 'presigned-urls returned no presignedUrl').toBeTruthy();

    // Straight to S3 - no app headers, only the content type it was signed for.
    const put = await this.request.put(presignedUrl, {
      headers: { 'Content-Type': contentType },
      data: fs.readFileSync(filePath),
    });
    expect(put.status(), 'PUT to S3').toBe(200);
    return presignedUrl.split('?')[0];
  }

  /** Saves the rider's profile, including the profile picture link. */
  async saveFullProfile(profile: RiderProfile): Promise<void> {
    expect(this.token, 'call login() first').toBeTruthy();
    const saved = await this.request.post(`${BASE_URL}/de/user/fullProfile/save`, {
      headers: { ...RIDER_APP_HEADERS, authtoken: this.token!, userid: this.userId! },
      data: { vehicleNumber: '', cityId: 0, secondaryContactNumber: '', ...profile },
    });
    await this.ok(saved, 'fullProfile/save');
  }

  /**
   * The rider-app KYC selfie step (POST /de/user/kyc, step SELFIE_UPLOAD) -
   * what makes the image show under "Selfie" on the vendor portal's staff
   * detail page. Moves the SELFIE row in entity_documents (created by
   * fullProfile/save) to PENDING_APPROVAL. Body as titanautomation's
   * fixtures/titan/selfie_upload.json.
   */
  async uploadKycSelfie(imageLink: string): Promise<void> {
    expect(this.token, 'call login() first').toBeTruthy();
    const saved = await this.request.post(`${BASE_URL}/de/user/kyc`, {
      headers: { ...RIDER_APP_HEADERS, authtoken: this.token!, userid: this.userId! },
      data: {
        selfie: {
          image: imageLink,
          imageFront: imageLink,
          imageBack: null,
          autoKycBroker: 'HYPERVERGE',
          manualVerificationRequired: false,
          autoKycMetadata: {},
          panVerified: false,
          linked: false,
          verified: false,
          inputErrors: {},
          step: 'SELFIE_UPLOAD',
          kycBroker: 'HYPERVERGE',
        },
        kycBroker: 'HYPERVERGE',
        screenName: 'SSUP_KYC_SCREEN',
        step: 'SELFIE_UPLOAD',
      },
    });
    await this.ok(saved, 'kyc SELFIE_UPLOAD');
  }

  /** The API reports failures as HTTP 200 with status.code in the body. */
  private async ok(response: Awaited<ReturnType<APIRequestContext['get']>>, call: string) {
    expect(response.ok(), `${call}: HTTP ${response.status()}`).toBe(true);
    const body = await response.json();
    expect(body?.status?.code, `${call}: ${body?.status?.message}`).toBe(200);
    return body;
  }
}
