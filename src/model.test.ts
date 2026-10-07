import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { applyModelPose, createModelRig } from "./rig";
const runtimePath =
  process.env.QA_MODEL ?? new URL("../public/models/xp4.glb", import.meta.url);
function loadManifest() {
  return JSON.parse(
    readFileSync(
      process.env.QA_MANIFEST ??
        new URL("../public/models/manifest.json", import.meta.url),
      "utf8",
    ),
  );
}
function loadBaselineManifest() {
  return JSON.parse(
    readFileSync(
      new URL("../assets/baseline-20261007/manifest.json", import.meta.url),
      "utf8",
    ),
  );
}
async function loadModel() {
  const b = readFileSync(runtimePath);
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
  // V27下蒙皮已与Composite合体，保留语义空锚和完整材质；批准的4.2MB性能预算
  // 不以量化关键薄壁、删减几何或放宽实体检查换取体积。
  assert.ok(
    readFileSync(runtimePath).byteLength < 4200000,
    "含新闭合下蒙皮和关键实体精度的压缩模型应小于 4.2 MB",
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
  const bytes = readFileSync(runtimePath);
  const jsonLength = bytes.readUInt32LE(12);
  const model = JSON.parse(
    bytes.subarray(20, 20 + jsonLength).toString("utf8"),
  );
  assert.equal(model.nodes.length, 352);
  assert.equal(
    model.nodes.filter((node: { mesh?: number }) => node.mesh !== undefined)
      .length,
    285,
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

test("V27明确标识新修订；冻结V24的槽顶和十二销记录仅作历史来源", () => {
  const manifest = loadManifest();
  assert.equal(manifest.version, 27);
  assert.match(
    manifest.annotationRevision.id,
    /^2026-10-07-v27-inset-integrated-b(?:-[a-z0-9]+)*$/,
  );
  assert.equal(
    manifest.annotationRevision.baselineCommit,
    "1797d4b1a0d653f786552116a3e9063148b444de",
  );
  assert.equal(
    manifest.annotationRevision.baselineManifest,
    "assets/baseline-v25-20261007/manifest.json",
  );
  assert.equal(
    manifest.annotationRevision.supersedesBaselineGeometryEvidence,
    true,
  );
  const expectedSource = process.env.QA_EXPECTED_SOURCE_CANDIDATE_SHA256;
  assert.ok(
    expectedSource,
    "验收必须提供独立确认的本轮作者源SHA，不能从被测manifest自取",
  );
  assert.match(expectedSource, /^[a-f0-9]{64}$/);
  assert.equal(
    manifest.annotationRevision.sourceCandidateSha256,
    expectedSource,
  );
  assert.equal(
    manifest.annotationRevision.old82And136ConstructionInputsUnchanged,
    true,
  );
  const baseline = loadBaselineManifest();
  assert.equal(baseline.version, 24);
  const refinement = baseline.jointRefinements;
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

test("V27当前球心和全部支承节点真实存在，未改舱盖和舵铰契约保留", async () => {
  const manifest = loadManifest();
  const baseline = loadBaselineManifest();
  const scene = await loadModel();
  let meshes = 0;
  scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes++;
  });
  assert.equal(meshes, 287);
  assert.equal(manifest.variants.xp4.meshes, 285);
  assert.equal(manifest.variants.xp4.meshOwningNodes, 285);
  assert.equal(manifest.variants.xp4.renderedMeshPrimitives, meshes);
  assert.equal(
    manifest.assetEncoding.runtimeBudgetReview.approvedBudgetBytes,
    4200000,
  );
  assert.equal(manifest.variants.xp4.rawNodes, 352);
  const criticalOwners: string[] =
    manifest.assetEncoding.quantization.float32PositionExceptions;
  assert.equal(criticalOwners.length, 177);
  assert.equal(new Set(criticalOwners).size, 177);
  let criticalPrimitives = 0;
  for (const name of criticalOwners) {
    const owner = scene.getObjectByName(
      THREE.PropertyBinding.sanitizeNodeName(name),
    );
    assert.ok(owner, name);
    let primitives = 0;
    owner.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return;
      primitives++;
      assert.ok(
        part.geometry.getAttribute("position").array instanceof Float32Array,
        `${name}每个材质primitive都必须保留Float32`,
      );
    });
    assert.ok(primitives > 0, `${name}必须是实际几何owner，不能用EMPTY替代`);
    criticalPrimitives += primitives;
  }
  assert.equal(criticalPrimitives, 179);
  for (const [side, sign] of [
    ["L", -1],
    ["R", 1],
  ] as const) {
    const anchor = scene.getObjectByName(`BraceWing_${side}`)!;
    const expectedLocal = new THREE.Vector3(
      -sign * (1.5001282691955566 - 1.059999942779541),
      -0.17669521272182465 + 0.22012822329998016,
      1.0399999618530273 - 1.4448717832565308,
    );
    assert.ok(anchor.position.distanceTo(expectedLocal) < 1e-6);
    assert.equal(anchor.parent?.name, `WingPivot_${side}`);
    assert.ok(scene.getObjectByName(`RootBearingHousing_${side}`));
  }
  // Old slot-preparation bounds are lineage only, not the current stroke or
  // current full-material aperture-admission certificate.
  assert.equal(
    manifest.mechanism.historicalPersistentFieldsAreNotCurrentAcceptance,
    true,
  );
  for (const key of ["actualSlotAdmission", "earlySlotPreparation"])
    assert.ok(manifest.mechanism.historicalPersistentFields.includes(key));
  assert.equal(
    manifest.mechanism.persistentContract.previousAdmissionNotCurrentAcceptance,
    true,
  );
  assert.deepEqual(
    manifest.internalDrive.stroke,
    manifest.mechanism.sliderTravel,
  );
  const actualTravel = manifest.mechanism.persistentContract.actualTravel;
  assert.equal(actualTravel.samples, 4001);
  assert.equal(actualTravel.continuousExtremaProof, false);
  assert.deepEqual(
    [actualTravel.minimumY, actualTravel.maximumY],
    manifest.mechanism.sliderTravel,
  );
  assert.equal(
    manifest.internalDrive
      .historicalContactRecordsAreNotCurrentGeometryCertificates,
    true,
  );
  assert.equal(manifest.internalDrive.fixedAttachmentInterfaces, undefined);
  assert.equal(
    manifest.internalDrive.legacySliderRestYNotConsumedByProductionOrExport,
    true,
  );
  assert.ok(
    manifest.internalDrive.legacyDriveMetadata.every(
      (row: { usedByProduction: boolean }) => row.usedByProduction === false,
    ),
  );
  assert.equal(baseline.hingeSupports.newNodes.length, 8);
  assert.equal(baseline.controlSupports.newNodes.length, 12);
  // Read the original named inventory, then check the actual current scene.
  // The old root contact coordinates are not current material evidence.
  for (const group of [baseline.hingeSupports, baseline.controlSupports]) {
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
      baseline.controlSupports.rotatingSupportInterfaces.filter(
        (joint: { key: string }) => joint.key === key,
      ).length,
      2,
    );
  }
});

