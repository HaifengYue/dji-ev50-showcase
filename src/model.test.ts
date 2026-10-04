import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
async function loadModel() {
  const b = readFileSync(new URL("../public/models/xp4.glb", import.meta.url));
  return (
    await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "")
  ).scene;
}
test("压缩模型包含两片完整机翼与四个随翼动力单元", async () => {
  const scene = await loadModel();
  for (const side of ["L", "R"]) {
    const wing = scene.getObjectByName(`WingPivot_${side}`);
    assert.ok(wing);
    for (const position of ["Front", "Rear"])
      assert.ok(wing.getObjectByName(`Prop_${side}_${position}`));
  }
  // V22新增4个真实中空翼根蒙皮罩，保留V21全部真实支承。
  // 长行程的五轴四元数轨加密；预算3.5MB不降低实体精度。
  assert.ok(
    readFileSync(new URL("../public/models/xp4.glb", import.meta.url))
      .byteLength < 3500000,
    "含流线曲面、紧凑桨根和关键实体精度的压缩模型应小于 3.5 MB",
  );
});
test("整翼铰链将真实电机轴线从竖直向上连续转为向前", async () => {
  const scene = await loadModel();
  const suffixes = ["L_Front", "L_Rear", "R_Front", "R_Rear"];
  function thrust(suffix: string) {
    scene.updateMatrixWorld(true);
    const start = scene.getObjectByName(`MotorAxisStart_${suffix}`);
    const end = scene.getObjectByName(`MotorAxisEnd_${suffix}`);
    assert.ok(start && end, "必须读取独立电机轴线，不能只验证约定的局部 Y");
    return end
      .getWorldPosition(new THREE.Vector3())
      .sub(start.getWorldPosition(new THREE.Vector3()))
      .normalize();
  }
  for (const suffix of suffixes) assert.ok(thrust(suffix).y > 0.9999);
  for (const [name, axis, angle] of [
    ["WingPivot_L", [1, 1, 1], (Math.PI * 2) / 3],
    ["WingPivot_R", [-1, 1, 1], (-Math.PI * 2) / 3],
  ] as const) {
    scene
      .getObjectByName(name)!
      .quaternion.premultiply(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(...axis).normalize(),
          angle,
        ),
      );
  }
  for (const suffix of suffixes) assert.ok(thrust(suffix).z > 0.9999);
});

test("V22保留整翼、四机启停与五条内部传动旋转轨", () => {
  const bytes = readFileSync(
    new URL("../public/models/xp4.glb", import.meta.url),
  );
  const jsonLength = bytes.readUInt32LE(12);
  const model = JSON.parse(
    bytes.subarray(20, 20 + jsonLength).toString("utf8"),
  );
  assert.equal(model.animations.length, 2);
  const mechanism = model.animations.find(
    (clip: { name: string }) => clip.name === "TRANSWING_Hover_Cruise_Hover",
  );
  const motors = model.animations.find(
    (clip: { name: string }) => clip.name === "TRANSWING_Motors_Start_Stop",
  );
  assert.equal(mechanism.channels.length, 18);
  assert.equal(motors.channels.length, 26);
  const names = motors.channels.map(
    (channel: { target: { node: number } }) =>
      model.nodes[channel.target.node].name,
  );
  for (const side of ["L", "R"])
    for (const end of ["Front", "Rear"]) {
      assert.ok(names.includes(`Prop_${side}_${end}`));
      for (const leaf of ["A", "B"])
        assert.ok(names.includes(`BladeFold_${side}_${end}_${leaf}`));
    }
});

test("V24仍保留V20槽顶内收方法和十二枚销端的真实几何收口", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../public/models/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(manifest.version, 24);
  const refinement = manifest.jointRefinements;
  assert.equal(refinement.version, 20);
  assert.equal(refinement.changedNodes.length, 14);
  assert.deepEqual(refinement.newCollisionExemptions, []);
  assert.equal(refinement.slotCovers.length, 2);
  assert.equal(refinement.recessedPins.length, 12);
  for (const slot of refinement.slotCovers) {
    assert.ok(slot.volumeAfter > 0 && slot.volumeAfter < slot.volumeBefore);
    assert.equal(slot.originalRefinementMethodPreserved, true);
    assert.equal(slot.radialSetback, 0.002);
  }
  for (const pin of refinement.recessedPins) {
    assert.equal(pin.transformPreserved, true);
    assert.ok(pin.volume > 0);
  }
});

