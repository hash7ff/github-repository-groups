// Service worker: the only place that holds GitHub credentials or talks to GitHub.
// Holds no in-memory state (MV3 workers are stopped at any time); everything lives in chrome.storage.
import { createGitHubApi, GitHubApiError } from "./github-api.ts";
import { pollDeviceToken, refreshAccessToken, requestDeviceCode } from "./device-flow.ts";
import { createTokenManager } from "./token-manager.ts";
import * as storage from "./storage.ts";
import { toAuthRecord } from "../core/auth.ts";
import { GITHUB_APP_CLIENT_ID, GITHUB_APP_ID, GITHUB_APP_INSTALL_URL, GITHUB_APP_NAME } from "../core/config.ts";
import { fail, ok, type AuthStatus, type DevicePoll, type DeviceStart, type GroupsUsage, type ImportSummary, type InstallationsStatus, type ReposList, type Request, type Response as MsgResponse } from "../core/messages.ts";
import { applyOps, buildExport, parseImport, parseOps, type OwnerGroups } from "../core/groupState.ts";
import { SYNC_TOTAL_BYTES } from "../core/syncLayout.ts";
import type { ApiErrorInfo } from "../core/types.ts";

const CACHE_TTL_MS = 5 * 60 * 1000;

// Credentials live in storage.local; by default Chrome exposes that area to content scripts. Restrict it to
// trusted contexts (service worker + extension pages) so the content script on github.com cannot read tokens.
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {
  /* older Chrome: fall back to the build-time isolation check */
});

