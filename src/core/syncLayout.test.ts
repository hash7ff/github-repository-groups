import test from "node:test";
import assert from "node:assert/strict";
import { chunkKey, decodeOwner, encodeOwner, groupKeysIn, itemBytes, metaChunks, metaKey, ownersIn, staleChunkKeys, SYNC_ITEM_BYTES } from "./syncLayout.ts";
import type { OwnerGroups } from "./groupState.ts";

const state = (repos: number, groups = 3): OwnerGroups => {
  const defs = Array.from({ length: groups }, (_, i) => ({ id: `group${String(i).padStart(5, "0")}`, name: `Group ${i}` }));
  const assign: Record<string, string> = {};
  for (let i = 0; i < repos; i++) assign[String(700_000_000 + i)] = defs[i % groups]!.id;
  return { groups: defs, assign };
};
const encode = (owner: string, s: OwnerGroups) => {
  const e = encodeOwner(owner, s);
  if (!e.ok) throw new Error(e.error);
  return e;
};

test("round trip for a small owner: one meta item, one chunk", () => {
  const s = state(10);
  const e = encode("Mutsuyuki", s);
  assert.equal(e.chunks, 1);
  assert.deepEqual(Object.keys(e.items).sort(), [chunkKey("mutsuyuki", 0), metaKey("mutsuyuki")].sort());
  assert.deepEqual(decodeOwner("MUTSUYUKI", e.items), s, "owner names are case-insensitive");
});

test("large owners are split so that no item exceeds Chrome's 8 KB per-item limit", () => {
  const s = state(3000, 20);
  const e = encode("hash7ff", s);
  assert.ok(e.chunks > 1, `chunks: ${e.chunks}`);
  for (const [k, v] of Object.entries(e.items)) assert.ok(itemBytes(k, v) <= SYNC_ITEM_BYTES, `${k}: ${itemBytes(k, v)} bytes`);
  assert.deepEqual(decodeOwner("hash7ff", e.items), s);
  assert.ok(e.bytes < 102_400, `3,000 repositories fit in Chrome's 100 KB sync quota (${e.bytes} bytes)`);
});

test("group names are measured in bytes, so non-ASCII names cannot overflow an item", () => {
  const s: OwnerGroups = { groups: Array.from({ length: 100 }, (_, i) => ({ id: `group${String(i).padStart(5, "0")}`, name: "案件".repeat(25) })), assign: {} };
  const e = encodeOwner("u", s);
  assert.equal(e.ok, false, "100 groups of 50 Japanese characters do not fit in one meta item");
});

test("stale chunks: shrinking leaves keys to remove; decoding ignores chunks beyond the meta's count", () => {
  const big = encode("u", state(3000, 5));
  const small = encode("u", state(5, 5));
  const stale = staleChunkKeys("u", big.chunks, small.chunks);
  assert.equal(stale.length, big.chunks - small.chunks);
  const mixed = { ...big.items, ...small.items }; // what storage holds between set() and remove()
  assert.deepEqual(decodeOwner("u", mixed), state(5, 5));
});

test("decoding is tolerant: missing meta, garbage, and assignments to unknown groups", () => {
  assert.deepEqual(decodeOwner("u", {}), { groups: [], assign: {} });
  assert.deepEqual(decodeOwner("u", { [metaKey("u")]: "garbage" }), { groups: [], assign: {} });
  const items = {
    [metaKey("u")]: { v: 1, groups: [{ id: "groupaaaa1", name: "A" }, { id: "BAD", name: "B" }, { id: "groupaaaa1", name: "dup" }], chunks: 1 },
    [chunkKey("u", 0)]: { "1": "groupaaaa1", "2": "groupgone00", x: "groupaaaa1", "3": 5 },
  };
  assert.deepEqual(decodeOwner("u", items), { groups: [{ id: "groupaaaa1", name: "A" }], assign: { "1": "groupaaaa1" } });
});

test("owners are found by their meta items", () => {
  const items = { ...encode("b", state(1)).items, ...encode("A", state(1)).items, "gtf.prefs": {} };
  assert.deepEqual(ownersIn(items), ["a", "b"]);
  assert.equal(metaChunks("a", items), 1);
  assert.equal(metaChunks("nobody", items), 0);
});

test("groupKeysIn finds every key the layout owns and nothing else", () => {
  const items = { ...encode("a", state(1)).items, ...encode("b", state(3000, 5)).items, "gtf.prefs": {}, "other.key": 1 };
  const keys = groupKeysIn(items);
  assert.ok(keys.every((k) => k.startsWith("gtf.groups.") || k.startsWith("gtf.assign.")));
  assert.equal(keys.length, Object.keys(items).length - 2);
});