test("新翼端球铰真实内移且所有支承有实际节点与有限接口", async () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../public/models/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const scene = await loadModel();
  let meshes = 0;
  scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes++;
  });
  assert.equal(meshes, 283);
  assert.equal(manifest.assetEncoding.runtimeBudgetBytes, 3500000);
  for (const [side, sign] of [
    ["L", -1],
    ["R", 1],
  ] as const) {
    const anchor = scene.getObjectByName(`BraceWing_${side}`)!;
    assert.ok(Math.abs(anchor.position.x + sign * 0.38) < 1e-6);
    assert.ok(Math.abs(anchor.position.y - 0.05454436791055261) < 1e-6);
    assert.ok(Math.abs(anchor.position.z + 0.33) < 1e-6);
    assert.equal(anchor.parent?.name, `WingPivot_${side}`);
    assert.ok(scene.getObjectByName(`RootBearingHousing_${side}`));
  }
  assert.ok(
    manifest.mechanism.sliderTravel[0] >=
      manifest.mechanism.actualSlotTravel[0],
  );
  assert.ok(
    manifest.mechanism.sliderTravel[1] <
      manifest.mechanism.actualSlotTravel[1] + 1e-6,
  );
  assert.equal(manifest.hingeSupports.newNodes.length, 8);
  assert.equal(manifest.controlSupports.newNodes.length, 12);
  for (const group of [manifest.hingeSupports, manifest.controlSupports]) {
    for (const name of group.newNodes)
      assert.ok(
        scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name)),
        name,
      );
    assert.ok(group.fixedAttachmentInterfaces.length > 0);
    assert.ok(
      group.rotatingSupportInterfaces.every(
        (joint: { boreRadius: number; shaftRadius: number }) =>
          joint.boreRadius > joint.shaftRadius,
      ),
    );
  }
  for (const side of ["L", "R"])
    assert.equal(
      scene.getObjectByName(`CargoHingeMovingSeat_${side}`)?.parent?.name,
      "CargoHoodPivot",
    );
  for (const key of [
    "L_Inboard",
    "L_Outboard",
    "R_Inboard",
    "R_Outboard",
    "Tail_L",
    "Tail_R",
  ]) {
    assert.equal(
      scene.getObjectByName(`ControlHingeMoving_${key}`)?.parent?.name,
      `ControlPivot_${key}`,
    );
    assert.equal(
      manifest.controlSupports.rotatingSupportInterfaces.filter(
        (joint: { key: string }) => joint.key === key,
      ).length,
      2,
    );
  }
  assert.equal(manifest.surfaceSupports.changedNodes.length, 21);
  assert.equal(manifest.surfaceSupports.finiteContactPairs.length, 23);
  assert.ok(
    manifest.surfaceSupports.finiteContactPairs.every(
      (pair: { strictInteriorSamples: number }) =>
        pair.strictInteriorSamples >= 4,
    ),
  );
});

