// Pure types and helpers for authentication state and GitHub's OAuth device flow. No chrome.* / fetch here.

export type AuthRecord =
  | { kind: "pat"; accessToken: string }
  | { kind: "github-app"; accessToken: string; refreshToken: string | null; expiresAt: number | null; refreshExpiresAt: number | null };

export type DeviceCodeResponse = { deviceCode: string; userCode: string; verificationUri: string; expiresIn: number; interval: number };

export type TokenResponse = {
  access_token: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
};

export type PollResult =
  | { kind: "pending"; interval: number }
  | { kind: "token"; token: TokenResponse }
  | { kind: "error"; code: string; message: string };

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null);

export function parseDeviceCodeResponse(json: unknown): DeviceCodeResponse {
  const r = obj(json);
  const deviceCode = r?.["device_code"];
  const userCode = r?.["user_code"];
  const verificationUri = r?.["verification_uri"];
  if (typeof deviceCode !== "string" || typeof userCode !== "string" || typeof verificationUri !== "string") {
    const err = r?.["error_description"] ?? r?.["error"];
    throw new Error(typeof err === "string" ? err : "Unexpected response from GitHub device authorization.");
  }
  const expiresIn = typeof r?.["expires_in"] === "number" ? (r["expires_in"] as number) : 900;
  const interval = typeof r?.["interval"] === "number" ? (r["interval"] as number) : 5;
  return { deviceCode, userCode, verificationUri, expiresIn, interval: Math.max(1, interval) };
}

export const DEVICE_ERROR_MESSAGES: Record<string, string> = {
  expired_token: "The code expired before it was entered. Start again.",
  access_denied: "You cancelled the authorization on GitHub.",
  device_flow_disabled: "Device flow is disabled for this GitHub App.",
  incorrect_device_code: "GitHub did not recognise the device code. Start again.",
  incorrect_client_credentials: "GitHub rejected the app's client ID.",
  unsupported_grant_type: "GitHub rejected the grant type.",
};

/** GitHub answers polling requests with `{error: ...}` (often HTTP 200) until the user authorizes. */
export function parseTokenPollResponse(json: unknown, currentInterval: number): PollResult {
  const r = obj(json);
  const error = r?.["error"];
  if (typeof error === "string") {
    if (error === "authorization_pending") return { kind: "pending", interval: currentInterval };
    if (error === "slow_down") return { kind: "pending", interval: currentInterval + 5 }; // per GitHub docs: add 5 seconds
    const desc = r?.["error_description"];
    return { kind: "error", code: error, message: DEVICE_ERROR_MESSAGES[error] ?? (typeof desc === "string" ? desc : `GitHub returned "${error}".`) };
  }
  const accessToken = r?.["access_token"];
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return { kind: "error", code: "invalid_response", message: "Unexpected response from GitHub while waiting for authorization." };
  }
  const token: TokenResponse = { access_token: accessToken };
  if (typeof r?.["token_type"] === "string") token.token_type = r["token_type"] as string;
  if (typeof r?.["scope"] === "string") token.scope = r["scope"] as string;
  if (typeof r?.["expires_in"] === "number") token.expires_in = r["expires_in"] as number;
  if (typeof r?.["refresh_token"] === "string") token.refresh_token = r["refresh_token"] as string;
  if (typeof r?.["refresh_token_expires_in"] === "number") token.refresh_token_expires_in = r["refresh_token_expires_in"] as number;
  return { kind: "token", token };
}

export function toAuthRecord(token: TokenResponse, now: number): AuthRecord {
  return {
    kind: "github-app",
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: token.expires_in !== undefined ? now + token.expires_in * 1000 : null,
    refreshExpiresAt: token.refresh_token_expires_in !== undefined ? now + token.refresh_token_expires_in * 1000 : null,
  };
}

/** Refresh a little early so a request never goes out with a token that dies in flight. */
export const REFRESH_SKEW_MS = 60_000;

export function needsRefresh(record: AuthRecord, now: number): boolean {
  return record.kind === "github-app" && record.expiresAt !== null && record.expiresAt - REFRESH_SKEW_MS <= now;
}

export function canRefresh(record: AuthRecord, now: number): boolean {
  return record.kind === "github-app" && record.refreshToken !== null && (record.refreshExpiresAt === null || record.refreshExpiresAt > now);
}