test("冻结V24的23处表面接触见证仍完整保存，不作为V27新接触证明", () => {
  const baseline = loadBaselineManifest();
  assert.equal(baseline.surfaceSupports.changedNodes.length, 21);
  assert.equal(baseline.surfaceSupports.finiteContactPairs.length, 23);
  assert.ok(
    baseline.surfaceSupports.finiteContactPairs.every(
      (pair: { strictInteriorSamples: number }) =>
        pair.strictInteriorSamples >= 4,
    ),
  );
});

test("V22压缩保留五传动空节点的静态TRS与全部旋转轨原值", async () => {
  const paths = [
    process.env.QA_SOURCE_MODEL ??
      new URL("../assets/blender/xp4-source.glb", import.meta.url),
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

test("新球心、刚杆闭合、实际槽轮廓和低置布局均有可复算契约", async () => {
  const manifest = loadManifest();
  const scene = await loadModel();
  assert.equal(manifest.redTargetFootprint, undefined);
  assert.equal(manifest.redTargetMapping, undefined);
  assert.equal(
    manifest.wingAttachmentReference.exactImagePixelRegistrationClaimed,
    false,
  );
  const pivot = new THREE.Vector3(
    1.5001282691955566,
    -0.22012822329998016,
    1.4448717832565308,
  );
  // Independently fixed revision target and final authored skin ray; retain
  // the existing 1e-6 encoding bound rather than fitting to the loaded model.
  const anchor = new THREE.Vector3(
    1.059999942779541,
    -0.17669521272182465,
    1.0399999618530273,
  );
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
  assert.ok(Math.abs(length - 3.0786610396187717) < 1e-6);
  assert.equal(manifest.mechanism.currentRigidRodLength, 3.0786610396187717);
  assert.equal(manifest.mechanism.persistentContract.foldAngleDegrees, 120);
  // V27 explicitly moved the front stops. Current actual-mesh records replace
  // the historical V25 center; fixed-layout/cavity contact certificates do not.
  assert.equal(
    manifest.internalDrive.fixedLayoutAndStopGeometryPreserved,
    false,
  );
  assert.equal(
    manifest.internalDrive.fixedDriveLayoutPreservedExceptExplicitFrontStops,
    false,
  );
  assert.equal(
    manifest.internalDrive.motionContractRevision,
    manifest.annotationRevision.id,
  );
  for (const stop of manifest.internalDrive.actualFrontStopMeshesBlender) {
    assert.ok(Math.abs(stop.stopCenterBlenderY - 0.7999326) < 1e-7);
    assert.ok(Math.abs(stop.innerFaceBlenderY - 0.8039326) < 1e-7);
    assert.ok(Math.abs(stop.hoverGap - 0.004000019282102807) < 1e-7);
  }
  assert.equal(manifest.internalDrive.actualFrontStopMeshesBlender.length, 2);
  assert.ok(
    Math.abs(manifest.mechanism.sliderTravel[0] - 0.8409326081856277) < 1e-6,
  );
  assert.ok(
    Math.abs(manifest.mechanism.sliderTravel[1] - 1.9000001249111587) < 1e-6,
  );
  assert.ok(
    manifest.mechanism.slotEnvelopeBlender.actualRoundedOutlineRightXY.length >
      50,
  );
  assert.ok(
    Math.abs(
      manifest.internalDrive.currentLayout.guideSpan[0] - 0.7395765445219613,
    ) < 1e-7,
  );
  assert.ok(
    Math.abs(manifest.internalDrive.currentLayout.guideSpan[1] - 1.992) < 2e-7,
  );
  assert.ok(
    Math.abs(
      manifest.internalDrive.currentLayout.screwThreadSpan[0] -
        0.7745765362249948,
    ) < 1e-7,
  );
  assert.ok(
    Math.abs(manifest.internalDrive.currentLayout.screwThreadSpan[1] - 1.95) <
      1e-7,
  );
  // Only check the frozen historical cavity record as historical identity.
  assert.deepEqual(
    loadBaselineManifest().internalDrive.cavity.blenderYRange,
    [0.2, 2.055],
  );
  assert.equal(manifest.internalDrive.cavity, undefined);
  for (const side of ["L", "R"]) {
    assert.ok(scene.getObjectByName(`RootFairingFixed_${side}`));
    assert.equal(
      scene.getObjectByName(`RootFairingMoving_${side}`)?.parent?.name,
      `WingPivot_${side}`,
    );
  }
});

test("V27 EMPTY下蒙皮锚保留，完整Composite双材质owner为实际Float32闭体", async () => {
  const scene = await loadModel();
  const manifest = loadManifest();
  for (const side of ["L", "R"]) {
    const alias = scene.getObjectByName(`WingLowerClosure_${side}`);
    const blue = scene.getObjectByName(`WingLowerClosureBlue_${side}`);
    const owner = scene.getObjectByName(`Composite_wing_${side}`);
    assert.ok(alias && owner && blue instanceof THREE.Mesh);
    assert.equal(alias instanceof THREE.Mesh, false);
    assert.equal(alias.children.length, 0);
    assert.equal(alias.parent?.name, `WingPivot_${side}`);
    assert.equal(owner.parent?.name, `WingPivot_${side}`);
    assert.equal(
      manifest.annotationRevision.lowerSkin.materialOwner[side],
      owner.name,
    );
    const aliasContract = manifest.annotationRevision.lowerSkin.aliases.find(
      (row: { node: string }) => row.node === alias.name,
    );
    assert.equal(aliasContract.type, "EMPTY");
    assert.equal(aliasContract.materialOwner, owner.name);
    assert.equal(
      manifest.annotationRevision.lowerSkin.uniformFinalThicknessClaimed,
      false,
    );
    assert.equal(blue.parent?.name, `WingPivot_${side}`);
    assert.equal(blue.userData.coatingHost, alias.name);
    assert.equal(blue.userData.coatingOffset, 0.0004);
    const parts = owner instanceof THREE.Mesh ? [owner] : owner.children;
    assert.equal(parts.length, 2, "白/蓝两材质primitive必须全部参与实体检查");
    const edges = new Map<string, { count: number; orientation: number }>();
    let volume = 0;
    let triangleCount = 0;
    for (const part of [...parts, blue]) {
      assert.ok(part instanceof THREE.Mesh);
      assert.equal(part.visible, true);
      assert.ok(part.scale.equals(new THREE.Vector3(1, 1, 1)));
      assert.ok(
        part.geometry.getAttribute("position").array instanceof Float32Array,
        `${part.name}不得重新量化关键薄面`,
      );
    }
    for (const part of parts) {
      assert.ok(part instanceof THREE.Mesh);
      const positions = part.geometry.getAttribute("position");
      const index = part.geometry.index;
      const count = index?.count ?? positions.count;
      assert.ok(count > 0 && count % 3 === 0);
      for (let offset = 0; offset < count; offset += 3) {
        const vertices: THREE.Vector3[] = [0, 1, 2].map((i): THREE.Vector3 => {
          const point = new THREE.Vector3().fromBufferAttribute(
            positions,
            index ? index.getX(offset + i) : offset + i,
          );
          return part === owner ? point : point.applyMatrix4(part.matrix);
        });
        assert.ok(vertices.every((v) => v.toArray().every(Number.isFinite)));
        const [a, b, c] = vertices;
        assert.ok(
          b.clone().sub(a).cross(c.clone().sub(a)).length() / 2 > 1e-18,
          `${owner.name}不能保留真实退化或低于面积门的导出三角形`,
        );
        volume += a.dot(b.clone().cross(c)) / 6;
        triangleCount++;
        const keys = vertices.map((v) => v.toArray().join(","));
        for (let edge = 0; edge < 3; edge++) {
          const from = keys[edge],
            to = keys[(edge + 1) % 3];
          const forward = from < to;
          const key = forward ? `${from}/${to}` : `${to}/${from}`;
          const entry = edges.get(key) ?? { count: 0, orientation: 0 };
          entry.count++;
          entry.orientation += forward ? 1 : -1;
          edges.set(key, entry);
        }
      }
    }
    assert.ok(triangleCount > 0);
    // Exact decoded coordinate identity across both material primitives.
    assert.ok(
      [...edges.values()].every(
        (edge) => edge.count === 2 && edge.orientation === 0,
      ),
      `${owner.name}全部材质必须组成完整闭体，不能跳过Group或只验其中一色`,
    );
    assert.ok(volume > 1e-10, `${owner.name}必须有正实体体积`);
  }
});

test("V27实际滑架4001姿态保留定长闭环，实际移动件不穿过当前固定止挡", async () => {
  const scene = await loadModel();
  const rig = createModelRig(scene);
  assert.ok(rig.spreader);
  assert.equal(rig.braces.length, 2);
  for (const brace of rig.braces)
    assert.ok(Math.abs(brace.length - 3.0786610396187717) < 1e-6);
  const stops = (["L", "R"] as const).map((side) => {
    const front = scene.getObjectByName(`Drive_FrontTravelStop_${side}`);
    const rear = scene.getObjectByName(`Drive_RearTravelStop_${side}`);
    assert.ok(front instanceof THREE.Mesh && rear instanceof THREE.Mesh);
    const frontBounds = new THREE.Box3().setFromObject(front);
    const rearBounds = new THREE.Box3().setFromObject(rear);
    assert.ok(
      Math.abs(frontBounds.getCenter(new THREE.Vector3()).z + 0.7999326) < 1e-7,
    );
    assert.ok(
      Math.abs(rearBounds.getCenter(new THREE.Vector3()).z + 1.947) < 1e-7,
    );
    assert.ok(Math.abs(frontBounds.min.z + 0.8039326) < 1e-7);
    const bushing = scene.getObjectByName(`Drive_GuideBushing_${side}`);
    assert.ok(bushing instanceof THREE.Mesh);
    return {
      front,
      rear,
      bushing,
      frontMatrix: front.matrixWorld.clone(),
      rearMatrix: rear.matrixWorld.clone(),
      frontBounds,
      rearBounds,
    };
  });
  let minimumTravel = Infinity,
    maximumTravel = -Infinity,
    frontGap = Infinity,
    rearGap = Infinity,
    guideGap = Infinity;
  const movingMeshes: THREE.Mesh[] = [];
  rig.spreader.object.traverse((part) => {
    if (part instanceof THREE.Mesh) movingMeshes.push(part);
  });
  assert.ok(movingMeshes.length > 0);
  for (let sample = 0; sample <= 4000; sample++) {
    applyModelPose(rig, sample / 4000);
    const travel = -rig.spreader.object.position.z;
    minimumTravel = Math.min(minimumTravel, travel);
    maximumTravel = Math.max(maximumTravel, travel);
    const moving = new THREE.Box3().setFromObject(rig.spreader.object);
    for (const stop of stops) {
      assert.ok(stop.front.matrixWorld.equals(stop.frontMatrix));
      assert.ok(stop.rear.matrixWorld.equals(stop.rearMatrix));
      // The union AABB contains empty space between output links. Test every
      // actual moving mesh that overlaps the stop's transverse cross-section;
      // keep strict positive separation, not a relaxed penetration tolerance.
      for (const part of movingMeshes) {
        const bounds = new THREE.Box3().setFromObject(part);
        for (const [end, fixed] of [
          ["front", stop.frontBounds],
          ["rear", stop.rearBounds],
        ] as const) {
          const transverseOverlap =
            Math.min(bounds.max.x, fixed.max.x) >=
              Math.max(bounds.min.x, fixed.min.x) &&
            Math.min(bounds.max.y, fixed.max.y) >=
              Math.max(bounds.min.y, fixed.min.y);
          if (!transverseOverlap) continue;
          const separation =
            end === "front"
              ? fixed.min.z - bounds.max.z
              : bounds.min.z - fixed.max.z;
          assert.ok(separation > 0, `${part.name}不得穿过${end}止挡`);
          if (end === "front") frontGap = Math.min(frontGap, separation);
        }
      }
      const actualGuideGap =
        stop.frontBounds.min.z -
        new THREE.Box3().setFromObject(stop.bushing).max.z;
      assert.ok(actualGuideGap > 0);
      guideGap = Math.min(guideGap, actualGuideGap);
      const rearSeparation = moving.min.z - stop.rearBounds.max.z;
      assert.ok(rearSeparation > 0);
      rearGap = Math.min(rearGap, rearSeparation);
    }
    for (const { rod, body, wing, length } of rig.braces) {
      const start = body.getWorldPosition(new THREE.Vector3());
      const end = wing.getWorldPosition(new THREE.Vector3());
      assert.ok(Math.abs(start.distanceTo(end) - length) < 1e-6);
      assert.ok(rod.localToWorld(new THREE.Vector3()).distanceTo(start) < 1e-6);
      assert.ok(
        rod.localToWorld(new THREE.Vector3(0, length, 0)).distanceTo(end) <
          1e-6,
      );
      assert.ok(rod.scale.equals(new THREE.Vector3(1, 1, 1)));
    }
  }
  assert.ok(Math.abs(minimumTravel - 0.8409326081856277) < 1e-6);
  assert.ok(Math.abs(maximumTravel - 1.9000001249111587) < 1e-6);
  assert.ok(Math.abs(frontGap - 0.004000019282102807) < 1e-6);
  assert.ok(Math.abs(rearGap - 0.02300005) < 1e-6);
  assert.ok(Math.abs(guideGap - 0.004000019282102807) < 1e-6);
  assert.ok(
    Math.abs(
      loadManifest().internalDrive.actualMinimumFrontStopBushingGap - guideGap,
    ) < 1e-6,
  );
  // This establishes finite sampled longitudinal separation, not a complete
  // continuous-motion or whole-aircraft material-clearance certificate.
});

test("冻结V24的四片V22涂层法向记录只核历史身份，不继承到新裁分蓝皮", () => {
  const baseline = loadBaselineManifest();
  assert.equal(baseline.surfaceFinishV22.rows.length, 4);
  assert.ok(
    baseline.surfaceFinishV22.rows.every(
      (r: { positionsUnchanged: boolean; topologyUnchanged: boolean }) =>
        r.positionsUnchanged && r.topologyUnchanged,
    ),
  );
});

test("V27保留真实移轴；旧分层材料证书显式冻结且不替代新几何门", async () => {
  const manifest = loadManifest();
  const baseline = loadBaselineManifest();
  const seam = baseline.wingSeamRefinement;
  const layered = baseline.layeredWingJoint;
  assert.equal(manifest.version, 27);
  assert.equal(seam.version, 24);
  assert.equal(seam.axialGap, 0.006);
  assert.equal(baseline.rootInterface.axisHalfGap, 0.003);
  assert.equal(baseline.rootInterface.geometryContract, "layeredWingJoint");
  assert.equal(baseline.mechanism.rootClearance, 0.006);
  assert.equal(seam.hardwareHalfGapPreserved, 0.012);
  assert.equal(seam.fairingSeamPreserved, 0.003);
  assert.equal(baseline.fairingRefinements.nominalWallThickness, 0.0025);
  assert.equal(layered.independentFinalGeometryGateRequired, true);
  assert.equal(
    layered.schema,
    "transwing.annotated-root-interface.segmented-tail-v7d.v1",
  );
  assert.equal(layered.phase, "repair-trim-required-closing-complete");
  assert.equal(baseline.surfaceRefinements.root.mechanismAxesUnchanged, false);
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
      pivot.position.distanceTo(
        new THREE.Vector3(
          sign * 1.5001282691955566,
          -0.22012822329998016,
          1.4448717832565308,
        ),
      ) < 1e-6,
    );
  }
  for (const name of baseline.nativeAnnotatedStaging.rebase.sides.flatMap(
    (side: { directSubtrees: string[] }) => side.directSubtrees,
  ))
    assert.ok(
      scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name)),
      name,
    );
  assert.equal(baseline.wingSeamTopology.version, 24);
  assert.deepEqual(
    baseline.wingSeamTopology.parts.map((p: { node: string }) => p.node).sort(),
    ["Composite_wing_L", "Composite_wing_R", "Fixed_root_L", "Fixed_root_R"],
  );
  for (const part of baseline.wingSeamTopology.parts) {
    assert.equal(part.nonManifoldEdges, 0);
    assert.equal(part.zeroAreaFaces, 0);
    assert.ok(part.volume > 1e-10);
  }
});

