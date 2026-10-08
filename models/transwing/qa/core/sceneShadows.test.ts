import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { createModelRig, applyModelPose, measureModelRig } from "./rig";
import {
  aircraftShadowRadius,
  updateAircraftShadow,
  AIRCRAFT_SHADOW,
} from "./sceneShadows";

function corners(box: THREE.Box3) {
  return [box.min.x, box.max.x].flatMap((x) =>
    [box.min.y, box.max.y].flatMap((y) =>
      [box.min.z, box.max.z].map((z) => new THREE.Vector3(x, y, z)),
    ),
  );
}

test("shadow follows real aircraft envelope across conversion, flight attitude and exploded view", async () => {
  const bytes = readFileSync(
    new URL("../public/models/xp4.glb", import.meta.url),
  );
  const model = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    );
  const rig = createModelRig(model.scene),
    measurements = measureModelRig(rig);
  const envelope = measurements.bounds.clone();
  for (const detail of Object.values(measurements.detailBounds))
    envelope.union(detail);
  const radius = aircraftShadowRadius(envelope, measurements.groundOffset);
  const light = new THREE.DirectionalLight(),
    offset: [number, number, number] = [9, 14, 7];
  const orientations = [
    new THREE.Quaternion(),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.6, 1.1, -0.8)),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)),
  ];
  let maximumProjectedXY = 0,
    checkedCorners = 0;
  for (let i = 0; i <= 80; i++)
    for (const exploded of [false, true]) {
      applyModelPose(rig, i / 80, exploded);
      const geometry = new THREE.Box3().setFromObject(rig.scene);
      for (const orientation of orientations)
        for (const translation of [
          [0, 0, 0],
          [120, 50, -80],
        ]) {
          const anchor = new THREE.Vector3(...translation);
          anchor.y += measurements.groundOffset;
          updateAircraftShadow(light, offset, anchor, radius, exploded);
          light.updateMatrixWorld();
          light.shadow.updateMatrices(light);
          for (const point of corners(geometry)) {
            point.applyQuaternion(orientation).add(anchor);
            const projected = point.clone().project(light.shadow.camera);
            maximumProjectedXY = Math.max(
              maximumProjectedXY,
              Math.abs(projected.x),
              Math.abs(projected.y),
            );
            assert.ok(
              Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1,
              "airframe clipped in shadow map",
            );
            assert.ok(
              projected.z >= -1 && projected.z <= 1,
              "airframe clipped in shadow depth",
            );
            // Ray-project each real envelope corner onto the display ground receiver.
            if (point.y >= AIRCRAFT_SHADOW.groundHeight) {
              const hit = point
                .clone()
                .addScaledVector(
                  new THREE.Vector3(...offset),
                  -(point.y - AIRCRAFT_SHADOW.groundHeight) / offset[1],
                );
              const ground = hit.project(light.shadow.camera);
              assert.ok(
                Math.abs(ground.x) <= 1 + 1e-12 &&
                  Math.abs(ground.y) <= 1 + 1e-12,
              );
              assert.ok(
                ground.z >= -1 && ground.z <= 1,
                "ground receiver clipped at flight altitude",
              );
            }
            checkedCorners++;
          }
          assert.ok(
            Math.abs(
              light.shadow.bias *
                (light.shadow.camera.far - light.shadow.camera.near) +
                0.0001,
            ) < 1e-12,
          );
          assert.equal(light.shadow.normalBias, 0.0005);
        }
    }
  const newTexelUnits = (radius * 2) / AIRCRAFT_SHADOW.mapSize;
  assert.ok(newTexelUnits < 30 / 1024);
  const report = {
    passed: true,
    checkedCorners,
    sampledWingPoses: 81,
    attitudes: 3,
    explodedModes: 2,
    worldTranslations: 2,
    measuredRadius: radius,
    oldTexelUnits: (radius * 2) / 2048,
    newTexelUnits,
    resolutionImprovement: (radius * 2) / 2048 / newTexelUnits,
    maximumProjectedXY,
    normalBiasUnits: 0.0005,
    depthBiasUnits: 0.0001,
    browserTested: false,
  };
  console.log(JSON.stringify(report));
});
