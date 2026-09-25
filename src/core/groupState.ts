// Groups are kept in the browser (chrome.storage.sync), one record per owner (a user or an organization).
// GitHub is never written to. Pure: no chrome.* and no DOM here, so every rule below is unit-tested.

export const GROUP_NAME_MAX = 50;
export const GROUPS_MAX = 100;
export const UNGROUPED_NAME = "Ungrouped";
/** Upper bounds for one message from the page, so a buggy or hostile page cannot make the worker churn. */
export const OPS_MAX = 50;
export const REPO_IDS_MAX = 5000;

export type GroupDef = { id: string; name: string };
/** One owner's groups. `assign` maps a repository id (GitHub's numeric id, as a string) to a group id. */
export type OwnerGroups = { groups: GroupDef[]; assign: Record<string, string> };
export const emptyOwnerGroups = (): OwnerGroups => ({ groups: [], assign: {} });

/**
 * Every change is expressed as operations applied in order. Repositories are addressed by id, not name, so a
 * renamed repository keeps its group. Merging two groups is "assign the repositories, then delete".
 */
export type GroupOp =
  | { op: "create"; id: string; name: string }
  | { op: "rename"; id: string; name: string }
  | { op: "delete"; id: string }
  | { op: "assign"; repoIds: number[]; groupId: string | null };

const GROUP_ID = /^[a-z0-9]{8,16}$/;
export const isGroupId = (v: unknown): v is string => typeof v === "string" && GROUP_ID.test(v);
export const isRepoId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/** A short random group id. `random` must return uniformly distributed 32-bit unsigned integers. */
export function newGroupId(random: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0): string {
  return (random().toString(36) + random().toString(36)).padEnd(12, "0").slice(0, 12);
}

/** Trim, collapse inner whitespace and drop control characters. */
export function cleanName(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
}

export type NameCheck = { ok: true; name: string; existing: GroupDef | null } | { ok: false; error: string };

/**
 * Validates a group name. A name equal (ignoring case) to another group's is reported as `existing` instead of
 * rejected, so the caller can offer "move into it" (New group) or "merge" (Rename). `selfId` is the group being renamed.
 */
export function checkGroupName(raw: string, groups: readonly GroupDef[], selfId: string | null = null): NameCheck {
  const name = cleanName(raw);
  if (name === "") return { ok: false, error: "Enter a group name." };
  if ([...name].length > GROUP_NAME_MAX) return { ok: false, error: `Use at most ${GROUP_NAME_MAX} characters.` };
  if (name.toLowerCase() === UNGROUPED_NAME.toLowerCase()) return { ok: false, error: `"${UNGROUPED_NAME}" is reserved.` };
  const existing = groups.find((g) => g.id !== selfId && g.name.toLowerCase() === name.toLowerCase()) ?? null;
  return { ok: true, name, existing };
}

export type ApplyResult = { ok: true; state: OwnerGroups } | { ok: false; error: string };

/** Applies operations in order. All or nothing: on the first invalid operation nothing is changed. */
export function applyOps(state: OwnerGroups, ops: readonly GroupOp[]): ApplyResult {
  const groups: GroupDef[] = state.groups.map((g) => ({ ...g }));
  const assign: Record<string, string> = { ...state.assign };
  const gone = { ok: false as const, error: "That group no longer exists. Reload the page and try again." };

  for (const op of ops) {
    switch (op.op) {
      case "create": {
        if (!isGroupId(op.id) || groups.some((g) => g.id === op.id)) return { ok: false, error: "Invalid group id." };
        if (groups.length >= GROUPS_MAX) return { ok: false, error: `You can have at most ${GROUPS_MAX} groups.` };
        const check = checkGroupName(op.name, groups);
        if (!check.ok) return { ok: false, error: check.error };
        if (check.existing) return { ok: false, error: `A group named "${check.existing.name}" already exists.` };
        groups.push({ id: op.id, name: check.name });
        break;
      }
      case "rename": {
        const group = groups.find((g) => g.id === op.id);
        if (!group) return gone;
        const check = checkGroupName(op.name, groups, op.id);
        if (!check.ok) return { ok: false, error: check.error };
        if (check.existing) return { ok: false, error: `A group named "${check.existing.name}" already exists.` };
        group.name = check.name;
        break;
      }
      case "delete": {
        const index = groups.findIndex((g) => g.id === op.id);
        if (index < 0) return gone;
        groups.splice(index, 1);
        for (const [repo, gid] of Object.entries(assign)) if (gid === op.id) delete assign[repo];
        break;
      }
      case "assign": {
        if (op.groupId !== null && !groups.some((g) => g.id === op.groupId)) return gone;
        for (const id of op.repoIds) {
          if (!isRepoId(id)) return { ok: false, error: "Invalid repository id." };
          if (op.groupId === null) delete assign[String(id)];
          else assign[String(id)] = op.groupId;
        }
        break;
      }
    }
  }
  return { ok: true, state: { groups, assign } };
}

