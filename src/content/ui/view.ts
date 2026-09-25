// Rendering of the grouped view. Pure DOM construction from state; all text goes through textContent (see h.ts).
import { h, clear } from "./h.ts";
import type { Grouped, RepoGroup } from "../../core/grouping.ts";
import type { RepoSummary, ApiErrorInfo } from "../../core/types.ts";
import { UNGROUPED_KEY } from "../../core/messages.ts";
import { relativeTime } from "../../core/relativeTime.ts";
import { languageColor } from "../../core/languageColors.ts";
import { urlWithout, type GitHubFilter } from "../../core/filters.ts";

export type ViewActions = {
  toggleGroup(key: string): void;
  setMode(mode: "grouped" | "original"): void;
  setQuery(query: string): void;
  refresh(): void;
  retry(): void;
  openSettings(): void;
  moveRepo(repoName: string): void;
  newGroup(): void;
  groupMenu(groupId: string): void;
};

export function describeError(error: ApiErrorInfo): string {
  let text = error.message;
  if (error.kind === "forbidden" && error.acceptedPermissions) text += ` (required permission: ${error.acceptedPermissions})`;
  if (error.kind === "rate_limited" && error.retryAfterSeconds) text += ` Retry after ${error.retryAfterSeconds}s.`;
  return text;
}

export function buildToolbar(actions: ViewActions): { toolbar: HTMLElement; status: HTMLElement; search: HTMLInputElement; seg: HTMLElement } {
  const seg = h(
    "div",
    { className: "gtf-segmented", ariaLabel: "View" },
    h("button", { className: "gtf-seg-btn", type: "button", dataset: { mode: "grouped" }, onClick: () => actions.setMode("grouped") }, "Grouped"),
    h("button", { className: "gtf-seg-btn", type: "button", dataset: { mode: "original" }, onClick: () => actions.setMode("original") }, "Original"),
  );
  const search = h("input", {
    className: "gtf-search",
    type: "search",
    placeholder: "Search repositories…",
    ariaLabel: "Search repositories",
    onInput: (e) => actions.setQuery((e.target as HTMLInputElement).value),
  });
  const status = h("span", { className: "gtf-toolbar-status" });
  const toolbar = h(
    "div",
    { className: "gtf-toolbar" },
    seg,
    search,
    h("button", { className: "gtf-btn", type: "button", onClick: () => actions.newGroup() }, "New group"),
    h("button", { className: "gtf-btn", type: "button", title: "Reload repositories from GitHub", onClick: () => actions.refresh() }, "Refresh"),
    status,
  );
  return { toolbar, status, search, seg };
}

/** Shows which of GitHub's own controls are narrowing the grouped view, each removable through GitHub's own URL. */
export function renderFilterChips(host: HTMLElement, filter: GitHubFilter, href: string): void {
  clear(host);
  const chips: Array<[string, keyof GitHubFilter]> = [];
  if (filter.language !== "") chips.push([`Language: ${filter.language}`, "language"]);
  if (filter.type !== "") chips.push([`Type: ${filter.type}`, "type"]);
  if (filter.sort !== "") chips.push([`Sort: ${filter.sort}`, "sort"]);
  host.hidden = chips.length === 0;
  if (chips.length === 0) return;
  host.append(h("span", { className: "gtf-muted" }, "From GitHub's filters:"));
  for (const [label, key] of chips) {
    host.append(h("a", { className: "gtf-chip", href: urlWithout(href, key), title: `Remove this filter` }, label, h("span", { className: "gtf-chip-x" }, "×")));
  }
}

export function setSegmentedMode(seg: HTMLElement, mode: "grouped" | "original"): void {
  for (const btn of seg.querySelectorAll<HTMLButtonElement>(".gtf-seg-btn")) {
    btn.setAttribute("aria-pressed", btn.dataset["mode"] === mode ? "true" : "false");
  }
}

function languageDot(language: string): HTMLElement {
  const dot = h("span", { className: "gtf-lang-dot" });
  dot.style.backgroundColor = languageColor(language) ?? "var(--fgColor-muted)";
  return dot;
}

function labels(repo: RepoSummary): HTMLElement[] {
  const out = [h("span", { className: "gtf-label" }, repo.private ? "Private" : "Public")];
  if (repo.archived) out.push(h("span", { className: "gtf-label gtf-label-attention" }, "Archived"));
  if (repo.fork) out.push(h("span", { className: "gtf-label" }, "Fork"));
  return out;
}

