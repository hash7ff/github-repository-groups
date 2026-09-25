import test from "node:test";
import assert from "node:assert/strict";
import { applyFilter, EMPTY_FILTER, isFiltering, matchesFilter, matchesQuery, parseFilterFromUrl, sortRepos, splitQuery, urlWithout } from "./filters.ts";
import { groupRepos } from "./grouping.ts";
import { repo } from "./fixtures.ts";
import type { OwnerGroups } from "./groupState.ts";

const base = "https://github.com/mutsuyuki?tab=repositories";

test("parseFilterFromUrl reads GitHub's own parameters and ignores unknown values", () => {
  assert.deepEqual(parseFilterFromUrl(base), EMPTY_FILTER);
  assert.deepEqual(parseFilterFromUrl(`${base}&q=gtf&type=private&language=TypeScript&sort=updated`), { q: "gtf", type: "private", language: "TypeScript", sort: "updated" });
  assert.deepEqual(parseFilterFromUrl(`${base}&q=&type=&language=&sort=`), EMPTY_FILTER, "GitHub sends empty values for 'All'");
  assert.deepEqual(parseFilterFromUrl(`${base}&type=nonsense&sort=nonsense`), EMPTY_FILTER, "unknown values are ignored, not applied");
});

test("urlWithout removes a single parameter", () => {
  assert.equal(urlWithout(`${base}&q=x&language=dart`, "language"), `${base}&q=x`);
});

test("matchesQuery searches name and description, case-insensitively", () => {
  const r = repo("api", { description: "Order and billing backend" });
  assert.equal(matchesQuery(r, "API"), true);
  assert.equal(matchesQuery(r, "billing BACKEND"), true);
  assert.equal(matchesQuery(r, "firmware"), false);
  assert.equal(matchesQuery(r, "   "), true);
});

test("type and language filters follow GitHub's semantics", () => {
  const pub = repo("pub", { private: false, language: "Dart" });
  const forked = repo("forked", { fork: true });
  const arch = repo("arch", { archived: true });
  const f = (patch: Partial<typeof EMPTY_FILTER>) => ({ ...EMPTY_FILTER, ...patch });
  assert.equal(matchesFilter(pub, f({ type: "public" })), true);
  assert.equal(matchesFilter(pub, f({ type: "private" })), false);
  assert.equal(matchesFilter(forked, f({ type: "source" })), false);
  assert.equal(matchesFilter(forked, f({ type: "fork" })), true);
  assert.equal(matchesFilter(arch, f({ type: "archived" })), true);
  assert.equal(matchesFilter(pub, f({ language: "dart" })), true, "language matching is case-insensitive");
  assert.equal(matchesFilter(pub, f({ language: "python" })), false);
});

test("sortRepos: default alphabetical, GitHub's choice wins when set", () => {
  const a = repo("alpha", { pushedAt: "2026-01-01T00:00:00Z", stargazers: 1 });
  const b = repo("beta", { pushedAt: "2026-09-01T00:00:00Z", stargazers: 9 });
  assert.deepEqual(sortRepos([b, a], "").map((r) => r.name), ["alpha", "beta"]);
  assert.deepEqual(sortRepos([a, b], "updated").map((r) => r.name), ["beta", "alpha"]);
  assert.deepEqual(sortRepos([a, b], "stargazers").map((r) => r.name), ["beta", "alpha"]);
});

test("applyFilter drops groups with no matches but keeps them (even empty ones) when nothing is filtered", () => {
  const api = repo("api");
  const firmware = repo("firmware");
  const state: OwnerGroups = {
    groups: [{ id: "platform01", name: "Platform" }, { id: "devices001", name: "Devices" }, { id: "emptygroup", name: "Later" }],
    assign: { [String(api.id)]: "platform01", [String(firmware.id)]: "devices001" },
  };
  const g = groupRepos([api, firmware, repo("tool")], state);
  const filtered = applyFilter(g, { ...EMPTY_FILTER, q: "api" });
  assert.deepEqual(filtered.groups.map((p) => p.name), ["Platform"]);
  assert.deepEqual(filtered.ungrouped, []);
  assert.deepEqual(applyFilter(g, EMPTY_FILTER).groups.map((p) => p.name), ["Devices", "Later", "Platform"], "every group survives when not filtering");
});

test("isFiltering ignores sort (ordering is not filtering)", () => {
  assert.equal(isFiltering(EMPTY_FILTER), false);
  assert.equal(isFiltering({ ...EMPTY_FILTER, sort: "updated" }), false);
  assert.equal(isFiltering({ ...EMPTY_FILTER, type: "private" }), true);
});

test("splitQuery folds GitHub's in-query qualifiers in and drops the ones we cannot apply", () => {
  assert.deepEqual(splitQuery("hello"), { text: "hello", type: null, language: null });
  assert.deepEqual(splitQuery("type:source api"), { text: "api", type: "source", language: null });
  assert.deepEqual(splitQuery("language:TypeScript"), { text: "", type: null, language: "typescript" });
  assert.deepEqual(splitQuery("archived:true api"), { text: "api", type: null, language: null }, "unknown qualifier dropped, not searched literally");
});

test("the organization page's q qualifiers reach the filter", () => {
  const f = parseFilterFromUrl("https://github.com/orgs/hash7ff/repositories?q=type%3Asource+api");
  assert.equal(f.type, "source");
  assert.equal(f.q, "api");
});