test("V24机腹槽为真实平直双唇，中央底板和未改源表面有明确保护", () => {
  const manifest = loadManifest();
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

test("标注内移联动保留原导程并以当前原生几何记录替代旧前端布局", async () => {
  const manifest = loadManifest();
  const scene = await loadModel();
  assert.equal(
    manifest.annotationRevision.old171ConstructionInputsUnchanged,
    true,
  );
  assert.equal(manifest.mechanism.currentLinkedInsetTargetAbsX, 1.06);
  assert.equal(manifest.internalDrive.currentLayout.lead, 0.032);
  assert.equal(
    manifest.internalDrive.currentLayout.motorGearboxCoreRearSupportChanged,
    false,
  );
  assert.equal(manifest.internalDrive.layoutV22, undefined);
  assert.deepEqual(
    manifest.internalDrive.historicalLayoutV22.guideSpan,
    [0.82, 1.992],
  );
  for (const side of ["L", "R"]) {
    const rail = scene.getObjectByName(`Drive_GuideRail_${side}`);
    assert.ok(rail instanceof THREE.Mesh);
    const bounds = new THREE.Box3().setFromObject(rail);
    assert.ok(Math.abs(bounds.max.z + 0.7395765445219613) < 2e-7);
    assert.ok(Math.abs(bounds.min.z + 1.9920001029968262) < 2e-7);
  }
  const thread = scene.getObjectByName("Drive_LeadScrewThread");
  assert.ok(thread instanceof THREE.Mesh);
  const threadBounds = new THREE.Box3().setFromObject(thread);
  assert.ok(Math.abs(threadBounds.max.z + 0.7707765362249948) < 2e-7);
  assert.ok(Math.abs(threadBounds.min.z + 1.9537999629974365) < 2e-7);
});

test("当前局部槽延长显式限定范围，不能把旧槽验收冒充本轮证据", () => {
  const manifest = loadManifest();
  const slot = manifest.internalDrive.currentFrontSlotRelief;
  assert.equal(slot.extensionAtOriginalTipY, 0.055);
  assert.equal(slot.joinBackToOriginalAtY, 0.84);
  assert.ok(Math.abs(slot.newTipY - 0.722137578) < 1e-6);
  assert.equal(slot.bodyClosedManifold, true);
  assert.equal(slot.slotRoofMeshesByteCoordinateIdentical, true);
  assert.ok(slot.unchangedSlotRoofMinimumY > slot.joinBackToOriginalAtY);
  assert.ok(
    slot.removedVolumeBothSides > 0 && slot.removedVolumeBothSides < 0.0001,
  );
  assert.equal(
    manifest.mechanism.historicalPersistentFieldsAreNotCurrentAcceptance,
    true,
  );
});

test("新侧槽机身以原始三角闭合，不依赖SAT丢弃零面积面", async () => {
  const scene = await loadModel();
  const body = scene.getObjectByName("Fuselage");
  assert.ok(body instanceof THREE.Mesh);
  const geometry = body.geometry;
  const positions = geometry.getAttribute("position");
  const indices = geometry.index;
  const count = indices?.count ?? positions.count;
  const edges = new Map<string, { count: number; orientation: number }>();
  let volume = 0;
  for (let i = 0; i < count; i += 3) {
    const points = [0, 1, 2].map((offset) =>
      new THREE.Vector3().fromBufferAttribute(
        positions,
        indices ? indices.getX(i + offset) : i + offset,
      ),
    );
    const [a, b, c] = points;
    assert.ok(b.clone().sub(a).cross(c.clone().sub(a)).length() / 2 > 1e-18);
    volume += a.dot(b.clone().cross(c)) / 6;
    const keys = points.map((p) => p.toArray().join(","));
    for (let edge = 0; edge < 3; edge++) {
      const from = keys[edge],
        to = keys[(edge + 1) % 3];
      const forward = from < to;
      const key = forward ? `${from}/${to}` : `${to}/${from}`;
      const row = edges.get(key) ?? { count: 0, orientation: 0 };
      row.count++;
      row.orientation += forward ? 1 : -1;
      edges.set(key, row);
    }
  }
  assert.ok(volume > 0);
  assert.ok(
    [...edges.values()].every((e) => e.count === 2 && e.orientation === 0),
  );
  assert.ok(
    loadManifest().internalDrive.currentFrontSlotRelief.exportTopologyRepair,
  );
});
