import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("warehouse client authenticates and uses versioned metadata sync", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /仓库管理/);
  assert.match(page, /可编辑/);
  assert.match(page, /auth\/v1\/token\?grant_type=password/);
  assert.match(page, /访问密码/);
  assert.doesNotMatch(page, /HOUSEHOLD_PASSWORD|static\s+(?:let|const)\s+password/i);
  assert.match(page, /home_inventory_get_state/);
  assert.match(page, /home_inventory_commit_state/);
  assert.match(page, /expected_revision/);
  assert.match(page, /SYNC_CONFLICT/);
  assert.match(page, /storage\/v1\/object\/authenticated\/home-inventory-photos/);
  assert.doesNotMatch(page, /rest\/v1\/home_inventory_snapshots/);
  assert.doesNotMatch(page, /method:\s*"(?:PUT|PATCH|DELETE)"/);
});

test("warehouse detail supports safe edits", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /function ItemEditor/);
  assert.match(page, /function ContainerEditor/);
  assert.match(page, /function RackEditor/);
  assert.match(page, /保存到云端/);
  assert.match(page, /层位编号不在网页端修改/);
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

test("rack view mirrors the native rack, layer, container hierarchy", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /function rackGroupCode/);
  assert.match(page, /className="rack-group"/);
  assert.match(page, /className="rack-layer"/);
  assert.match(page, /className="rack-container-row"/);
  assert.match(page, /aria-expanded=\{groupExpanded\}/);
  assert.match(page, /aria-expanded=\{layerExpanded\}/);
});
