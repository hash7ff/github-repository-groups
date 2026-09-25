import test from "node:test";
import assert from "node:assert/strict";
import { relativeTime } from "./relativeTime.ts";

const now = Date.parse("2026-09-03T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

test("relativeTime buckets", () => {
  assert.equal(relativeTime(ago(10_000), now), "just now");
  assert.equal(relativeTime(ago(23 * 60_000), now), "23 minutes ago");
  assert.equal(relativeTime(ago(5 * 3_600_000), now), "5 hours ago");
  assert.equal(relativeTime(ago(26 * 3_600_000), now), "yesterday");
  assert.equal(relativeTime(ago(4 * 86_400_000), now), "4 days ago");
  assert.equal(relativeTime(ago(8 * 86_400_000), now), "last week");
  assert.equal(relativeTime(ago(40 * 86_400_000), now), "on Jul 25");
  assert.equal(relativeTime("2024-01-05T00:00:00Z", now), "on Jan 5, 2024");
  assert.equal(relativeTime(null, now), "");
  assert.equal(relativeTime("garbage", now), "");
});
