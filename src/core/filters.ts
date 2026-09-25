// GitHub's own controls above our view (Find a repository / Type / Language / Sort) put their state in the URL.
// We read it from there instead of touching GitHub's DOM, so those controls keep working while the grouped view is shown.
import type { RepoSummary } from "./types.ts";
import type { Grouped } from "./grouping.ts";
import { byName } from "./grouping.ts";

/** Values observed on the profile Repositories tab (verified 2026-09-04). */
export type RepoType = "" | "public" | "private" | "source" | "fork" | "archived" | "mirror" | "template" | "sponsorable";
export type RepoSort = "" | "name" | "updated" | "stargazers";

export type GitHubFilter = { q: string; language: string; type: RepoType; sort: RepoSort };
export const EMPTY_FILTER: GitHubFilter = { q: "", language: "", type: "", sort: "" };

const TYPES = new Set<string>(["public", "private", "source", "fork", "archived", "mirror", "template", "sponsorable"]);
const SORTS = new Set<string>(["name", "updated", "stargazers"]);

/**
 * GitHub's organization page encodes filters inside `q` ("type:source rest of query"), while the profile tab uses
 * separate parameters. Split qualifiers out of the free text so they are applied instead of matched literally.
 */
export function splitQuery(q: string): { text: string; type: RepoType | null; language: string | null } {
  const words: string[] = [];
  let type: RepoType | null = null;
  let language: string | null = null;
  for (const word of q.split(/\s+/).filter(Boolean)) {
    const m = /^([a-z_]+):(.+)$/i.exec(word);
    if (!m) {
      words.push(word);
      continue;
    }
    const key = (m[1] ?? "").toLowerCase();
    const value = (m[2] ?? "").toLowerCase().replace(/^"|"$/g, "");
    if (key === "language") language = value;
    else if ((key === "type" || key === "is") && TYPES.has(value)) type = value as RepoType;
    // any other qualifier is dropped: matching it as text would hide everything
  }
  return { text: words.join(" "), type, language };
}

export function parseFilterFromUrl(href: string): GitHubFilter {
  const p = new URL(href).searchParams;
  const type = (p.get("type") ?? "").toLowerCase();
  const sort = (p.get("sort") ?? "").toLowerCase();
  const inQuery = splitQuery(p.get("q") ?? "");
  return {
    q: inQuery.text,
    language: p.get("language") || inQuery.language || "",
    type: TYPES.has(type) ? (type as RepoType) : (inQuery.type ?? ""),
    sort: SORTS.has(sort) ? (sort as RepoSort) : "",
  };
}

/** URL with one of GitHub's filter parameters removed, so a chip can link back to the unfiltered page. */
export function urlWithout(href: string, key: keyof GitHubFilter): string {
  const url = new URL(href);
  url.searchParams.delete(key);
  return url.toString();
}

export function matchesQuery(repo: RepoSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return repo.name.toLowerCase().includes(q) || (repo.description ?? "").toLowerCase().includes(q);
}

function matchesType(repo: RepoSummary, type: RepoType): boolean {
  switch (type) {
    case "":
      return true;
    case "public":
      return !repo.private;
    case "private":
      return repo.private;
    case "source":
      return !repo.fork;
    case "fork":
      return repo.fork;
    case "archived":
      return repo.archived;
    case "mirror":
      return repo.mirror;
    case "template":
      return repo.template;
    case "sponsorable":
      return true; // not exposed by the repository list API; ignored rather than guessed
  }
}

export function matchesFilter(repo: RepoSummary, filter: GitHubFilter): boolean {
  if (!matchesQuery(repo, filter.q)) return false;
  if (filter.language !== "" && (repo.language ?? "").toLowerCase() !== filter.language.toLowerCase()) return false;
  return matchesType(repo, filter.type);
}

const timeOf = (r: RepoSummary): number => Date.parse(r.pushedAt ?? r.updatedAt) || 0;

/** Repository order inside a group. Empty keeps our alphabetical default; GitHub's own choice wins when set. */
export function sortRepos(repos: readonly RepoSummary[], sort: RepoSort): RepoSummary[] {
  const list = [...repos];
  if (sort === "updated") return list.sort((a, b) => timeOf(b) - timeOf(a));
  if (sort === "stargazers") return list.sort((a, b) => b.stargazers - a.stargazers || byName(a, b));
  return list.sort(byName);
}

export function isFiltering(filter: GitHubFilter): boolean {
  return filter.q.trim() !== "" || filter.language !== "" || filter.type !== "";
}

/** Apply text/type/language filtering and repository ordering. Groups with nothing left are dropped. */
export function applyFilter(grouped: Grouped, filter: GitHubFilter): Grouped {
  const keep = (repos: readonly RepoSummary[]) => sortRepos(repos.filter((r) => matchesFilter(r, filter)), filter.sort);
  return {
    groups: grouped.groups.map((p) => ({ ...p, repos: keep(p.repos) })).filter((p) => p.repos.length > 0 || !isFiltering(filter)),
    ungrouped: keep(grouped.ungrouped),
  };
}