test("V22压缩保留五传动空节点的静态TRS与全部旋转轨原值", async () => {
  const paths = [
    "../assets/blender/xp4-source.glb",
    "../public/models/xp4.glb",
  ];
  const buffers = paths.map((path) =>
    readFileSync(new URL(path, import.meta.url)),
  );
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

test("新球心、刚杆闭合、实际槽轮廓和低置布局均有可复算契约", async () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../public/models/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const scene = await loadModel();
  assert.equal(manifest.redTargetFootprint, undefined);
  assert.equal(manifest.redTargetMapping, undefined);
  assert.equal(
    manifest.wingAttachmentReference.exactImagePixelRegistrationClaimed,
    false,
  );
  const pivot = new THREE.Vector3(1.5, -0.22, 1.47);
  const anchor = new THREE.Vector3(1.12, -0.16545563208944739, 1.14);
  const body = new THREE.Vector3(0.16, -0.02, -1.9);
  const length = anchor.distanceTo(body);
  const hoverAnchor = anchor
    .clone()
    .sub(pivot)
    .applyAxisAngle(new THREE.Vector3(-1, 1, 1).normalize(), (2 * Math.PI) / 3)
    .add(pivot);
  const hoverSlider =
    -hoverAnchor.z +
    Math.sqrt(
      length ** 2 -
        (hoverAnchor.x - body.x) ** 2 -
        (hoverAnchor.y - body.y) ** 2,
    );
  assert.ok(Math.abs(manifest.mechanism.sides.R.braceLength - length) < 1e-6);
  assert.ok(Math.abs(manifest.mechanism.sliderTravel[0] - hoverSlider) < 1e-6);
  assert.ok(manifest.mechanism.sliderTravel[0] >= 0.9104609710668883);
  assert.ok(Math.abs(manifest.mechanism.sliderTravel[1] - 1.9) < 1e-6);
  assert.ok(
    manifest.mechanism.slotEnvelopeBlender.actualRoundedOutlineRightXY.length >
      50,
  );
  assert.deepEqual(manifest.internalDrive.layoutV22.guideSpan, [0.82, 1.992]);
  assert.deepEqual(
    manifest.internalDrive.layoutV22.screwThreadSpan,
    [0.855, 1.95],
  );
  assert.deepEqual(manifest.internalDrive.cavity.blenderYRange, [0.2, 2.055]);
  for (const side of ["L", "R"]) {
    assert.ok(scene.getObjectByName(`RootFairingFixed_${side}`));
    assert.equal(
      scene.getObjectByName(`RootFairingMoving_${side}`)?.parent?.name,
      `WingPivot_${side}`,
    );
  }
  assert.equal(manifest.surfaceFinishV22.rows.length, 4);
  assert.ok(
    manifest.surfaceFinishV22.rows.every(
      (r: { positionsUnchanged: boolean; topologyUnchanged: boolean }) =>
        r.positionsUnchanged && r.topologyUnchanged,
    ),
  );
});

test("新分层翼根有可复算移轴和闭合材料契约；实际净空由独立物理门检验", async () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../public/models/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const seam = manifest.wingSeamRefinement;
  const layered = manifest.layeredWingJoint;
  assert.equal(manifest.version, 24);
  assert.equal(seam.version, 24);
  assert.equal(seam.axialGap, 0.006);
  assert.equal(manifest.rootInterface.axisHalfGap, 0.003);
  assert.equal(manifest.rootInterface.geometryContract, "layeredWingJoint");
  assert.equal(manifest.mechanism.rootClearance, 0.006);
  assert.equal(seam.hardwareHalfGapPreserved, 0.012);
  assert.equal(seam.fairingSeamPreserved, 0.003);
  assert.equal(manifest.fairingRefinements.nominalWallThickness, 0.0025);
  assert.equal(layered.fullStrokeRequiresNewCollisionEvidence, true);
  assert.equal(manifest.surfaceRefinements.root.mechanismAxesUnchanged, false);
  assert.equal(
    manifest.internalDrive.loweredLayout.bodyBallAndWingTrajectoryUnchanged,
    false,
  );
  const scene = await loadModel();
  for (const [side, sign] of [
    ["L", -1],
    ["R", 1],
  ] as const) {
    const pivot = scene.getObjectByName(`WingPivot_${side}`)!;
    assert.ok(
      pivot.position.distanceTo(new THREE.Vector3(sign * 1.5, -0.22, 1.47)) <
        1e-6,
    );
  }
  for (const name of layered.rebasedDirectChildren)
    assert.ok(
      scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name)),
      name,
    );
  assert.equal(manifest.wingSeamTopology.version, 24);
  assert.deepEqual(
    manifest.wingSeamTopology.parts.map((p: { node: string }) => p.node).sort(),
    ["Composite_wing_L", "Composite_wing_R", "Fixed_root_L", "Fixed_root_R"],
  );
  for (const part of manifest.wingSeamTopology.parts) {
    assert.equal(part.nonManifoldEdges, 0);
    assert.equal(part.zeroAreaFaces, 0);
    assert.ok(part.volume > 1e-10);
  }
});

