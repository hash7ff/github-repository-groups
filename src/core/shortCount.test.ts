import test from "node:test";
import assert from "node:assert/strict";
import { shortCount } from "./shortCount.ts";

test("shortCount abbreviates thousands like GitHub's list", () => {
  assert.equal(shortCount(7), "7");
  assert.equal(shortCount(999), "999");
  assert.equal(shortCount(1000), "1k");
  assert.equal(shortCount(1234), "1.2k");
  assert.equal(shortCount(12_345), "12.3k");
});
