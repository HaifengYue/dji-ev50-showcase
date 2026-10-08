/** 实际CSS尺寸模型和真实GLB投影验收；不等同于浏览器像素或触屏检查。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { checkResponsiveSource } from "../qa/lib/runtime-ui-source-check.mts";
import { createModelRig, measureModelRig, applyModelPose } from "./rig";
import {
  boxCorners,
  getInspectionFrame,
  getPresentationFrame,
  applyCameraFrame,
  createInspectionCamera,
  INSPECTION_VIEWS,
} from "./inspection";
import { getFlight, TOTAL } from "./flight";

const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
const samples = () => checkResponsiveSource(css).samples;

test("实际CSS双向约束覆盖八种屏幕与检查面板开关，并拒绝旧固定高度", () => {
  const rows = samples();
  assert.equal(rows.length, 8);
  for (const row of rows) {
    const stacked = row.viewportWidth <= 1000 || row.viewportHeight <= 520;
    assert.equal(
      row.inspectorPlacement,
      stacked ? "after-canvas" : "side-column",
    );
    if (stacked) {
      assert.equal(
        row.canvasWidthWithoutInspector,
        row.canvasWidthWithInspector,
      );
      assert.equal(row.canvasHeight, row.canvasHeightWithInspector);
    }
  }
  const laptop = rows.find((row) => row.viewportWidth === 1366)!;
  assert.ok(
    laptop.canvasWidthWithoutInspector >= 1050 && laptop.canvasHeight >= 650,
  );
  const landscape = rows.find((row) => row.viewportWidth === 844)!;
  assert.ok(landscape.canvasHeight >= 280);
  for (const mutation of [
    css.replace("height: var(--scene-height);", "height: 59vh;"),
    css.replace("--scene-ratio-limit: 1.65;", "--scene-ratio-limit: 2.6;"),
    css.replace(
      "overflow: auto;\n  overscroll-behavior: contain;\n  min-width: 0;",
      "overflow: hidden;\n  overscroll-behavior: contain;\n  min-width: 0;",
    ),
    css.replace("(100cqw - var(--inspector-width))", "100cqw"),
  ])
    assert.throws(() => checkResponsiveSource(mutation));
});

test("画布变化只同步投影比例，开关检查面板不改变模型和镜头参数", () => {
  const scene = readFileSync(new URL("./Scene.tsx", import.meta.url), "utf8");
  assert.match(
    scene,
    /resizeCameraProjection\(activeCamera, size\.width \/ Math\.max\(size\.height, 1\)\)/,
  );
  assert.match(scene, /\[activeCamera, size\.width, size\.height\]/);
  for (const row of samples()) {
    const before = row.layouts[0];
    for (let repeat = 0; repeat < 5; repeat++) {
      const after = samples().find(
        (sample) => sample.viewportWidth === row.viewportWidth,
      )!.layouts[0];
      assert.deepEqual(after, before);
    }
  }
});

test("八种CSS计算画布比例完整容纳真实模型全展开、检查视角和飞行轨迹", async () => {
  const bytes = readFileSync(
    new URL("../public/models/xp4.glb", import.meta.url),
  );
  const scene = (
    await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        "",
      )
  ).scene;
  const rig = createModelRig(scene);
  const measured = measureModelRig(rig);
  let projectedCorners = 0;
  let largestNdc = 0;
  const project = (
    bounds: THREE.Box3,
    camera: THREE.Camera,
    pose?: THREE.Matrix4,
  ) => {
    for (const corner of boxCorners(bounds)) {
      if (pose) corner.applyMatrix4(pose);
      corner.project(camera);
      assert.ok(
        Math.abs(corner.x) < 1 &&
          Math.abs(corner.y) < 1 &&
          Math.abs(corner.z) < 1,
        `真实模型不得裁切 ${corner.toArray()}`,
      );
      largestNdc = Math.max(largestNdc, Math.abs(corner.x), Math.abs(corner.y));
      projectedCorners++;
    }
  };
  const layouts = samples().flatMap((sample) =>
    sample.layouts.map((layout) => ({
      viewport: [sample.viewportWidth, sample.viewportHeight],
      ...layout,
    })),
  );
  for (const layout of layouts) {
    const aspect = layout.aspect;
    const perspective = new THREE.PerspectiveCamera(39, aspect, 0.1, 180);
    applyCameraFrame(
      perspective,
      getPresentationFrame(measured.foldedBounds, aspect),
      aspect,
    );
    project(measured.foldedBounds, perspective);
    const whole = createInspectionCamera();
    for (const view of INSPECTION_VIEWS) {
      applyCameraFrame(
        whole,
        getInspectionFrame(measured.bounds, view.id, aspect),
        aspect,
      );
      for (let step = 0; step <= 40; step++) {
        applyModelPose(rig, step / 40);
        const actual = new THREE.Box3()
          .setFromObject(scene)
          .translate(new THREE.Vector3(0, measured.groundOffset, 0));
        project(actual, whole);
      }
    }
    applyCameraFrame(
      perspective,
      getPresentationFrame(measured.bounds, aspect, true),
      aspect,
    );
    for (let time = 0; time <= TOTAL; time += 0.5) {
      const flight = getFlight(time);
      applyModelPose(rig, flight.unfold);
      const pose = new THREE.Matrix4().compose(
        new THREE.Vector3(
          flight.x,
          measured.groundOffset + flight.altitude * 0.32,
          flight.z,
        ),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, flight.yaw, flight.bank),
        ),
        new THREE.Vector3(1, 1, 1),
      );
      project(new THREE.Box3().setFromObject(scene), perspective, pose);
    }
  }
  mkdirSync(new URL("../qa/frontend/", import.meta.url), { recursive: true });
  writeFileSync(
    new URL(
      "viewport-framing-report.json",
      new URL("../qa/frontend/", import.meta.url),
    ),
    JSON.stringify(
      {
        passed: true,
        evidence:
          "CSS source layout model plus actual decoded GLB bounding-box projection through unchanged production camera functions; no browser screenshots, browser interactions or physical rerun",
        cssSha256: createHash("sha256").update(css).digest("hex"),
        runtimeSha256: createHash("sha256").update(bytes).digest("hex"),
        layouts,
        posesPerInspectionView: 41,
        inspectionViews: INSPECTION_VIEWS.length,
        flightTimeStepSeconds: 0.5,
        flightDurationSeconds: TOTAL,
        projectedCorners,
        largestAbsoluteNdcXY: largestNdc,
      },
      null,
      2,
    ) + "\n",
  );
});