test("V24机腹槽为真实平直双唇，中央底板和未改源表面有明确保护", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../public/models/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const slot = manifest.straightFuselageSlot;
  assert.equal(slot.version, 24);
  assert.deepEqual(slot.longRangeBlenderY, [0.9, 1.93]);
  assert.equal(slot.nominalVerticalLipSeparation, 0.055);
  assert.equal(slot.protectedCentralFloorMaximumAbsX, 0.074);
  assert.equal(slot.outerProfileBlendCoreAbsX, 0.092);
  for (let i = 0; i < 2; i++) {
    assert.ok(
      Math.abs(
        slot.outerLipRightEndpoints[i][2] -
          slot.innerLipRightEndpoints[i][2] -
          0.055,
      ) < 1e-12,
    );
  }
  assert.equal(slot.topology.boundaryEdges, 0);
  assert.equal(slot.topology.nonManifoldEdges, 0);
  assert.equal(slot.topology.zeroAreaLimit, 1e-18);
  assert.equal(slot.topology.collisionThresholdsUnchanged, true);
  assert.ok(slot.topology.maximumNumericalVertexDisplacement <= 1e-7);
  assert.ok(
    Math.abs(slot.topology.afterVolume - slot.topology.beforeVolume) <= 1e-13,
  );
  assert.ok(
    slot.topology.removedCoincidentOppositePairs.every(
      (row: {
        exactlyCoincident: boolean;
        oppositeWinding: boolean;
        materialVolume: number;
      }) =>
        row.exactlyCoincident &&
        row.oppositeWinding &&
        row.materialVolume === 0,
    ),
  );
  assert.match(slot.preservation.dataSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    slot.preservation.restoredObjects
      .map((row: { node: string }) => row.node)
      .sort(),
    [
      "CargoHoodShell",
      "Dorsal_hatch_main",
      "Lower_fuselage_join",
      "Lower_fuselage_join.002",
    ].sort(),
  );
});

test("低置驱动与每侧单直件保持原球心及一个同步滑架", async () => {
  const scene = await loadModel();
  scene.updateMatrixWorld(true);
  const screw = scene.getObjectByName("Drive_ScrewRotor");
  const motor = scene.getObjectByName("Drive_MotorRotor");
  const spreader = scene.getObjectByName("BraceSpreader");
  assert.ok(screw && motor && spreader);
  for (const node of [screw, motor]) {
    assert.ok(
      Math.abs(node.getWorldPosition(new THREE.Vector3()).y - 0.077) < 1e-7,
    );
  }
  assert.ok(Math.abs(spreader.position.y + 0.02) < 1e-7);
  for (const side of ["L", "R"]) {
    for (const prefix of ["Drive_GuideRail_", "Drive_GuideBushing_"]) {
      const node = scene.getObjectByName(prefix + side);
      assert.ok(node);
      const center = new THREE.Box3()
        .setFromObject(node)
        .getCenter(new THREE.Vector3());
      assert.ok(Math.abs(center.y - 0.065) < 1e-7);
    }
    const link = scene.getObjectByName("BraceBodyCarriage_" + side);
    assert.ok(link instanceof THREE.Mesh);
    assert.equal(link.parent?.name, "BraceSpreader");
    const ends = link.userData.straightOutputEndpointsLocal as number[][];
    assert.equal(ends.length, 2);
    const [a, b]: THREE.Vector3[] = ends.map(([x, y, z]): THREE.Vector3 =>
      new THREE.Vector3(x, z, -y).applyMatrix4(spreader.matrixWorld),
    );
    const delta: THREE.Vector3 = b.clone().sub(a);
    const length: number = delta.length();
    const axis = delta.normalize();
    const positions = link.geometry.attributes.position;
    let minimum = Infinity;
    let maximum = -Infinity;
    let radius = 0;
    for (let i = 0; i < positions.count; i++) {
      const p = new THREE.Vector3()
        .fromBufferAttribute(positions, i)
        .applyMatrix4(link.matrixWorld)
        .sub(a);
      const t = p.dot(axis);
      minimum = Math.min(minimum, t);
      maximum = Math.max(maximum, t);
      radius = Math.max(radius, p.addScaledVector(axis, -t).length());
    }
    // 直接检查实际解码顶点包络，不能只用名称把折弯件叫作直件。
    assert.ok(minimum >= -6e-5 && minimum < 6e-5);
    assert.ok(maximum <= length + 6e-5 && maximum > length - 6e-5);
    assert.ok(radius <= 0.007 + 6e-5 && radius >= 0.007 - 6e-5);
  }
});
