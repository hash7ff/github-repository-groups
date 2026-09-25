import test from "node:test";
import assert from "node:assert/strict";
import { detectUserRepositoriesPage } from "./userProfile.ts";
import { detectOrgRepositoriesPage } from "./orgRepos.ts";

test("user profile detection accepts only the repositories tab of a single-segment path", () => {
  assert.deepEqual(detectUserRepositoriesPage("https://github.com/mutsuyuki?tab=repositories"), { owner: "mutsuyuki", kind: "user" });
  assert.deepEqual(detectUserRepositoriesPage("https://github.com/mutsuyuki?tab=repositories&q=x&type=private"), { owner: "mutsuyuki", kind: "user" });
  assert.equal(detectUserRepositoriesPage("https://github.com/mutsuyuki"), null);
  assert.equal(detectUserRepositoriesPage("https://github.com/mutsuyuki/repo?tab=repositories"), null);
  assert.equal(detectUserRepositoriesPage("https://gist.github.com/mutsuyuki?tab=repositories"), null);
  assert.equal(detectUserRepositoriesPage("https://github.com/orgs/hash7ff/repositories"), null);
});

test("organization detection accepts /orgs/<org>/repositories only", () => {
  assert.deepEqual(detectOrgRepositoriesPage("https://github.com/orgs/hash7ff/repositories"), { owner: "hash7ff", kind: "org" });
  assert.deepEqual(detectOrgRepositoriesPage("https://github.com/orgs/hash7ff/repositories?q=topic"), { owner: "hash7ff", kind: "org" });
  assert.equal(detectOrgRepositoriesPage("https://github.com/orgs/hash7ff/people"), null);
  assert.equal(detectOrgRepositoriesPage("https://github.com/hash7ff"), null);
  assert.equal(detectOrgRepositoriesPage("https://github.com/orgs/hash7ff/repositories/extra"), null);
});
