import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { createModelRig, applyModelPose } from "./rig";

async function load() {
  const bytes = readFileSync(
    new URL("../public/models/xp4.glb", import.meta.url),
  );
  return new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    );
}

test("V19横梁、螺母与导套是同一真实刚体，固定驱动部件不随行", async () => {
  const { scene } = await load();
  const rig = createModelRig(scene);
  assert.equal(rig.internalDrive.length, 5);
  const moving = [
    "Drive_Crossbeam",
    "Drive_NutCarriage",
    "Drive_GuideBushing_L",
    "Drive_GuideBushing_R",
    "Drive_OutputWeb",
  ];
  for (const name of moving)
    assert.equal(scene.getObjectByName(name)?.parent?.name, "BraceSpreader");
  const fixed = [
    "Drive_MotorHousing",
    "Drive_ReductionHousing",
    "Drive_GuideRail_L",
    "Drive_GuideRail_R",
    "Drive_RingGear",
  ];
  const positions = fixed.map((name) =>
    scene.getObjectByName(name)!.position.clone(),
  );
  for (const u of [0, 1, 0.5, 0.1, 0.89, 0.5, 1, 0]) {
    applyModelPose(rig, u);
    fixed.forEach((name, i) =>
      assert.ok(scene.getObjectByName(name)!.position.equals(positions[i])),
    );
    for (const drive of rig.internalDrive) {
      const travel = rig.spreader!.position.z - rig.spreader!.object.position.z;
      const q = drive.quaternion
        .clone()
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(
            drive.axis,
            ((-2 * Math.PI * travel) / 0.032) * drive.phaseRatio,
          ),
        );
      assert.ok(1 - Math.abs(drive.object.quaternion.dot(q)) < 1e-12);
      assert.ok(drive.object.scale.equals(new THREE.Vector3(1, 1, 1)));
    }
  }
});

test("V19行星齿数、轴位和两套导出动作一致", async () => {
  const { scene, animations } = await load();
  assert.equal(scene.getObjectByName("Drive_SunGear")?.userData.teeth, 12);
  assert.equal(scene.getObjectByName("Drive_RingGear")?.userData.teeth, 24);
  for (let i = 0; i < 3; i++) {
    const planet = scene.getObjectByName(`Drive_PlanetRotor_${i}`)!;
    assert.equal(planet.parent?.name, "Drive_ScrewRotor");
    assert.equal(planet.userData.phaseRatio, -4);
    assert.ok(
      Math.abs(Math.hypot(planet.position.x, planet.position.y) - 0.015) < 1e-7,
    );
    assert.equal(
      scene.getObjectByName(`Drive_PlanetGear_${i}`)?.userData.teeth,
      6,
    );
  }
  for (const clip of animations) {
    for (const name of [
      "Drive_ScrewRotor",
      "Drive_MotorRotor",
      "Drive_PlanetRotor_0",
      "Drive_PlanetRotor_1",
      "Drive_PlanetRotor_2",
    ])
      assert.ok(
        clip.tracks.some((track) => track.name === `${name}.quaternion`),
      );
  }
});