// ---- sender trust ----
type SenderKind = "options" | "content" | "unknown";
function classifySender(sender: chrome.runtime.MessageSender): SenderKind {
  if (sender.id !== chrome.runtime.id) return "unknown";
  const url = sender.url ?? "";
  if (url.startsWith(chrome.runtime.getURL("options.html"))) return "options";
  if (sender.tab && /^https:\/\/github\.com\//.test(url)) return "content";
  return "unknown";
}
/** Credential operations and whole-store import/export are only accepted from the extension's own options page. */
const OPTIONS_ONLY = new Set<Request["type"]>(["auth.setToken", "auth.clear", "auth.deviceStart", "auth.devicePoll", "auth.installations", "groups.export", "groups.import", "groups.usage", "groups.clear"]);
const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
const isName = (v: unknown): v is string => typeof v === "string" && NAME_PATTERN.test(v);
const deviceFlowDeps = { clientId: GITHUB_APP_CLIENT_ID };
const tokens = createTokenManager({
  getAuth: storage.getAuth,
  setAuth: storage.setAuth,
  clearAuth: storage.clearAuth,
  refresh: (rt) => refreshAccessToken(deviceFlowDeps, rt),
});
const api = createGitHubApi({ getToken: tokens.getAccessToken });

/** Match installations by the app's numeric id: it survives renames, the slug does not. */
const isOurs = (i: { appId: number; appSlug: string | null }): boolean =>
  i.appId === GITHUB_APP_ID || (i.appId === 0 && i.appSlug === null);

function toErrorInfo(e: unknown): ApiErrorInfo {
  if (e instanceof GitHubApiError) return e.info;
  return { kind: "other", status: 0, message: e instanceof Error ? e.message : String(e) };
}

async function resolveLogin(): Promise<string> {
  const cached = await storage.getLogin();
  if (cached) return cached;
  const { login } = await api.whoami();
  await storage.setLogin(login);
  return login;
}

async function authStatus(): Promise<MsgResponse<AuthStatus>> {
  const auth = await storage.getAuth();
  if (!auth) return ok({ configured: false, login: null, kind: null });
  return ok({ configured: true, login: await resolveLogin(), kind: auth.kind });
}

/** Advanced fallback: a personal access token. Validated BEFORE saving so a bad token never replaces a working session. */
async function setPat(rawToken: string): Promise<MsgResponse<AuthStatus>> {
  const token = rawToken.trim();
  if (!token) return fail({ kind: "validation", status: 0, message: "Token is empty." });
  const probe = createGitHubApi({ getToken: async () => token });
  const { login } = await probe.whoami();
  await storage.setAuth({ kind: "pat", accessToken: token });
  await storage.clearSession();
  await storage.setLogin(login);
  return ok({ configured: true, login, kind: "pat" });
}

async function deviceStart(): Promise<MsgResponse<DeviceStart>> {
  const code = await requestDeviceCode(deviceFlowDeps);
  const flowId = crypto.randomUUID();
  await storage.setDeviceFlow({ flowId, deviceCode: code.deviceCode, interval: code.interval, expiresAt: Date.now() + code.expiresIn * 1000 });
  // The device code stays in the worker; the page only gets what the user must see.
  return ok({ flowId, userCode: code.userCode, verificationUri: code.verificationUri, expiresIn: code.expiresIn, interval: code.interval });
}

async function devicePoll(flowId: string): Promise<MsgResponse<DevicePoll>> {
  const flow = await storage.getDeviceFlow();
  if (!flow || flow.flowId !== flowId) return fail({ kind: "other", status: 0, message: "This sign-in attempt is no longer active. Start again." });
  if (Date.now() > flow.expiresAt) {
    await storage.setDeviceFlow(null);
    return fail({ kind: "other", status: 0, message: "The code expired before it was entered. Start again." });
  }
  const result = await pollDeviceToken(deviceFlowDeps, flow.deviceCode, flow.interval);
  if (result.kind === "pending") {
    if (result.interval !== flow.interval) await storage.setDeviceFlow({ ...flow, interval: result.interval });
    return ok({ done: false, interval: result.interval });
  }
  await storage.setDeviceFlow(null);
  if (result.kind === "error") return fail({ kind: result.code === "access_denied" ? "unauthorized" : "other", status: 0, message: result.message });
  await storage.setAuth(toAuthRecord(result.token, Date.now()));
  await storage.clearSession();
  const { login } = await api.whoami();
  await storage.setLogin(login);
  return ok({ done: true, login });
}

/** Accounts (the user plus organizations) where our GitHub App is installed. Cached for the session. */
async function installedAccounts(force = false): Promise<string[]> {
  if (!force) {
    const cached = await storage.getInstalledAccounts();
    if (cached) return cached;
  }
  const accounts = (await api.listInstallations())
    .filter(isOurs)
    .map((i) => (i.account ?? "").toLowerCase())
    .filter((a) => a !== "");
  await storage.setInstalledAccounts(accounts);
  return accounts;
}

/**
 * Decides whether we may act on `owner`'s repositories: either it is the signed-in user, or it is an account
 * (typically an organization) where the app is installed. A personal access token is not installation-scoped,
 * so it is allowed to reach organizations directly.
 */
async function resolveTarget(owner: string): Promise<{ kind: "user" | "org" } | ApiErrorInfo> {
  const login = await resolveLogin();
  if (owner.toLowerCase() === login.toLowerCase()) return { kind: "user" };
  const auth = await storage.getAuth();
  if (auth?.kind === "pat") return { kind: "org" };
  const accounts = await installedAccounts();
  if (accounts.includes(owner.toLowerCase())) return { kind: "org" };
  const fresh = await installedAccounts(true); // the user may have just installed it
  if (fresh.includes(owner.toLowerCase())) return { kind: "org" };
  return {
    kind: "not_installed",
    status: 0,
    message: `The ${GITHUB_APP_NAME} app is not installed on ${owner}.`,
    installUrl: GITHUB_APP_INSTALL_URL,
  };
}

async function installations(): Promise<MsgResponse<InstallationsStatus>> {
  const auth = await storage.getAuth();
  if (!auth) return fail({ kind: "unauthorized", status: 0, message: "Not signed in." });
  if (auth.kind === "pat") return ok({ installed: true, count: 0, repositorySelection: null, installUrl: GITHUB_APP_INSTALL_URL });
  const mine = (await api.listInstallations()).filter(isOurs);
  return ok({ installed: mine.length > 0, count: mine.length, repositorySelection: mine[0]?.repositorySelection ?? null, installUrl: GITHUB_APP_INSTALL_URL });
}

async function listRepos(owner: string, force: boolean): Promise<MsgResponse<ReposList>> {
  const login = await resolveLogin();
  const target = await resolveTarget(owner);
  if ("message" in target) return fail(target);
  const cache = await storage.getRepoCache(owner);
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return ok({ owner, login, repos: cache.repos, fetchedAt: cache.fetchedAt, fromCache: true });
  }
  const repos = target.kind === "user" ? await api.listOwnRepos() : await api.listOrgRepos(owner);
  if (repos.length === 0 && target.kind === "user") {
    // A GitHub App token only sees repositories the app is installed on: an empty list usually means "not installed yet".
    const auth = await storage.getAuth();
    if (auth?.kind === "github-app") {
      const inst = await installations();
      if (inst.ok && !inst.data.installed) {
        return fail({ kind: "not_installed", status: 0, message: `The ${GITHUB_APP_NAME} app is not installed on your repositories yet.`, installUrl: GITHUB_APP_INSTALL_URL });
      }
    }
  }
  const fetchedAt = Date.now();
  await storage.setRepoCache(owner, { repos, fetchedAt });
  return ok({ owner, login, repos, fetchedAt, fromCache: false });
}

// ---- groups (stored in chrome.storage.sync; nothing is ever written to GitHub) ----

/** Group changes run one at a time, so two tabs editing at once cannot lose each other's change. */
let groupChain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = groupChain.then(fn);
  groupChain = run.catch(() => undefined);
  return run;
}

