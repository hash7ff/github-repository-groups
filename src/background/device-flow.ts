// GitHub OAuth device flow for the Repository Groups GitHub App. No client secret exists anywhere in this extension:
// device-flow tokens can be refreshed with the client ID alone (GitHub docs, verified 2026-09-03).
import { parseDeviceCodeResponse, parseTokenPollResponse, type DeviceCodeResponse, type PollResult, type TokenResponse } from "../core/auth.ts";
import { GitHubApiError, type FetchLike } from "./github-api.ts";

export const DEVICE_CODE_URL = "https://github.com/login/device/code";
export const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

export type DeviceFlowDeps = { clientId: string; fetchImpl?: FetchLike };

async function postForm(deps: DeviceFlowDeps, url: string, params: Record<string, string>): Promise<unknown> {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
  } catch (e) {
    throw new GitHubApiError({ kind: "network", status: 0, message: `Network error: ${e instanceof Error ? e.message : String(e)}` });
  }
  try {
    return await res.json();
  } catch {
    throw new GitHubApiError({ kind: "other", status: res.status, message: `Unexpected non-JSON response from GitHub (HTTP ${res.status}).` });
  }
}

export async function requestDeviceCode(deps: DeviceFlowDeps): Promise<DeviceCodeResponse> {
  const json = await postForm(deps, DEVICE_CODE_URL, { client_id: deps.clientId });
  try {
    return parseDeviceCodeResponse(json);
  } catch (e) {
    throw new GitHubApiError({ kind: "other", status: 0, message: e instanceof Error ? e.message : String(e) });
  }
}

/** One poll. The caller (options page) owns the timing so the service worker never has to stay alive. */
export async function pollDeviceToken(deps: DeviceFlowDeps, deviceCode: string, currentInterval: number): Promise<PollResult> {
  const json = await postForm(deps, ACCESS_TOKEN_URL, { client_id: deps.clientId, device_code: deviceCode, grant_type: DEVICE_GRANT_TYPE });
  return parseTokenPollResponse(json, currentInterval);
}

export async function refreshAccessToken(deps: DeviceFlowDeps, refreshToken: string): Promise<TokenResponse> {
  const json = await postForm(deps, ACCESS_TOKEN_URL, { client_id: deps.clientId, grant_type: "refresh_token", refresh_token: refreshToken });
  const parsed = parseTokenPollResponse(json, 0);
  if (parsed.kind !== "token") {
    const message = parsed.kind === "error" ? parsed.message : "Unexpected refresh response.";
    throw new GitHubApiError({ kind: "unauthorized", status: 0, message: `Could not refresh the GitHub session: ${message}` });
  }
  return parsed.token;
}
