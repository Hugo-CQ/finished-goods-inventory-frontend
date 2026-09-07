import assert from "node:assert/strict";
import test from "node:test";
import { AuthenticationRequired, WarehouseSession } from "../app/warehouse-session.ts";
import { rebaseDraft, validContainerParent } from "../app/warehouse-draft.ts";

function fixture(fetcher, session = { access_token: "old", refresh_token: "refresh", expires_at: 5 }) {
  const values = new Map([[WarehouseSession.storageKey, JSON.stringify(session)]]);
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const client = new WarehouseSession({ url: "https://example.test", key: "public-test", storage: () => storage, fetch: fetcher, now: () => 100_000 });
  return { client, values };
}
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

test("concurrent requests share one renewal and use the rotated access token", async () => {
  let refreshes = 0;
  const tokens = [];
  const { client } = fixture(async (url, init) => {
    if (url.includes("refresh_token")) { refreshes++; await new Promise((resolve) => setTimeout(resolve, 10)); return response({ access_token: "renewed", refresh_token: "rotated", expires_in: 3600 }); }
    tokens.push(init.headers.get("Authorization"));
    return response({});
  });
  const restoring = client.restore();
  await Promise.all([restoring, client.request("/one"), client.request("/two")]);
  assert.equal(refreshes, 1);
  assert.deepEqual(tokens, ["Bearer renewed", "Bearer renewed"]);
});

test("temporary refresh failure preserves the session for reconnection", async () => {
  const { client, values } = fixture(async () => response({}, 503));
  await assert.rejects(client.restore(), /暂时无法续期/);
  assert.ok(values.has(WarehouseSession.storageKey));
});

test("invalid refresh requires authentication but leaves draft storage untouched", async () => {
  const { client, values } = fixture(async () => response({}, 400));
  values.set("home-inventory-draft:item:a", "keep my edit");
  await assert.rejects(client.restore(), AuthenticationRequired);
  assert.equal(values.has(WarehouseSession.storageKey), false);
  assert.equal(values.get("home-inventory-draft:item:a"), "keep my edit");
});

test("locking during renewal cannot revive the old session", async () => {
  let finish;
  const { client, values } = fixture(() => new Promise((resolve) => { finish = resolve; }));
  const restoring = client.restore();
  client.lock();
  finish(response({ access_token: "late-token", refresh_token: "late-refresh", expires_in: 3600 }));
  await assert.rejects(restoring, AuthenticationRequired);
  assert.equal(values.has(WarehouseSession.storageKey), false);
});

test("API 401 renews and retries once; permission denied does not destroy the session", async () => {
  let calls = 0;
  const { client, values } = fixture(async (url) => {
    if (url.includes("refresh_token")) return response({ access_token: "renewed", refresh_token: "rotated", expires_in: 3600 });
    calls++;
    return response({}, calls === 1 ? 401 : 403);
  }, { access_token: "valid", refresh_token: "refresh", expires_at: 2000 });
  await client.restore();
  assert.equal((await client.request("/private")).status, 403);
  assert.equal(calls, 2);
  assert.ok(values.has(WarehouseSession.storageKey));
});

test("draft merges independent fields and refuses same-field overwrite", () => {
  assert.deepEqual(rebaseDraft({ quantity: 1, note: "old" }, { quantity: 2, note: "old" }, { quantity: 1, note: "new" }), { quantity: 2, note: "new" });
  assert.throws(() => rebaseDraft({ quantity: 1 }, { quantity: 2 }, { quantity: 3 }), /另一台设备修改/);
});

test("container parent validation blocks self, descendants, cycles, and missing parents", () => {
  const boxes = [{ boxCode: "a" }, { boxCode: "b", parentBoxCode: "a" }, { boxCode: "c", parentBoxCode: "b" }];
  assert.equal(validContainerParent(boxes, "a", "c"), false);
  assert.equal(validContainerParent(boxes, "a", "a"), false);
  assert.equal(validContainerParent(boxes, "a", "missing"), false);
  assert.equal(validContainerParent(boxes, "c", "a"), true);
  assert.equal(validContainerParent(boxes, "a", ""), true);
});