/** Chrome reports sync quota problems as plain errors; turn them into something a person can act on. */
function storageErrorInfo(e: unknown): ApiErrorInfo {
  const message = e instanceof Error ? e.message : String(e);
  if (/MAX_WRITE_OPERATIONS/.test(message)) return { kind: "rate_limited", status: 0, message: "Too many changes in a short time. Wait a minute and try again." };
  if (/QUOTA/.test(message)) return { kind: "other", status: 0, message: "Chrome sync storage for this extension is full. Export your groups from the settings page, then remove groups you no longer need." };
  return { kind: "other", status: 0, message };
}

async function applyGroupOps(owner: string, rawOps: unknown): Promise<MsgResponse<OwnerGroups>> {
  const ops = parseOps(rawOps);
  if (!ops) return fail({ kind: "validation", status: 0, message: "Invalid group change." });
  return serialized(async () => {
    const applied = applyOps(await storage.getOwnerGroups(owner), ops);
    if (!applied.ok) return fail({ kind: "validation", status: 0, message: applied.error });
    try {
      await storage.setOwnerGroups(owner, applied.state);
    } catch (e) {
      return fail(storageErrorInfo(e));
    }
    return ok(applied.state);
  });
}

/** Replaces the groups of every account in the file; accounts not in the file are left as they are. */
async function importGroups(file: unknown): Promise<MsgResponse<ImportSummary>> {
  const parsed = parseImport(file);
  if (!parsed.ok) return fail({ kind: "validation", status: 0, message: parsed.error });
  return serialized(async () => {
    let groups = 0;
    let repositories = 0;
    try {
      for (const [owner, state] of Object.entries(parsed.owners)) {
        await storage.setOwnerGroups(owner, state);
        groups += state.groups.length;
        repositories += Object.keys(state.assign).length;
      }
    } catch (e) {
      return fail(storageErrorInfo(e));
    }
    return ok({ owners: Object.keys(parsed.owners).length, groups, repositories });
  });
}

async function groupsUsage(): Promise<MsgResponse<GroupsUsage>> {
  const all = await storage.allOwnerGroups();
  const states = Object.values(all);
  return ok({
    owners: states.length,
    groups: states.reduce((n, s) => n + s.groups.length, 0),
    repositories: states.reduce((n, s) => n + Object.keys(s.assign).length, 0),
    bytes: await storage.groupsBytesInUse(),
    quotaBytes: SYNC_TOTAL_BYTES,
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void storage.removeLegacyData();
});

async function handle(req: Request, from: SenderKind): Promise<MsgResponse<unknown>> {
  if (typeof req !== "object" || req === null || typeof (req as { type?: unknown }).type !== "string") {
    return fail({ kind: "validation", status: 0, message: "Malformed message." });
  }
  if (from === "unknown") return fail({ kind: "validation", status: 0, message: "Untrusted sender." });
  if (OPTIONS_ONLY.has(req.type) && from !== "options") return fail({ kind: "validation", status: 0, message: `${req.type} is only available from the settings page.` });
  switch (req.type) {
    case "ping":
      return ok({ at: Date.now() });
    case "auth.status":
      return authStatus();
    case "auth.setToken":
      return setPat(req.token);
    case "auth.clear":
      await storage.clearAuth();
      return ok({ configured: false, login: null, kind: null } satisfies AuthStatus);
    case "auth.deviceStart":
      return deviceStart();
    case "auth.devicePoll":
      return devicePoll(req.flowId);
    case "auth.installations":
      return installations();
    case "options.open":
      await chrome.runtime.openOptionsPage();
      return ok(null);
    case "repos.list":
      if (!isName(req.owner)) return fail({ kind: "validation", status: 0, message: "Invalid owner." });
      return listRepos(req.owner, req.force === true);
    case "groups.get":
      if (!isName(req.owner)) return fail({ kind: "validation", status: 0, message: "Invalid owner." });
      return ok(await storage.getOwnerGroups(req.owner));
    case "groups.apply":
      if (!isName(req.owner)) return fail({ kind: "validation", status: 0, message: "Invalid owner." });
      return applyGroupOps(req.owner, req.ops);
    case "groups.export":
      return ok(buildExport(await storage.allOwnerGroups(), new Date()));
    case "groups.import":
      return importGroups(req.file);
    case "groups.usage":
      return groupsUsage();
    case "groups.clear":
      return serialized(async () => ok({ owners: await storage.clearAllGroups() }));
    case "prefs.get":
      return ok(await storage.getPrefs());
    case "prefs.set":
      if (typeof req.patch !== "object" || req.patch === null) return fail({ kind: "validation", status: 0, message: "Invalid preferences." });
      return ok(await storage.setPrefs(req.patch));
    default:
      return fail({ kind: "other", status: 0, message: `Unknown message type: ${String((req as { type?: unknown }).type)}` });
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const from = classifySender(sender);
  if (from === "unknown") return false; // not our extension, or an unexpected context
  handle(message as Request, from).then(sendResponse, (e: unknown) => sendResponse(fail(toErrorInfo(e))));
  return true; // async response
});
