// Content script: mount the grouped view on a repository list page.
// Rules: read as little as possible from GitHub's DOM (that knowledge lives entirely in ./pages/*),
// never use innerHTML with GitHub-derived strings, never touch chrome.storage or the token (service worker only).
import { h } from "./ui/h.ts";
import { pickAdapter, type PageAdapter, type PageContext } from "./pages/index.ts";
import { closeAllDialogs } from "./ui/dialog.ts";
import { send } from "./messaging.ts";
import { groupOf, groupRepos, type Grouped } from "../core/grouping.ts";
import { checkGroupName, newGroupId, type GroupOp, type OwnerGroups } from "../core/groupState.ts";
import { applyFilter, EMPTY_FILTER, isFiltering, parseFilterFromUrl, type GitHubFilter } from "../core/filters.ts";
import { relativeTime } from "../core/relativeTime.ts";
import { DEFAULT_PREFS, type AuthStatus, type Prefs, type ReposList, type ViewMode } from "../core/messages.ts";
import type { ApiErrorInfo } from "../core/types.ts";
import { buildToolbar, describeError, renderError, renderFilterChips, renderGroups, renderLoading, renderUnconfigured, setSegmentedMode, type ViewActions } from "./ui/view.ts";
import { openMoveDialog } from "./ui/moveDialog.ts";
import { openAddRepositoriesDialog, openNewGroupDialog } from "./ui/pickerDialog.ts";
import { openDeleteDialog, openGroupMenu, openRenameDialog } from "./ui/groupDialogs.ts";

const ROOT_ID = "gtf-root";

type Phase =
  | { kind: "loading" }
  | { kind: "unconfigured" }
  | { kind: "error"; error: ApiErrorInfo }
  | { kind: "ready"; data: ReposList; state: OwnerGroups; grouped: Grouped };

class GroupedView {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly status: HTMLElement;
  private readonly seg: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly chips: HTMLElement;
  /** GitHub's own Find/Type/Language/Sort controls stay above our view; their state lives in the URL. */
  private readonly urlFilter: GitHubFilter = EMPTY_FILTER;
  private flashTimer: number | undefined;
  private busy = false;
  private loadSeq = 0;
  private prefs: Prefs = DEFAULT_PREFS;
  private phase: Phase = { kind: "loading" };
  private query = "";
  private disposed = false;
  private readonly ctx: PageContext;
  private readonly adapter: PageAdapter;
  /** Re-read on every render: React pages replace this element (see pages/orgRepos.ts). */
  private anchor: HTMLElement;
  private readonly actions: ViewActions;
  readonly url = location.href;

  constructor(ctx: PageContext, adapter: PageAdapter, anchor: HTMLElement) {
    this.ctx = ctx;
    this.adapter = adapter;
    this.anchor = anchor;
    const actions: ViewActions = {
      toggleGroup: (key) => this.toggleGroup(key),
      setMode: (mode) => this.setMode(mode),
      setQuery: (q) => {
        this.query = q;
        this.renderBody();
      },
      refresh: () => void this.load(true),
      retry: () => void this.load(true),
      openSettings: () => void send({ type: "options.open" }),
      moveRepo: (name) => this.openMove(name),
      newGroup: () => this.openNewGroup([]),
      groupMenu: (groupId) => this.openGroupMenu(groupId),
    };
    const { toolbar, status, seg, search } = buildToolbar(actions);
    this.status = status;
    this.seg = seg;
    this.urlFilter = parseFilterFromUrl(location.href);
    this.query = this.urlFilter.q;
    search.value = this.urlFilter.q; // GitHub's search box submitted this; keep ours in sync
    this.chips = h("div", { className: "gtf-chips", hidden: true });
    this.body = h("div", { className: "gtf-body" });
    this.flash = h("div", { className: "gtf-flash", hidden: true });
    this.root = h("div", { id: ROOT_ID, className: "gtf-root", dataset: { gtfUrl: location.href } }, toolbar, this.chips, this.flash, this.body);
    renderFilterChips(this.chips, this.urlFilter, location.href);
    this.actions = actions;
  }

