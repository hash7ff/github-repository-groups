import test from "node:test";
import assert from "node:assert/strict";
import { canRefresh, needsRefresh, parseDeviceCodeResponse, parseTokenPollResponse, toAuthRecord } from "./auth.ts";

test("parseDeviceCodeResponse maps GitHub's fields and defaults", () => {
  const r = parseDeviceCodeResponse({ device_code: "d", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 899, interval: 5 });
  assert.deepEqual(r, { deviceCode: "d", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresIn: 899, interval: 5 });
  assert.throws(() => parseDeviceCodeResponse({ error: "device_flow_disabled", error_description: "nope" }), /nope/);
});

test("parseTokenPollResponse: pending, slow_down adds 5s, terminal errors, token", () => {
  assert.deepEqual(parseTokenPollResponse({ error: "authorization_pending" }, 5), { kind: "pending", interval: 5 });
  assert.deepEqual(parseTokenPollResponse({ error: "slow_down" }, 5), { kind: "pending", interval: 10 });
  const denied = parseTokenPollResponse({ error: "access_denied" }, 5);
  assert.equal(denied.kind, "error");
  const expired = parseTokenPollResponse({ error: "expired_token" }, 5);
  assert.equal(expired.kind === "error" && expired.code, "expired_token");
  const tok = parseTokenPollResponse({ access_token: "ghu_x", token_type: "bearer", scope: "", expires_in: 28800, refresh_token: "ghr_y", refresh_token_expires_in: 15897600 }, 5);
  assert.equal(tok.kind, "token");
  assert.equal(tok.kind === "token" && tok.token.refresh_token, "ghr_y");
  assert.equal(parseTokenPollResponse({}, 5).kind, "error");
});

test("toAuthRecord / needsRefresh / canRefresh", () => {
  const now = 1_000_000;
  const rec = toAuthRecord({ access_token: "a", expires_in: 28800, refresh_token: "r", refresh_token_expires_in: 15897600 }, now);
  assert.equal(rec.kind, "github-app");
  assert.equal(needsRefresh(rec, now), false);
  assert.equal(needsRefresh(rec, now + 28800 * 1000 - 30_000), true, "within the 60s skew");
  assert.equal(canRefresh(rec, now), true);
  assert.equal(canRefresh(rec, now + 15897600 * 1000 + 1), false, "refresh token expired");
  const noExpiry = toAuthRecord({ access_token: "a" }, now);
  assert.equal(needsRefresh(noExpiry, now + 1e12), false, "apps that opted out of expiration never refresh");
  assert.equal(needsRefresh({ kind: "pat", accessToken: "p" }, now), false);
});
