// Hands the API layer a valid access token, refreshing GitHub App tokens transparently. Single in-flight refresh.
// A refresh result is committed only if the stored credential is still the one the refresh started from
// (sign-out or a newly saved PAT in the meantime must win), and only definitive auth failures clear credentials.
import { canRefresh, needsRefresh, toAuthRecord, type AuthRecord, type TokenResponse } from "../core/auth.ts";
import { GitHubApiError } from "./github-api.ts";

export type TokenManagerDeps = {
  getAuth: () => Promise<AuthRecord | null>;
  setAuth: (record: AuthRecord) => Promise<void>;
  clearAuth: () => Promise<void>;
  refresh: (refreshToken: string) => Promise<TokenResponse>;
  now?: () => number;
};

const sameCredential = (a: AuthRecord | null, b: AuthRecord): boolean =>
  a !== null && a.kind === b.kind && a.accessToken === b.accessToken && (a.kind !== "github-app" || b.kind !== "github-app" || a.refreshToken === b.refreshToken);

/** Network trouble, rate limits and server errors are transient: keep the credential and let the caller retry. */
function isDefinitiveAuthFailure(e: unknown): boolean {
  if (!(e instanceof GitHubApiError)) return false;
  return e.info.kind === "unauthorized" || e.info.kind === "forbidden";
}

export function createTokenManager(deps: TokenManagerDeps): { getAccessToken(): Promise<string | null> } {
  const now = deps.now ?? (() => Date.now());
  let inFlight: Promise<string> | null = null;

  async function refreshNow(record: AuthRecord & { kind: "github-app" }): Promise<string> {
    if (!canRefresh(record, now())) {
      if (sameCredential(await deps.getAuth(), record)) await deps.clearAuth();
      throw new GitHubApiError({ kind: "unauthorized", status: 0, message: "Your GitHub session expired. Sign in again." });
    }
    let token: TokenResponse;
    try {
      token = await deps.refresh(record.refreshToken as string);
    } catch (e) {
      const current = await deps.getAuth();
      if (isDefinitiveAuthFailure(e) && sameCredential(current, record)) await deps.clearAuth();
      throw e;
    }
    const current = await deps.getAuth();
    if (!sameCredential(current, record)) {
      // Auth changed while refreshing (sign-out, new PAT, another refresh): discard our result.
      if (current) return current.accessToken;
      throw new GitHubApiError({ kind: "unauthorized", status: 0, message: "Signed out." });
    }
    const next = toAuthRecord(token, now());
    await deps.setAuth(next);
    return next.accessToken;
  }

  return {
    async getAccessToken() {
      const record = await deps.getAuth();
      if (!record) return null;
      if (!needsRefresh(record, now())) return record.accessToken;
      if (record.kind !== "github-app") return record.accessToken;
      inFlight ??= refreshNow(record).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
