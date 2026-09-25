// How one owner's groups are laid out in chrome.storage.sync. Chrome allows 8,192 bytes per item (key plus JSON
// value) and 102,400 bytes in total, so a meta item holds the group list and the repository assignments are split
// into as many chunk items as needed. Pure: the storage adapter only reads and writes what these functions return.
import { emptyOwnerGroups, isGroupId, type GroupDef, type OwnerGroups } from "./groupState.ts";

export const SYNC_ITEM_BYTES = 8192;
export const SYNC_TOTAL_BYTES = 102_400;
/** Headroom below Chrome's per-item limit, so a slightly different byte count on Chrome's side never fails a write. */
const HEADROOM = 256;
const MAX_CHUNKS = 64;

const META_PREFIX = "gtf.groups.";
const CHUNK_PREFIX = "gtf.assign.";
export const metaKey = (owner: string): string => `${META_PREFIX}${owner.toLowerCase()}`;
export const chunkKey = (owner: string, index: number): string => `${CHUNK_PREFIX}${owner.toLowerCase()}.${index}`;

export type SyncMeta = { v: 1; groups: GroupDef[]; chunks: number };

const bytes = (s: string): number => new TextEncoder().encode(s).length;
export const itemBytes = (key: string, value: unknown): number => bytes(key) + bytes(JSON.stringify(value));

export type Encoded = { ok: true; items: Record<string, unknown>; chunks: number; bytes: number } | { ok: false; error: string };

export function encodeOwner(owner: string, state: OwnerGroups, limit: number = SYNC_ITEM_BYTES - HEADROOM): Encoded {
  const chunks: Array<Record<string, string>> = [];
  let current: Record<string, string> = {};
  let used = 0;
  const keyCost = bytes(chunkKey(owner, MAX_CHUNKS)); // the longest key a chunk can get
  for (const [repo, group] of Object.entries(state.assign).sort(([a], [b]) => a.localeCompare(b))) {
    const entry = bytes(JSON.stringify(repo)) + bytes(JSON.stringify(group)) + 2; // "repo":"group",
    if (Object.keys(current).length > 0 && keyCost + 2 + used + entry > limit) {
      chunks.push(current);
      current = {};
      used = 0;
    }
    current[repo] = group;
    used += entry;
  }
  if (Object.keys(current).length > 0) chunks.push(current);
  if (chunks.length > MAX_CHUNKS) return { ok: false, error: "Too many grouped repositories to store in Chrome sync." };

  const items: Record<string, unknown> = {};
  chunks.forEach((c, i) => (items[chunkKey(owner, i)] = c));
  const meta: SyncMeta = { v: 1, groups: state.groups, chunks: chunks.length };
  if (itemBytes(metaKey(owner), meta) > limit) return { ok: false, error: "Too many groups, or group names too long, to store in Chrome sync." };
  items[metaKey(owner)] = meta;
  const total = Object.entries(items).reduce((n, [k, v]) => n + itemBytes(k, v), 0);
  return { ok: true, items, chunks: chunks.length, bytes: total };
}

function isMeta(v: unknown): v is SyncMeta {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  return m["v"] === 1 && Array.isArray(m["groups"]) && typeof m["chunks"] === "number";
}

/**
 * Reads one owner back from a snapshot of chrome.storage.sync. Tolerant of partial or stale data (another device
 * may still be syncing): chunks beyond the meta's count are ignored, as are assignments to unknown groups.
 */
export function decodeOwner(owner: string, items: Record<string, unknown>): OwnerGroups {
  const meta = items[metaKey(owner)];
  if (!isMeta(meta)) return emptyOwnerGroups();
  const groups: GroupDef[] = [];
  for (const g of meta.groups) {
    const r = (g ?? {}) as Record<string, unknown>;
    const id = r["id"];
    const name = r["name"];
    if (isGroupId(id) && typeof name === "string" && !groups.some((x) => x.id === id)) groups.push({ id, name });
  }
  const known = new Set(groups.map((g) => g.id));
  const assign: Record<string, string> = {};
  for (let i = 0; i < Math.min(meta.chunks, MAX_CHUNKS); i++) {
    const chunk = items[chunkKey(owner, i)];
    if (typeof chunk !== "object" || chunk === null) continue;
    for (const [repo, group] of Object.entries(chunk as Record<string, unknown>)) {
      if (/^\d+$/.test(repo) && typeof group === "string" && known.has(group)) assign[repo] = group;
    }
  }
  return { groups, assign };
}

/** Chunk keys left over when an owner shrinks from `before` chunks to `after`. */
export function staleChunkKeys(owner: string, before: number, after: number): string[] {
  const keys: string[] = [];
  for (let i = after; i < Math.min(before, MAX_CHUNKS); i++) keys.push(chunkKey(owner, i));
  return keys;
}

/** Every key this layout owns in a snapshot of chrome.storage.sync (meta and chunk items of every owner). */
export function groupKeysIn(items: Record<string, unknown>): string[] {
  return Object.keys(items).filter((k) => k.startsWith(META_PREFIX) || k.startsWith(CHUNK_PREFIX));
}

/** Owners that have groups in a snapshot of chrome.storage.sync (lowercase logins). */
export function ownersIn(items: Record<string, unknown>): string[] {
  return Object.keys(items)
    .filter((k) => k.startsWith(META_PREFIX))
    .map((k) => k.slice(META_PREFIX.length))
    .sort();
}

export function metaChunks(owner: string, items: Record<string, unknown>): number {
  const meta = items[metaKey(owner)];
  return isMeta(meta) ? meta.chunks : 0;
}