export function repoRow(repo: RepoSummary, extra?: HTMLElement, actions?: ViewActions): HTMLElement {
  const updated = relativeTime(repo.pushedAt ?? repo.updatedAt);
  const moveBtn = actions
    ? h(
        "button",
        { className: "gtf-btn", type: "button", title: "Move this repository to another group", onClick: () => actions.moveRepo(repo.name) },
        "Move to…",
      )
    : null;
  return h(
    "li",
    { className: "gtf-repo", dataset: { repo: repo.name } },
    h(
      "div",
      { className: "gtf-repo-main" },
      h("div", { className: "gtf-repo-title" }, h("a", { className: "gtf-repo-name", href: repo.htmlUrl }, repo.name), ...labels(repo)),
      repo.description ? h("p", { className: "gtf-repo-desc" }, repo.description) : null,
      h(
        "div",
        { className: "gtf-repo-meta" },
        repo.language ? h("span", { className: "gtf-repo-lang" }, languageDot(repo.language), repo.language) : null,
        updated ? h("span", {}, `Updated ${updated}`) : null,
      ),
    ),
    extra || moveBtn ? h("div", { className: "gtf-repo-actions" }, extra ?? null, moveBtn) : null,
  );
}

function groupSection(key: string, name: string, repos: readonly RepoSummary[], collapsed: boolean, actions: ViewActions, className = "", withMenu = false): HTMLElement {
  const rows = repos.length > 0 ? repos.map((r) => repoRow(r, undefined, actions)) : [h("li", { className: "gtf-repo gtf-repo-empty" }, "No repositories in this group yet. Use “Move to…” on a repository, or “Add repositories…” in this group's menu.")];
  const list = h("ul", { className: "gtf-repos", hidden: collapsed }, ...rows);
  const header = h(
    "button",
    { className: "gtf-group-header", type: "button", onClick: () => actions.toggleGroup(key) },
    h("span", { className: "gtf-caret", ariaLabel: collapsed ? "Expand" : "Collapse" }),
    h("span", { className: "gtf-group-name" }, name),
    h("span", { className: "gtf-count" }, String(repos.length)),
  );
  header.setAttribute("aria-expanded", collapsed ? "false" : "true");
  const head = h(
    "div",
    { className: "gtf-group-head" },
    header,
    withMenu ? h("button", { className: "gtf-btn gtf-group-menu", type: "button", title: "Add repositories, rename or delete this group", ariaLabel: `Group menu for ${name}`, onClick: () => actions.groupMenu(key) }, "…") : null,
  );
  return h("section", { className: `gtf-group ${className}`.trim(), dataset: { key } }, head, list);
}

export function renderGroups(body: HTMLElement, grouped: Grouped, collapsed: Record<string, boolean>, searching: boolean, actions: ViewActions): void {
  clear(body);
  const isCollapsed = (key: string) => !searching && collapsed[key] === true;
  const total = grouped.groups.reduce((n, p) => n + p.repos.length, 0) + grouped.ungrouped.length;
  if (total === 0 && (searching || grouped.groups.length === 0)) {
    body.append(h("p", { className: "gtf-empty" }, searching ? "No repositories match your search." : "No repositories found."));
    return;
  }
  for (const p of grouped.groups as RepoGroup[]) body.append(groupSection(p.id, p.name, p.repos, isCollapsed(p.id), actions, "", true));
  if (grouped.ungrouped.length > 0) body.append(groupSection(UNGROUPED_KEY, "Ungrouped", grouped.ungrouped, isCollapsed(UNGROUPED_KEY), actions, "gtf-ungrouped"));
}

export function renderError(body: HTMLElement, error: ApiErrorInfo, actions: ViewActions): void {
  clear(body);
  body.append(
    h(
      "div",
      { className: "gtf-error-panel" },
      h("p", { className: "gtf-error" }, "Failed to load repository groups. ", describeError(error)),
      h(
        "div",
        { className: "gtf-actions" },
        h("button", { className: "gtf-btn", type: "button", onClick: () => actions.retry() }, "Retry"),
        h("button", { className: "gtf-btn", type: "button", onClick: () => actions.setMode("original") }, "Show original GitHub view"),
        error.kind === "not_installed" && error.installUrl
          ? h("a", { className: "gtf-btn", href: error.installUrl }, "Install on your repositories")
          : null,
        error.kind === "unauthorized" || error.kind === "forbidden" || error.kind === "not_installed"
          ? h("button", { className: "gtf-btn", type: "button", onClick: () => actions.openSettings() }, "Open settings")
          : null,
      ),
    ),
  );
}

export function renderUnconfigured(body: HTMLElement, actions: ViewActions): void {
  clear(body);
  body.append(
    h(
      "div",
      { className: "gtf-notice" },
      "Sign in with GitHub to enable the grouped view. ",
      h("button", { className: "gtf-btn", type: "button", onClick: () => actions.openSettings() }, "Sign in"),
    ),
  );
}

export function renderLoading(body: HTMLElement): void {
  clear(body);
  body.append(h("p", { className: "gtf-loading" }, "Loading repositories…"));
}
