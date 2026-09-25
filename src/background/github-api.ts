// GitHub REST wrapper. Deliberately tiny and read-only: the ONLY requests this extension can ever make are
// GET /user, GET /user/repos, GET /orgs/{org}/repos and GET /user/installations. No other method or path exists here.
import type { ApiErrorInfo, RepoSummary } from "../core/types.ts";

export const API_BASE = "https://api.github.com";
const MAX_PAGES = 30; // 3,000 repositories; safety valve against a broken Link header loop

export class GitHubApiError extends Error {
  readonly info: ApiErrorInfo;
  constructor(info: ApiErrorInfo) {
    super(info.message);
    this.name = "GitHubApiError";
    this.info = info;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type Method = "GET";

export type GitHubApi = {
  whoami(): Promise<{ login: string }>;
  /** Every repository owned by the token's user (public + private), all pages. */
  listOwnRepos(): Promise<RepoSummary[]>;
  /** Every repository of an organization the token can see, all pages. */
  listOrgRepos(org: string): Promise<RepoSummary[]>;
  /** GitHub App installations the signed-in user can access (used to detect "app not installed yet"). */
  listInstallations(): Promise<Installation[]>;
};

export type Installation = { id: number; appId: number; appSlug: string | null; account: string | null; repositorySelection: string | null };

export function parseLinkNext(link: string | null): string | null {
  if (!link) return null;
  const m = /<([^>]+)>;\s*rel="next"/.exec(link);
  return m?.[1] ?? null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function toRepoSummary(raw: unknown): RepoSummary | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const owner = (r["owner"] as Record<string, unknown> | undefined)?.["login"];
  const name = str(r["name"]);
  const fullName = str(r["full_name"]);
  const htmlUrl = str(r["html_url"]);
  const id = r["id"];
  if (!name || !fullName || !htmlUrl || typeof owner !== "string" || typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null;
  return {
    id,
    name,
    fullName,
    owner,
    private: r["private"] === true,
    description: str(r["description"]),
    language: str(r["language"]),
    pushedAt: str(r["pushed_at"]),
    updatedAt: str(r["updated_at"]) ?? "",
    htmlUrl,
    archived: r["archived"] === true,
    fork: r["fork"] === true,
    mirror: typeof r["mirror_url"] === "string" && r["mirror_url"].length > 0,
    template: r["is_template"] === true,
    stargazers: typeof r["stargazers_count"] === "number" ? r["stargazers_count"] : 0,
  };
}

async function toError(res: Response): Promise<GitHubApiError> {
  let message = `GitHub API error (HTTP ${res.status}).`;
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message) message = body.message;
  } catch {
    /* non-JSON body */
  }
  const retryAfter = res.headers.get("retry-after");
  const remaining = res.headers.get("x-ratelimit-remaining");
  const base = { status: res.status, message };
  if (res.status === 401) return new GitHubApiError({ ...base, kind: "unauthorized", message: `GitHub rejected the token (401): ${message}` });
  if (res.status === 429 || (res.status === 403 && (retryAfter !== null || remaining === "0"))) {
    const info: ApiErrorInfo = { ...base, kind: "rate_limited", message: `GitHub rate limit reached: ${message}` };
    if (retryAfter !== null && Number.isFinite(Number(retryAfter))) info.retryAfterSeconds = Number(retryAfter);
    return new GitHubApiError(info);
  }
  if (res.status === 403) {
    const info: ApiErrorInfo = { ...base, kind: "forbidden" };
    const accepted = res.headers.get("x-accepted-github-permissions");
    if (accepted) info.acceptedPermissions = accepted;
    return new GitHubApiError(info);
  }
  if (res.status === 404) return new GitHubApiError({ ...base, kind: "not_found" });
  if (res.status === 422) return new GitHubApiError({ ...base, kind: "validation" });
  return new GitHubApiError({ ...base, kind: "other" });
}

export function createGitHubApi(deps: { getToken: () => Promise<string | null>; fetchImpl?: FetchLike; baseUrl?: string }): GitHubApi {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const base = deps.baseUrl ?? API_BASE;

  async function request(method: Method, pathOrUrl: string): Promise<{ json: unknown; headers: Headers }> {
    const token = await deps.getToken();
    if (!token) throw new GitHubApiError({ kind: "unauthorized", status: 0, message: "No GitHub token configured." });
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : base + pathOrUrl;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const init: RequestInit = { method, headers };
    let res: Response;
    try {
      res = await fetchImpl(url, init);
    } catch (e) {
      throw new GitHubApiError({ kind: "network", status: 0, message: `Network error: ${e instanceof Error ? e.message : String(e)}` });
    }
    if (!res.ok) throw await toError(res);
    const json: unknown = res.status === 204 ? null : await res.json();
    return { json, headers: res.headers };
  }

  async function paginate(first: string): Promise<RepoSummary[]> {
    const repos: RepoSummary[] = [];
    let url: string | null = first;
    for (let page = 0; url !== null && page < MAX_PAGES; page++) {
      const { json, headers } = await request("GET", url);
      if (!Array.isArray(json)) throw new GitHubApiError({ kind: "other", status: 200, message: "Unexpected repository list response." });
      for (const raw of json) {
        const r = toRepoSummary(raw);
        if (r) repos.push(r);
      }
      url = parseLinkNext(headers.get("link"));
    }
    return repos;
  }

  return {
    async whoami() {
      const { json } = await request("GET", "/user");
      const login = (json as { login?: unknown } | null)?.login;
      if (typeof login !== "string") throw new GitHubApiError({ kind: "other", status: 200, message: "Unexpected /user response." });
      return { login };
    },
    async listOwnRepos() {
      return paginate("/user/repos?affiliation=owner&per_page=100&sort=full_name&direction=asc");
    },
    async listOrgRepos(org) {
      return paginate(`/orgs/${encodeURIComponent(org)}/repos?per_page=100&sort=full_name&direction=asc&type=all`);
    },
    async listInstallations() {
      const { json } = await request("GET", "/user/installations?per_page=100");
      const list = (json as { installations?: unknown } | null)?.installations;
      if (!Array.isArray(list)) throw new GitHubApiError({ kind: "other", status: 200, message: "Unexpected installations response." });
      return list.map((raw): Installation => {
        const r = (raw ?? {}) as Record<string, unknown>;
        return {
          id: typeof r["id"] === "number" ? r["id"] : 0,
          appId: typeof r["app_id"] === "number" ? r["app_id"] : 0,
          appSlug: str(r["app_slug"]),
          account: str((r["account"] as Record<string, unknown> | undefined)?.["login"]),
          repositorySelection: str(r["repository_selection"]),
        };
      });
    },
  };
}
