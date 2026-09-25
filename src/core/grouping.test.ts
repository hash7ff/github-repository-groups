import test from "node:test";
import assert from "node:assert/strict";
import { groupOf, groupRepos } from "./grouping.ts";
import { emptyOwnerGroups, type OwnerGroups } from "./groupState.ts";
import { repo } from "./fixtures.ts";

const api = repo("api");
const frontend = repo("frontend");
const firmware = repo("firmware");
const state = (assign: Array<[ReturnType<typeof repo>, string]>, groups = [{ id: "platform01", name: "Platform" }]): OwnerGroups => ({
  groups,
  assign: Object.fromEntries(assign.map(([r, g]) => [String(r.id), g])),
});

test("repositories go to the group their id is assigned to; the rest are Ungrouped", () => {
  const g = groupRepos([frontend, firmware, api], state([[api, "platform01"], [frontend, "platform01"]]));
  assert.deepEqual(g.groups.map((p) => ({ name: p.name, repos: p.repos.map((r) => r.name) })), [{ name: "Platform", repos: ["api", "frontend"] }]);
  assert.deepEqual(g.ungrouped.map((r) => r.name), ["firmware"]);
});

test("a renamed repository keeps its group, because groups are keyed by id", () => {
  const renamed = { ...api, name: "api-v2", fullName: "mutsuyuki/api-v2" };
  const g = groupRepos([renamed], state([[api, "platform01"]]));
  assert.deepEqual(g.groups[0]?.repos.map((r) => r.name), ["api-v2"]);
});

test("empty groups are listed; groups sort by name (numeric aware), repositories too", () => {
  const groups = [{ id: "grouptwo10", name: "Team 10" }, { id: "grouptwo02", name: "Team 2" }, { id: "emptygroup", name: "Archive" }];
  const g = groupRepos([repo("repo10"), repo("repo2")], state([[repo("repo10"), "grouptwo02"], [repo("repo2"), "grouptwo02"]], groups));
  assert.deepEqual(g.groups.map((p) => p.name), ["Archive", "Team 2", "Team 10"]);
  assert.deepEqual(g.groups[1]?.repos.map((r) => r.name), ["repo2", "repo10"]);
  assert.deepEqual(g.groups[0]?.repos, []);
});

test("an assignment to a group that no longer exists falls back to Ungrouped", () => {
  const g = groupRepos([api], { groups: [], assign: { [String(api.id)]: "deletedgrp" } });
  assert.deepEqual(g.ungrouped.map((r) => r.name), ["api"]);
  assert.equal(groupOf(api, { groups: [], assign: { [String(api.id)]: "deletedgrp" } }), null);
});

test("with no groups at all, everything is Ungrouped", () => {
  const g = groupRepos([api, firmware], emptyOwnerGroups());
  assert.deepEqual(g.groups, []);
  assert.deepEqual(g.ungrouped.map((r) => r.name), ["api", "firmware"]);
});