  async init(): Promise<void> {
    const prefs = await send<Prefs>({ type: "prefs.get" });
    if (this.disposed) return;
    if (prefs.ok) this.prefs = prefs.data;
    this.applyMode();
    await this.load(false);
  }

  /** Put our root in front of GitHub's list and apply the current mode. Safe to call on every render. */
  attach(anchor: HTMLElement): void {
    this.anchor = anchor;
    if (anchor.previousElementSibling !== this.root) anchor.before(this.root);
    this.applyMode();
  }

  /** Restore GitHub's own list and drop anything this view still owns. Called on navigation away / remount. */
  dispose(): void {
    this.disposed = true;
    this.loadSeq++;
    this.adapter.restore();
    closeAllDialogs();
    this.root.remove();
  }

  private async load(force: boolean): Promise<void> {
    const seq = ++this.loadSeq; // a newer load (Refresh, remount) makes this one's result obsolete
    this.phase = { kind: "loading" };
    this.render();
    const auth = await send<AuthStatus>({ type: "auth.status" });
    if (this.disposed || seq !== this.loadSeq) return;
    if (!auth.ok) {
      this.phase = { kind: "error", error: auth.error };
      return this.render();
    }
    if (!auth.data.configured) {
      this.phase = { kind: "unconfigured" };
      return this.render();
    }
    const [list, groups] = await Promise.all([
      send<ReposList>({ type: "repos.list", owner: this.ctx.owner, force }),
      send<OwnerGroups>({ type: "groups.get", owner: this.ctx.owner }),
    ]);
    if (this.disposed || seq !== this.loadSeq) return;
    if (!list.ok) this.phase = { kind: "error", error: list.error };
    else if (!groups.ok) this.phase = { kind: "error", error: groups.error };
    else this.phase = { kind: "ready", data: list.data, state: groups.data, grouped: groupRepos(list.data.repos, groups.data) };
    this.render();
  }

  // ---- group changes: stored in this browser by the service worker; nothing is written to GitHub ----
  private idsOf(names: readonly string[]): number[] {
    if (this.phase.kind !== "ready") return [];
    const byName = new Map(this.phase.data.repos.map((r) => [r.name, r.id]));
    return names.map((n) => byName.get(n)).filter((id): id is number => id !== undefined);
  }

  private openMove(repoName: string): void {
    if (this.phase.kind !== "ready" || this.busy) return;
    const { data, state, grouped } = this.phase;
    const repo = data.repos.find((r) => r.name === repoName);
    if (!repo) return;
    openMoveDialog({
      repoName,
      currentId: groupOf(repo, state),
      groups: grouped.groups.map((g) => ({ id: g.id, name: g.name, count: g.repos.length })),
      onSelect: (groupId) => {
        const target = groupId === null ? "Ungrouped" : (grouped.groups.find((g) => g.id === groupId)?.name ?? "the group");
        void this.applyOps([{ op: "assign", repoIds: [repo.id], groupId }], `Moved ${repoName} to ${target}.`);
      },
      onNewGroup: () => this.openNewGroup([repoName]),
    });
  }

  private openNewGroup(preselected: string[]): void {
    if (this.phase.kind !== "ready" || this.busy) return;
    const { data, state } = this.phase;
    openNewGroupDialog({
      repos: data.repos,
      preselected,
      groups: state.groups,
      onCreate: async (name, repoNames) => {
        const check = checkGroupName(name, state.groups);
        if (!check.ok) throw new Error(check.error);
        const repoIds = this.idsOf(repoNames);
        const n = `${repoIds.length} repositor${repoIds.length === 1 ? "y" : "ies"}`;
        if (check.existing) {
          await this.applyOps([{ op: "assign", repoIds, groupId: check.existing.id }], `Moved ${n} into ${check.existing.name}.`, true);
          return;
        }
        const id = newGroupId();
        const ops: GroupOp[] = [{ op: "create", id, name: check.name }];
        if (repoIds.length > 0) ops.push({ op: "assign", repoIds, groupId: id });
        await this.applyOps(ops, repoIds.length > 0 ? `Created ${check.name} with ${n}.` : `Created ${check.name}.`, true);
      },
    });
  }

