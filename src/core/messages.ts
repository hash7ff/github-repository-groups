import type { ApiErrorInfo, RepoSummary } from "./types.ts";
import type { ExportFile, GroupOp, OwnerGroups } from "./groupState.ts";

export type { ExportFile, GroupOp, OwnerGroups };

export type ViewMode = "grouped" | "original";
/** UI preferences for this browser. The groups themselves are stored separately (see background/storage.ts). */
export type Prefs = {
  viewMode: ViewMode;
  /** group id (or "__ungrouped") -> collapsed */
  collapsed: Record<string, boolean>;
};
export const DEFAULT_PREFS: Prefs = { viewMode: "grouped", collapsed: {} };
export const UNGROUPED_KEY = "__ungrouped";

/** Content script / options page -> service worker. The token never travels in these messages except `auth.setToken` from the options page. */
export type Request =
  | { type: "ping" }
  | { type: "auth.status" }
  | { type: "auth.setToken"; token: string }
  | { type: "auth.clear" }
  | { type: "options.open" }
  | { type: "repos.list"; owner: string; force?: boolean }
  | { type: "prefs.get" }
  | { type: "prefs.set"; patch: Partial<Prefs> }
  | { type: "auth.deviceStart" }
  | { type: "auth.devicePoll"; flowId: string }
  | { type: "auth.installations" }
  | { type: "groups.get"; owner: string }
  | { type: "groups.apply"; owner: string; ops: GroupOp[] }
  | { type: "groups.export" }
  | { type: "groups.import"; file: unknown }
  | { type: "groups.usage" }
  | { type: "groups.clear" };

/** How much of Chrome sync's space the groups take (Chrome allows about 100 KB per extension). */
export type GroupsUsage = { owners: number; groups: number; repositories: number; bytes: number; quotaBytes: number };
export type ImportSummary = { owners: number; groups: number; repositories: number };

export type AuthKind = "pat" | "github-app";
export type AuthStatus = { configured: boolean; login: string | null; kind: AuthKind | null };

export type DeviceStart = { flowId: string; userCode: string; verificationUri: string; expiresIn: number; interval: number };
export type DevicePoll = { done: false; interval: number } | { done: true; login: string };
export type InstallationsStatus = { installed: boolean; count: number; repositorySelection: string | null; installUrl: string };

export type ReposList = {
  owner: string;
  login: string;
  repos: RepoSummary[];
  fetchedAt: number;
  fromCache: boolean;
};

export type Ok<T> = { ok: true; data: T };
export type Fail = { ok: false; error: ApiErrorInfo };
export type Response<T> = Ok<T> | Fail;

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}
export function fail(error: ApiErrorInfo): Fail {
  return { ok: false, error };
}
