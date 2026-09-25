import type { RepoSummary } from "./types.ts";

/** A stable positive id derived from the name, so tests can refer to repositories by name. */
export function idOf(name: string): number {
  let h = 7;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 2_000_000_000;
  return h + 1;
}

export function repo(name: string, extra: Partial<RepoSummary> = {}): RepoSummary {
  return {
    id: idOf(name),
    name,
    fullName: `mutsuyuki/${name}`,
    owner: "mutsuyuki",
    private: true,
    description: null,
    language: null,
    pushedAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    htmlUrl: `https://github.com/mutsuyuki/${name}`,
    archived: false,
    fork: false,
    mirror: false,
    template: false,
    stargazers: 0,
    ...extra,
  };
}
