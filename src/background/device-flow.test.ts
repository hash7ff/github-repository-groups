import test from "node:test";
import assert from "node:assert/strict";
import { ACCESS_TOKEN_URL, DEVICE_CODE_URL, DEVICE_GRANT_TYPE, pollDeviceToken, refreshAccessToken, requestDeviceCode } from "./device-flow.ts";
import type { FetchLike } from "./github-api.ts";

type Call = { url: string; body: URLSearchParams; headers: Record<string, string> };
function mock(handler: (c: Call) => unknown): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const c: Call = { url, body: new URLSearchParams(String(init?.body ?? "")), headers: (init?.headers as Record<string, string>) ?? {} };
    calls.push(c);
    return new Response(JSON.stringify(handler(c)), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}
const deps = (fetchImpl: FetchLike) => ({ clientId: "Iv23test", fetchImpl });

test("requestDeviceCode posts client_id as a form and asks for JSON", async () => {
  const { fetchImpl, calls } = mock(() => ({ device_code: "dc", user_code: "WXYZ-1234", verification_uri: "https://github.com/login/device", expires_in: 899, interval: 5 }));
  const r = await requestDeviceCode(deps(fetchImpl));
  assert.equal(r.userCode, "WXYZ-1234");
  assert.equal(calls[0]?.url, DEVICE_CODE_URL);
  assert.equal(calls[0]?.body.get("client_id"), "Iv23test");
  assert.equal(calls[0]?.headers["Accept"], "application/json");
});

test("pollDeviceToken sends the device grant and maps pending / token", async () => {
  let n = 0;
  const { fetchImpl, calls } = mock(() => (n++ === 0 ? { error: "authorization_pending" } : { access_token: "ghu_1", expires_in: 28800, refresh_token: "ghr_1", refresh_token_expires_in: 15897600 }));
  const first = await pollDeviceToken(deps(fetchImpl), "dc", 5);
  assert.deepEqual(first, { kind: "pending", interval: 5 });
  const second = await pollDeviceToken(deps(fetchImpl), "dc", 5);
  assert.equal(second.kind, "token");
  assert.equal(calls[0]?.url, ACCESS_TOKEN_URL);
  assert.equal(calls[0]?.body.get("grant_type"), DEVICE_GRANT_TYPE);
  assert.equal(calls[0]?.body.get("device_code"), "dc");
  assert.equal(calls[0]?.body.has("client_secret"), false);
});

test("refreshAccessToken uses client_id + refresh_token only (no client secret anywhere)", async () => {
  const { fetchImpl, calls } = mock(() => ({ access_token: "ghu_2", expires_in: 28800, refresh_token: "ghr_2", refresh_token_expires_in: 15897600 }));
  const t = await refreshAccessToken(deps(fetchImpl), "ghr_1");
  assert.equal(t.access_token, "ghu_2");
  assert.deepEqual([...calls[0]!.body.keys()].sort(), ["client_id", "grant_type", "refresh_token"]);
  assert.equal(calls[0]?.body.get("grant_type"), "refresh_token");
});

test("refreshAccessToken surfaces GitHub errors as unauthorized", async () => {
  const { fetchImpl } = mock(() => ({ error: "bad_refresh_token", error_description: "The refresh token passed is incorrect or expired." }));
  await assert.rejects(refreshAccessToken(deps(fetchImpl), "ghr_x"), /refresh token passed is incorrect/);
});
