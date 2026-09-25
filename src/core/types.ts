/** Minimal repository projection kept in cache and rendered by the UI (only what we need, nothing more). */
export type RepoSummary = {
  /** GitHub's numeric repository id: stable across renames and transfers, so groups are keyed by it. */
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  description: string | null;
  language: string | null;
  pushedAt: string | null;
  updatedAt: string;
  htmlUrl: string;
  archived: boolean;
  fork: boolean;
  mirror: boolean;
  template: boolean;
  stargazers: number;
};

export type ApiErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation"
  | "rate_limited"
  | "network"
  | "unsupported"
  | "not_installed"
  | "other";

export type ApiErrorInfo = {
  kind: ApiErrorKind;
  status: number;
  message: string;
  /** From GitHub's `x-accepted-github-permissions` header on 403s: tells the user which permission is missing. */
  acceptedPermissions?: string;
  retryAfterSeconds?: number;
  /** For `not_installed`: where the user can install the GitHub App. */
  installUrl?: string;
};
