import { test } from "node:test";
import assert from "node:assert/strict";
import { DirectionalLight, WebGLRenderTarget } from "three";
import { RENDER_QUALITY, shadowMapSizeForLimit } from "./renderQuality";
import { syncShadowAllocation } from "./renderQuality";

test("high quality supersamples low-DPI displays and caps high-DPI cost", () => {
  assert.deepEqual(RENDER_QUALITY.highDpr, [1.5, 2]);
  assert.deepEqual(RENDER_QUALITY.lowDpr, [1, 1]);
  assert.equal(RENDER_QUALITY.shadowMapSize / 2048, 2);
});

test("adaptive shadows release old GPU targets on resizing or low-quality toggle", () => {
  const shadow = new DirectionalLight().shadow;
  let released = 0;
  const target = new WebGLRenderTarget(4096, 4096);
  target.addEventListener("dispose", () => released++);
  shadow.map = target;
  syncShadowAllocation(shadow, 4096, true);
  assert.equal(shadow.map, target);
  syncShadowAllocation(shadow, 2048, true);
  assert.equal(shadow.map, null);
  assert.equal(released, 1);
  assert.equal(shadow.mapSize.x, 2048);
  shadow.map = new WebGLRenderTarget(2048, 2048);
  syncShadowAllocation(shadow, 2048, false);
  assert.equal(shadow.map, null);
});

test("shadow maps respect actual GPU texture limits", () => {
  for (const [limit, size] of [
    [16384, 4096],
    [4096, 4096],
    [3000, 2048],
    [2048, 2048],
    [1024, 1024],
    [1, 1],
  ])
    assert.equal(shadowMapSizeForLimit(limit), size);
  assert.equal(shadowMapSizeForLimit(Number.NaN), 2048);
  assert.equal(shadowMapSizeForLimit(16384, 390), 2048);
  assert.equal(shadowMapSizeForLimit(1024, 390), 1024);
});