/** Validates operations arriving from the page. Returns null for anything malformed. */
export function parseOps(raw: unknown): GroupOp[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > OPS_MAX) return null;
  const out: GroupOp[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const r = item as Record<string, unknown>;
    const op = r["op"];
    const id = r["id"];
    const name = r["name"];
    if (op === "create" || op === "rename") {
      if (!isGroupId(id) || typeof name !== "string" || name.length > GROUP_NAME_MAX * 4) return null;
      out.push({ op, id, name });
    } else if (op === "delete") {
      if (!isGroupId(id)) return null;
      out.push({ op, id });
    } else if (op === "assign") {
      const repoIds = r["repoIds"];
      const groupId = r["groupId"];
      if (!Array.isArray(repoIds) || repoIds.length > REPO_IDS_MAX || !repoIds.every(isRepoId)) return null;
      if (!(groupId === null || isGroupId(groupId))) return null;
      out.push({ op, repoIds: [...repoIds], groupId });
    } else {
      return null;
    }
  }
  return out;
}

// ---- export / import: a plain JSON file, for backups and for moving to a browser without Chrome sync ----

export const EXPORT_FORMAT = "github-repository-groups";
export type ExportFile = { format: typeof EXPORT_FORMAT; version: 1; exportedAt: string; owners: Record<string, OwnerGroups> };

const OWNER = /^[A-Za-z0-9_.-]{1,100}$/;

export function buildExport(owners: Record<string, OwnerGroups>, now: Date): ExportFile {
  return { format: EXPORT_FORMAT, version: 1, exportedAt: now.toISOString(), owners };
}

export type ImportResult = { ok: true; owners: Record<string, OwnerGroups> } | { ok: false; error: string };

/**
 * Rebuilds every owner's groups through `applyOps`, so an imported file obeys exactly the same rules as the UI
 * (valid ids, unique names, limits). Assignments to unknown groups are dropped.
 */
export function parseImport(raw: unknown): ImportResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "Not a groups file." };
  const file = raw as Record<string, unknown>;
  if (file["format"] !== EXPORT_FORMAT) return { ok: false, error: "Not a groups file exported by this extension." };
  if (file["version"] !== 1) return { ok: false, error: "This file was written by a newer version of the extension." };
  const owners = file["owners"];
  if (typeof owners !== "object" || owners === null) return { ok: false, error: "The file has no groups." };

  const out: Record<string, OwnerGroups> = {};
  for (const [owner, value] of Object.entries(owners as Record<string, unknown>)) {
    if (!OWNER.test(owner)) return { ok: false, error: `Invalid account name: ${owner}` };
    const v = (value ?? {}) as Record<string, unknown>;
    const groups = Array.isArray(v["groups"]) ? v["groups"] : [];
    const assign = typeof v["assign"] === "object" && v["assign"] !== null ? (v["assign"] as Record<string, unknown>) : {};
    const ops: GroupOp[] = [];
    for (const g of groups) {
      const r = (g ?? {}) as Record<string, unknown>;
      const id = r["id"];
      const name = r["name"];
      if (!isGroupId(id) || typeof name !== "string") return { ok: false, error: `Invalid group in ${owner}.` };
      ops.push({ op: "create", id, name });
    }
    const byGroup = new Map<string, number[]>();
    const ids = new Set(ops.map((o) => (o.op === "create" ? o.id : "")));
    for (const [repo, gid] of Object.entries(assign)) {
      const repoId = Number(repo);
      if (!/^\d+$/.test(repo) || !isRepoId(repoId) || typeof gid !== "string" || !ids.has(gid)) continue;
      byGroup.set(gid, [...(byGroup.get(gid) ?? []), repoId]);
    }
    for (const [groupId, repoIds] of byGroup) ops.push({ op: "assign", repoIds, groupId });
    const applied = applyOps(emptyOwnerGroups(), ops);
    if (!applied.ok) return { ok: false, error: `${owner}: ${applied.error}` };
    out[owner.toLowerCase()] = applied.state;
  }
  return { ok: true, owners: out };
}
