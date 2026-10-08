import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { modelAssetUrl, MODEL_ASSET_REVISION } from "./modelAssetRevision";
test("模型缓存键绑定当前实际文件，同版本视图复用相同地址", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../public/models/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(manifest.version, 27);
  assert.equal(
    manifest.annotationRevision.id,
    "2026-10-08-annotated-surface-and-transverse-output",
  );
  const bytes = readFileSync(
    new URL("../public/models/xp4.glb", import.meta.url),
  );
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.equal(manifest.assets["xp4.glb"].bytes, bytes.length);
  assert.equal(manifest.assets["xp4.glb"].sha256, digest);
  const prefix = manifest.annotationRevision.id.replace(
    "2026-10-08",
    "20261008",
  );
  assert.equal(MODEL_ASSET_REVISION, `${prefix}-${digest.slice(0, 8)}`);
  assert.equal(
    modelAssetUrl("xp4"),
    `/models/xp4.glb?v=${MODEL_ASSET_REVISION}`,
  );
  assert.equal(modelAssetUrl("xp4"), modelAssetUrl("xp4"));
});
