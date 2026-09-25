import type { RepoSummary } from "./types.ts";
import type { OwnerGroups } from "./groupState.ts";

export type RepoGroup = { id: string; name: string; repos: RepoSummary[] };
export type Grouped = { groups: RepoGroup[]; ungrouped: RepoSummary[] };

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
export const byName = (a: { name: string }, b: { name: string }): number => collator.compare(a.name, b.name);

/**
 * Places each repository in the group its id is assigned to, or in Ungrouped. Every defined group is listed,
 * even an empty one (groups are no longer derived from topics, so they can exist before anything is in them).
 */
export function groupRepos(repos: readonly RepoSummary[], state: OwnerGroups): Grouped {
  const lists = new Map<string, RepoSummary[]>(state.groups.map((g) => [g.id, []]));
  const ungrouped: RepoSummary[] = [];
  for (const repo of repos) {
    const groupId = state.assign[String(repo.id)];
    const list = groupId === undefined ? undefined : lists.get(groupId);
    if (list) list.push(repo);
    else ungrouped.push(repo);
  }
  const groups: RepoGroup[] = state.groups.map((g) => ({ id: g.id, name: g.name, repos: (lists.get(g.id) ?? []).sort(byName) }));
  groups.sort(byName);
  ungrouped.sort(byName);
  return { groups, ungrouped };
}

/** The group a repository is in, or null. */
export function groupOf(repo: RepoSummary, state: OwnerGroups): string | null {
  const id = state.assign[String(repo.id)];
  return id !== undefined && state.groups.some((g) => g.id === id) ? id : null;
}