  private openGroupMenu(groupId: string): void {
    if (this.phase.kind !== "ready" || this.busy) return;
    const { data, state, grouped } = this.phase;
    const group = grouped.groups.find((g) => g.id === groupId);
    if (!group) return;
    const memberIds = group.repos.map((r) => r.id);
    const n = (k: number) => `${k} repositor${k === 1 ? "y" : "ies"}`;
    openGroupMenu({
      name: group.name,
      onAdd: () =>
        openAddRepositoriesDialog({
          groupName: group.name,
          repos: data.repos,
          memberNames: new Set(group.repos.map((r) => r.name)),
          onAdd: (names) => this.applyOps([{ op: "assign", repoIds: this.idsOf(names), groupId }], `Moved ${n(names.length)} into ${group.name}.`, true),
        }),
      onRename: () =>
        openRenameDialog({
          name: group.name,
          id: groupId,
          count: memberIds.length,
          groups: state.groups,
          onRename: async (newName) => {
            const check = checkGroupName(newName, state.groups, groupId);
            if (!check.ok) throw new Error(check.error);
            if (check.existing) {
              const ops: GroupOp[] = [];
              if (memberIds.length > 0) ops.push({ op: "assign", repoIds: memberIds, groupId: check.existing.id });
              ops.push({ op: "delete", id: groupId });
              await this.applyOps(ops, `Merged ${group.name} into ${check.existing.name} (${n(memberIds.length)}).`, true);
            } else {
              await this.applyOps([{ op: "rename", id: groupId, name: check.name }], `Renamed ${group.name} to ${check.name}.`, true);
            }
          },
        }),
      onDelete: () =>
        openDeleteDialog({
          name: group.name,
          count: memberIds.length,
          onDelete: () => this.applyOps([{ op: "delete", id: groupId }], memberIds.length > 0 ? `Deleted ${group.name}: ${n(memberIds.length)} moved to Ungrouped.` : `Deleted ${group.name}.`, true),
        }),
    });
  }

  /** Sends the change to the service worker and re-renders from the state it saved. No reload from GitHub is needed. */
  private async applyOps(ops: GroupOp[], successMessage: string, rethrow = false): Promise<void> {
    if (this.busy || this.phase.kind !== "ready") return;
    this.busy = true;
    try {
      const res = await send<OwnerGroups>({ type: "groups.apply", owner: this.ctx.owner, ops });
      if (this.disposed || this.phase.kind !== "ready") return;
      if (!res.ok) {
        if (rethrow) throw new Error(describeError(res.error)); // the open dialog shows it
        this.showFlash("error", describeError(res.error));
        return;
      }
      this.phase = { ...this.phase, state: res.data, grouped: groupRepos(this.phase.data.repos, res.data) };
      this.render();
      this.showFlash("ok", successMessage);
    } finally {
      this.busy = false;
    }
  }

  private showFlash(kind: "ok" | "error", message: string): void {
    if (this.flashTimer !== undefined) clearTimeout(this.flashTimer);
    while (this.flash.firstChild) this.flash.removeChild(this.flash.firstChild);
    this.flash.className = `gtf-flash gtf-flash-${kind}`;
    this.flash.append(h("span", {}, message));
    this.flash.append(h("button", { className: "gtf-btn gtf-flash-close", type: "button", ariaLabel: "Dismiss", onClick: () => (this.flash.hidden = true) }, "×"));
    this.flash.hidden = false;
    if (kind === "ok") this.flashTimer = window.setTimeout(() => (this.flash.hidden = true), 6000);
  }

  private toggleGroup(key: string): void {
    const collapsed = { ...this.prefs.collapsed, [key]: this.prefs.collapsed[key] !== true };
    this.prefs = { ...this.prefs, collapsed };
    void send({ type: "prefs.set", patch: { collapsed } });
    this.renderBody();
  }

