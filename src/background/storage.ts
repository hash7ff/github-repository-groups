// Thin adapter over chrome.storage. The token lives ONLY here (local) and is read ONLY by the service worker.
import type { RepoSummary } from "../core/types.ts";
import type { AuthRecord } from "../core/auth.ts";

const AUTH_KEY = "gtf.auth";
const LEGACY_TOKEN_KEY = "gtf.token"; // pre-M4.5 installs stored a bare PAT here
const LOGIN_KEY = "gtf.login";
const FLOW_KEY = "gtf.deviceflow";
const ACCOUNTS_KEY = "gtf.installedAccounts";
const repoCacheKey = (owner: string): string => `gtf.cache.repos.${owner.toLowerCase()}`;

export type RepoCache = { repos: RepoSummary[]; fetchedAt: number };
export type DeviceFlowState = { flowId: string; deviceCode: string; interval: number; expiresAt: number };

export async function getAuth(): Promise<AuthRecord | null> {
  const r = await chrome.storage.local.get([AUTH_KEY, LEGACY_TOKEN_KEY]);
  const a = r[AUTH_KEY] as AuthRecord | undefined;
  if (a && typeof a.accessToken === "string" && a.accessToken.length > 0 && (a.kind === "pat" || a.kind === "github-app")) return a;
  const legacy = r[LEGACY_TOKEN_KEY];
  if (typeof legacy === "string" && legacy.length > 0) {
    const migrated: AuthRecord = { kind: "pat", accessToken: legacy };
    await chrome.storage.local.set({ [AUTH_KEY]: migrated });
    await chrome.storage.local.remove(LEGACY_TOKEN_KEY);
    return migrated;
  }
  return null;
}
export async function setAuth(record: AuthRecord): Promise<void> {
  await chrome.storage.local.set({ [AUTH_KEY]: record });
  await chrome.storage.local.remove(LEGACY_TOKEN_KEY);
}
export async function clearAuth(): Promise<void> {
  await chrome.storage.local.remove([AUTH_KEY, LEGACY_TOKEN_KEY]);
  await clearSession();
}

export async function getDeviceFlow(): Promise<DeviceFlowState | null> {
  const r = await chrome.storage.session.get(FLOW_KEY);
  const v = r[FLOW_KEY] as DeviceFlowState | undefined;
  return v && typeof v.deviceCode === "string" ? v : null;
}
export async function setDeviceFlow(state: DeviceFlowState | null): Promise<void> {
  if (state) await chrome.storage.session.set({ [FLOW_KEY]: state });
  else await chrome.storage.session.remove(FLOW_KEY);
}

export async function getLogin(): Promise<string | null> {
  const r = await chrome.storage.session.get(LOGIN_KEY);
  const v = r[LOGIN_KEY];
  return typeof v === "string" && v.length > 0 ? v : null;
}
export async function setLogin(login: string): Promise<void> {
  await chrome.storage.session.set({ [LOGIN_KEY]: login });
}

export async function getInstalledAccounts(): Promise<string[] | null> {
  const r = await chrome.storage.session.get(ACCOUNTS_KEY);
  const v = r[ACCOUNTS_KEY];
  return Array.isArray(v) ? (v as string[]) : null;
}
export async function setInstalledAccounts(accounts: string[]): Promise<void> {
  await chrome.storage.session.set({ [ACCOUNTS_KEY]: accounts });
}

export async function getRepoCache(owner: string): Promise<RepoCache | null> {
  const key = repoCacheKey(owner);
  const r = await chrome.storage.session.get(key);
  const v = r[key] as RepoCache | undefined;
  return v && Array.isArray(v.repos) && typeof v.fetchedAt === "number" ? v : null;
}
export async function setRepoCache(owner: string, cache: RepoCache): Promise<void> {
  await chrome.storage.session.set({ [repoCacheKey(owner)]: cache });
}
export async function clearSession(): Promise<void> {
  await chrome.storage.session.clear();
}

// ---- UI preferences (not secrets, not groups) ----
import { DEFAULT_PREFS, type Prefs } from "../core/messages.ts";
const PREFS_KEY = "gtf.prefs";
const LEGACY_LOCAL_KEYS = ["gtf.journal"]; // topic-write journal from versions that wrote to GitHub

export async function getPrefs(): Promise<Prefs> {
  const r = await chrome.storage.local.get(PREFS_KEY);
  const v = (r[PREFS_KEY] ?? {}) as Partial<Prefs>;
  return {
    viewMode: v.viewMode === "original" ? "original" : "grouped",
    collapsed: typeof v.collapsed === "object" && v.collapsed !== null ? v.collapsed : {},
  };
}
export async function setPrefs(patch: Partial<Prefs>): Promise<Prefs> {
  const current = await getPrefs();
  const next: Prefs = {
    ...DEFAULT_PREFS,
    viewMode: patch.viewMode === "original" || patch.viewMode === "grouped" ? patch.viewMode : current.viewMode,
    collapsed: typeof patch.collapsed === "object" && patch.collapsed !== null ? patch.collapsed : current.collapsed,
  };
  await chrome.storage.local.set({ [PREFS_KEY]: next });
  return next;
}
export async function removeLegacyData(): Promise<void> {
  await chrome.storage.local.remove(LEGACY_LOCAL_KEYS);
}

// ---- groups: chrome.storage.sync ----
// Follows the user's Chrome sync, so the groups come back on another computer signed in to the same Google account.
// With sync off, Chrome keeps the area on this device only (it then behaves like storage.local).
import { decodeOwner, encodeOwner, groupKeysIn, metaChunks, metaKey, ownersIn, staleChunkKeys } from "../core/syncLayout.ts";
import type { OwnerGroups } from "../core/groupState.ts";

export async function getOwnerGroups(owner: string): Promise<OwnerGroups> {
  return decodeOwner(owner, await chrome.storage.sync.get(null));
}

export async function setOwnerGroups(owner: string, state: OwnerGroups): Promise<void> {
  const before = metaChunks(owner, await chrome.storage.sync.get(null));
  if (state.groups.length === 0 && Object.keys(state.assign).length === 0) {
    await chrome.storage.sync.remove([metaKey(owner), ...staleChunkKeys(owner, before, 0)]);
    return;
  }
  const encoded = encodeOwner(owner, state);
  if (!encoded.ok) throw new Error(encoded.error);
  await chrome.storage.sync.set(encoded.items); // the meta item is written with its chunks, in one call
  const stale = staleChunkKeys(owner, before, encoded.chunks);
  if (stale.length > 0) await chrome.storage.sync.remove(stale);
}

export async function allOwnerGroups(): Promise<Record<string, OwnerGroups>> {
  const items = await chrome.storage.sync.get(null);
  return Object.fromEntries(ownersIn(items).map((owner) => [owner, decodeOwner(owner, items)]));
}

/** Removes every group of every account (in this browser, and through Chrome sync on the user's other computers). */
export async function clearAllGroups(): Promise<number> {
  const items = await chrome.storage.sync.get(null);
  const owners = ownersIn(items).length;
  const keys = groupKeysIn(items);
  if (keys.length > 0) await chrome.storage.sync.remove(keys);
  return owners;
}

export async function groupsBytesInUse(): Promise<number> {
  return chrome.storage.sync.getBytesInUse(null);
}
