import test from "node:test";
import assert from "node:assert/strict";
import {
  applyOps,
  buildExport,
  checkGroupName,
  cleanName,
  emptyOwnerGroups,
  EXPORT_FORMAT,
  GROUP_NAME_MAX,
  GROUPS_MAX,
  isGroupId,
  newGroupId,
  parseImport,
  parseOps,
  type GroupOp,
  type OwnerGroups,
} from "./groupState.ts";

const A = "groupaaaa1";
const B = "groupbbbb2";
const ok = (state: OwnerGroups, ops: GroupOp[]): OwnerGroups => {
  const r = applyOps(state, ops);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const withAB = () => ok(emptyOwnerGroups(), [{ op: "create", id: A, name: "Platform" }, { op: "create", id: B, name: "Mobile" }]);

test("newGroupId produces valid, varied ids", () => {
  const ids = new Set(Array.from({ length: 200 }, () => newGroupId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.ok(isGroupId(id), id);
  assert.ok(isGroupId(newGroupId(() => 0)), "even a degenerate random source yields a valid id");
});

test("names are cleaned, limited, and 'Ungrouped' is reserved", () => {
  assert.equal(cleanName("  Data \t  Pipeline \u0007 "), "Data Pipeline");
  assert.deepEqual(checkGroupName("   ", []), { ok: false, error: "Enter a group name." });
  assert.equal(checkGroupName("x".repeat(GROUP_NAME_MAX + 1), []).ok, false);
  assert.equal(checkGroupName("あ".repeat(GROUP_NAME_MAX), []).ok, true, "limit counts characters, not bytes");
  assert.equal(checkGroupName("ungrouped", []).ok, false);
});

test("a name matching another group (ignoring case) is reported as existing, not rejected", () => {
  const groups = [{ id: A, name: "Platform" }];
  const r = checkGroupName("platform", groups);
  assert.ok(r.ok && r.existing?.id === A);
  const self = checkGroupName("PLATFORM", groups, A);
  assert.ok(self.ok && self.existing === null, "renaming a group to a different case of its own name is fine");
});

test("create, assign, move, unassign", () => {
  let s = withAB();
  s = ok(s, [{ op: "assign", repoIds: [1, 2], groupId: A }]);
  assert.deepEqual(s.assign, { "1": A, "2": A });
  s = ok(s, [{ op: "assign", repoIds: [2], groupId: B }]);
  assert.deepEqual(s.assign, { "1": A, "2": B });
  s = ok(s, [{ op: "assign", repoIds: [1], groupId: null }]);
  assert.deepEqual(s.assign, { "2": B });
});

test("a group can be created and filled in one change", () => {
  const s = ok(emptyOwnerGroups(), [{ op: "create", id: A, name: "Platform" }, { op: "assign", repoIds: [7], groupId: A }]);
  assert.deepEqual(s, { groups: [{ id: A, name: "Platform" }], assign: { "7": A } });
});

test("rename keeps assignments; delete drops the group and its assignments only", () => {
  let s = ok(withAB(), [{ op: "assign", repoIds: [1], groupId: A }, { op: "assign", repoIds: [2], groupId: B }]);
  s = ok(s, [{ op: "rename", id: A, name: "Backend" }]);
  assert.deepEqual(s.groups.find((g) => g.id === A)?.name, "Backend");
  assert.deepEqual(s.assign, { "1": A, "2": B });
  s = ok(s, [{ op: "delete", id: A }]);
  assert.deepEqual(s.groups.map((g) => g.id), [B]);
  assert.deepEqual(s.assign, { "2": B });
});

test("merge = assign the members to the other group, then delete", () => {
  let s = ok(withAB(), [{ op: "assign", repoIds: [1, 2], groupId: A }]);
  s = ok(s, [{ op: "assign", repoIds: [1, 2], groupId: B }, { op: "delete", id: A }]);
  assert.deepEqual(s, { groups: [{ id: B, name: "Mobile" }], assign: { "1": B, "2": B } });
});

test("all or nothing: one bad operation leaves the state untouched", () => {
  const before = withAB();
  const r = applyOps(before, [{ op: "assign", repoIds: [1], groupId: A }, { op: "rename", id: B, name: "platform" }]);
  assert.equal(r.ok, false);
  assert.deepEqual(before.assign, {}, "input is never mutated");
});

test("invalid operations are refused with a readable reason", () => {
  const s = withAB();
  const reason = (ops: GroupOp[]) => {
    const r = applyOps(s, ops);
    return r.ok ? "accepted" : r.error;
  };
  assert.match(reason([{ op: "create", id: A, name: "Other" }]), /Invalid group id/);
  assert.match(reason([{ op: "create", id: "groupcccc3", name: "platform" }]), /already exists/);
  assert.match(reason([{ op: "rename", id: "groupzzzz9", name: "X" }]), /no longer exists/);
  assert.match(reason([{ op: "assign", repoIds: [1], groupId: "groupzzzz9" }]), /no longer exists/);
  assert.match(reason([{ op: "assign", repoIds: [0], groupId: A }]), /Invalid repository id/);
});

test("at most GROUPS_MAX groups", () => {
  const ops: GroupOp[] = Array.from({ length: GROUPS_MAX }, (_, i) => ({ op: "create", id: `group${String(i).padStart(5, "0")}`, name: `G${i}` }));
  const full = ok(emptyOwnerGroups(), ops);
  const r = applyOps(full, [{ op: "create", id: "groupextra1", name: "One more" }]);
  assert.ok(!r.ok && /at most/.test(r.error));
});

test("parseOps accepts well-formed operations and rejects everything else", () => {
  assert.deepEqual(parseOps([{ op: "create", id: A, name: "X" }, { op: "assign", repoIds: [1], groupId: null }]), [
    { op: "create", id: A, name: "X" },
    { op: "assign", repoIds: [1], groupId: null },
  ]);
  for (const bad of [null, [], "x", [{ op: "drop" }], [{ op: "create", id: "BAD", name: "X" }], [{ op: "assign", repoIds: ["1"], groupId: A }], [{ op: "assign", repoIds: [1], groupId: 5 }]]) {
    assert.equal(parseOps(bad), null, JSON.stringify(bad));
  }
  assert.equal(parseOps(Array.from({ length: 51 }, () => ({ op: "delete", id: A }))), null, "too many operations");
});

test("export → import round-trips; import rebuilds through the same rules", () => {
  const s = ok(withAB(), [{ op: "assign", repoIds: [1, 2], groupId: A }, { op: "assign", repoIds: [3], groupId: B }]);
  const file = JSON.parse(JSON.stringify(buildExport({ mutsuyuki: s }, new Date("2026-09-23T00:00:00Z"))));
  const r = parseImport(file);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.owners["mutsuyuki"]?.assign, s.assign);
  assert.deepEqual(r.owners["mutsuyuki"]?.groups.map((g) => g.name).sort(), ["Mobile", "Platform"]);
});

test("import rejects foreign or broken files and drops dangling assignments", () => {
  assert.equal(parseImport({ format: "something-else", version: 1, owners: {} }).ok, false);
  assert.equal(parseImport({ format: EXPORT_FORMAT, version: 2, owners: {} }).ok, false);
  assert.equal(parseImport({ format: EXPORT_FORMAT, version: 1, owners: { "bad name!": { groups: [], assign: {} } } }).ok, false);
  const dup = { format: EXPORT_FORMAT, version: 1, owners: { u: { groups: [{ id: A, name: "X" }, { id: B, name: "x" }], assign: {} } } };
  assert.equal(parseImport(dup).ok, false, "duplicate names are refused, exactly as in the UI");
  const dangling = parseImport({ format: EXPORT_FORMAT, version: 1, owners: { U: { groups: [{ id: A, name: "X" }], assign: { "1": A, "2": "groupgone00", abc: A } } } });
  assert.ok(dangling.ok);
  if (dangling.ok) assert.deepEqual(dangling.owners["u"], { groups: [{ id: A, name: "X" }], assign: { "1": A } }, "owner key is lowercased");
});