  private setMode(mode: ViewMode): void {
    this.prefs = { ...this.prefs, viewMode: mode };
    void send({ type: "prefs.set", patch: { viewMode: mode } });
    this.applyMode();
  }

  /** Grouped mode hides GitHub's list ONLY while we have data to show; on error/unconfigured/loading it stays visible (Plan.md §24). */
  private applyMode(): void {
    const grouped = this.prefs.viewMode === "grouped";
    setSegmentedMode(this.seg, this.prefs.viewMode);
    this.body.hidden = !grouped;
    const hide = grouped && this.phase.kind === "ready";
    this.anchor.hidden = hide;
    if (!hide) this.adapter.restore();
  }

  private render(): void {
    this.renderStatus();
    this.renderBody();
    this.applyMode();
  }

  private renderStatus(): void {
    const p = this.phase;
    this.status.textContent =
      p.kind === "loading"
        ? "Loading repositories…"
        : p.kind === "ready"
          ? `${p.data.repos.length} repositories · ${p.grouped.groups.length} groups · updated ${relativeTime(new Date(p.data.fetchedAt).toISOString())}`
          : "";
  }

  private renderBody(): void {
    const p = this.phase;
    if (p.kind === "loading") return renderLoading(this.body);
    if (p.kind === "unconfigured") return renderUnconfigured(this.body, this.actions);
    if (p.kind === "error") return renderError(this.body, p.error, this.actions);
    const filter: GitHubFilter = { ...this.urlFilter, q: this.query };
    const searching = isFiltering(filter);
    renderGroups(this.body, applyFilter(p.grouped, filter), this.prefs.collapsed, searching, this.actions);
  }
}

// Exactly one live view per page. Tracked here (not via DOM lookup) so a view whose root the page already removed
// is still disposed: its pending loads/writes are ignored and its dialogs closed.
let activeView: GroupedView | null = null;

function mount(): void {
  const picked = pickAdapter(location.href);
  const anchor = picked?.adapter.anchor() ?? null;

  if (!picked || !anchor) {
    // Not a repository list page, or GitHub's DOM changed: leave the original UI untouched.
    activeView?.dispose();
    activeView = null;
    return;
  }
  ensureObserver(picked.adapter);

  // Same page, view already built: just make sure it is still in front of the (possibly re-created) list.
  if (activeView !== null && activeView.url === location.href && activeView.root.isConnected) {
    activeView.attach(anchor);
    return;
  }

  activeView?.dispose();
  for (const stray of document.querySelectorAll(`#${ROOT_ID}`)) stray.remove();
  const view = new GroupedView(picked.ctx, picked.adapter, anchor);
  activeView = view;
  view.attach(anchor);
  void view.init();
}

let scheduled: number | undefined;
function scheduleMount(): void {
  if (scheduled !== undefined) clearTimeout(scheduled);
  scheduled = window.setTimeout(() => {
    scheduled = undefined;
    mount();
  }, 100);
}

// Full page loads are not guaranteed: the profile tab uses Turbo, the organization pages use GitHub's React
// soft navigation. Re-run on every plausible signal; mount() is idempotent so over-triggering is harmless.
for (const eventName of ["turbo:load", "turbo:frame-load", "turbo:render", "soft-nav:end"]) {
  document.addEventListener(eventName, scheduleMount);
}
window.addEventListener("popstate", scheduleMount);

// Watch only the container the current page re-renders (Turbo frame or <main>); elsewhere watch the body's direct
// children only, so unrelated GitHub pages don't pay for a subtree observer.
const observer = new MutationObserver(scheduleMount);
let observed: Element | null = null;
function ensureObserver(adapter?: PageAdapter): void {
  const scoped = adapter?.observeTarget() ?? null;
  const target = scoped ?? document.body;
  if (target === observed) return;
  observer.disconnect();
  observer.observe(target, { childList: true, subtree: scoped !== null });
  observed = target;
}
ensureObserver(pickAdapter(location.href)?.adapter);

mount();
