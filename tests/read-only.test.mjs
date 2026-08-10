import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("warehouse client remains read-only", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /仓库管理/);
  assert.match(page, /只读模式/);
  assert.match(page, /auth\/v1\/token\?grant_type=password/);
  assert.match(page, /访问密码/);
  assert.doesNotMatch(page, /HomeBeacon#2026!/);
  assert.match(page, /method:\s*"POST"/);
  assert.doesNotMatch(page, /method:\s*"(?:PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(page, /rest\/v1\/home_inventory_snapshots[\s\S]{0,180}method:\s*"POST"/);
});

test("starter preview is fully removed", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /_sites-preview|SkeletonPreview|codex-preview/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
