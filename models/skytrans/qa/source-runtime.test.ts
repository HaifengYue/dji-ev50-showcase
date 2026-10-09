import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as THREE from "../../../threejs/node_modules/three/build/three.module.js";
import { GLTFLoader } from "../../../threejs/node_modules/three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "../../../threejs/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js";
import { applyModelPose, createModelRig } from "../../../threejs/src/aircraft/skytrans/core/rig";
const runtimePath =
  process.env.QA_MODEL ?? new URL("../build/model/xp4.glb", import.meta.url);
function loadManifest() {
  return JSON.parse(
    readFileSync(
      process.env.QA_MANIFEST ??
        new URL("../build/model/model-manifest.json", import.meta.url),
      "utf8",
    ),
  );
}
test("V22压缩保留五传动空节点的静态TRS与全部旋转轨原值", async () => {
  const paths = [
    process.env.QA_SOURCE_MODEL ??
      new URL("../build/model/xp4-source.glb", import.meta.url),
    runtimePath,
  ];
  const buffers = paths.map((path) => readFileSync(path));
  const manifest = loadManifest();
  for (const [index, name] of ["xp4-source.glb", "xp4.glb"].entries()) {
    assert.equal(buffers[index].length, manifest.assets[name].bytes);
    assert.equal(
      createHash("sha256").update(buffers[index]).digest("hex"),
      manifest.assets[name].sha256,
      `${name}必须绑定当前manifest的完整SHA-256`,
    );
  }
  const documents = buffers.map((bytes) =>
    JSON.parse(
      bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"),
    ),
  );
  const models = await Promise.all(
    buffers.map((bytes) =>
      new GLTFLoader()
        .setMeshoptDecoder(MeshoptDecoder)
        .parseAsync(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
          "",
        ),
    ),
  );
  for (const name of [
    "Drive_ScrewRotor",
    "Drive_MotorRotor",
    "Drive_PlanetRotor_0",
    "Drive_PlanetRotor_1",
    "Drive_PlanetRotor_2",
  ]) {
    const nodes = documents.map((doc) =>
      doc.nodes.find((node: { name: string }) => node.name === name),
    );
    for (const field of ["matrix", "translation", "rotation", "scale"]) {
      assert.deepEqual(
        nodes[0][field],
        nodes[1][field],
        `${name}近单位静态姿态不能省略或舍入`,
      );
    }
    for (const sourceClip of models[0].animations) {
      const runtimeClip = models[1].animations.find(
        (clip) => clip.name === sourceClip.name,
      )!;
      const sourceTrack = sourceClip.tracks.find(
        (track) => track.name === `${name}.quaternion`,
      )!;
      const runtimeTrack = runtimeClip.tracks.find(
        (track) => track.name === `${name}.quaternion`,
      )!;
      assert.deepEqual(runtimeTrack.times, sourceTrack.times);
      assert.deepEqual(runtimeTrack.values, sourceTrack.values);
    }
  }
});
