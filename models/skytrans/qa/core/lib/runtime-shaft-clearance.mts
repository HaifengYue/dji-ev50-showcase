/** 旋转桨帽与固定电机轴的实际运行净空：表面交叉与完整包容都不能当作轴连接豁免。 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as THREE from "three";
import { applyModelPose, type ModelRig } from "../../src/rig.ts";
import { loadRuntimeRig, setMotorSamples } from "./runtime-rotor-motion.mts";
const triangleModule = "./triangle-contact.mjs";
const solidModule = "./solid-contact.mjs";
const { createWorldTriangles, intersectMeshTriangles } = await import(
  triangleModule
);
const { solidTopology, containedComponents } = await import(solidModule);

function solidContact(a: THREE.Mesh, b: THREE.Mesh) {
  const sa = createWorldTriangles(a),
    sb = createWorldTriangles(b);
  const ta = solidTopology(sa),
    tb = solidTopology(sb);
  assert.ok(
    ta.closed && tb.closed,
    `${a.name} / ${b.name} 必须为闭合实体，不能跳过孔腔验证`,
  );
  const surface = intersectMeshTriangles(sa, sb, {
    maxWitnesses: 1,
    epsilon: 1e-9,
  });
  const containment = surface.intersects
    ? []
    : containedComponents(sa, sb, ta, tb);
  return {
    intersects: surface.intersects || containment.length > 0,
    surface: surface.intersects,
    witness: surface.witnesses[0] ?? containment[0] ?? null,
    containment: containment.length > 0,
  };
}

export function checkRuntimeShaftClearance(rig: ModelRig) {
  const contacts: {
    progress: number;
    phase: number;
    spindle: string;
    spinner: string;
    result: ReturnType<typeof solidContact>;
  }[] = [];
  let pairTests = 0;
  const phases = Array.from({ length: 24 }, (_, i) => (i * Math.PI) / 12);
  const progresses = [0, 0.5, 1];
  for (const progress of progresses) {
    for (const phase of phases) {
      // 四桨已完全展开，独立于整翼角，真实应用24个自转相位。
      applyModelPose(rig, progress);
      setMotorSamples(rig, 0, [phase, phase, phase, phase]);
      for (const suffix of ["L_Front", "L_Rear", "R_Front", "R_Rear"]) {
        const spindle = rig.scene.getObjectByName(`Motor_spindle_${suffix}`);
        const spinner = rig.scene.getObjectByName(`Spinner_${suffix}`);
        assert.ok(
          spindle instanceof THREE.Mesh && spinner instanceof THREE.Mesh,
          `缺少 ${suffix} 轴和桨帽实体`,
        );
        const result = solidContact(spindle, spinner);
        pairTests++;
        if (result.intersects)
          contacts.push({
            progress,
            phase,
            spindle: spindle.name,
            spinner: spinner.name,
            result,
          });
      }
    }
  }
  return {
    passed: contacts.length === 0,
    progressSamples: progresses,
    initialPhaseSamples: phases,
    pairTests,
    contacts,
    limitations: [
      "真实applyModelPose加独立Float64 SAT/闭合实体包含，有限采样，不是浏览器或连续运动验收。",
      "全部四桨均在三种整翼状态检查24个展开自转相位；不把停车折叶算作运行相位。",
    ],
  };
}

export async function runRuntimeShaftClearance() {
  const { rig, sha256 } = await loadRuntimeRig();
  return { runtimeSha256: sha256, ...checkRuntimeShaftClearance(rig) };
}

export function verifyContainedShaftFault() {
  // 轴段缩得很小时可完全埋入实心桨帽而不产生任何表面交叉；必须仍判为干涉。
  const inner = new THREE.Mesh(new THREE.SphereGeometry(0.01, 12, 8));
  const outer = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8));
  inner.name = "Injected_embedded_spindle";
  outer.name = "Injected_solid_spinner";
  inner.updateMatrixWorld(true);
  outer.updateMatrixWorld(true);
  const result = solidContact(inner, outer);
  assert.equal(
    result.surface,
    false,
    "注入必须没有表面相交，才能验证包含检测没有被SAT代替",
  );
  assert.equal(result.containment, true, "缩小的固定轴完全埋入桨帽也必须拒绝");
  assert.equal(result.intersects, true);
  return {
    injected: "固定轴完全包容在实心桨帽内，无表面交叉",
    rejected: true,
    result,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const candidate = await runRuntimeShaftClearance();
  const containmentFault = verifyContainedShaftFault();
  let historicalBaseline: unknown = null;
  if (process.argv[2]) {
    const { rig, sha256 } = await loadRuntimeRig(process.argv[2]);
    const result = checkRuntimeShaftClearance(rig);
    assert.ok(!result.passed, "原V8旋转桨帽与固定轴交叉必须被新回归拒绝");
    historicalBaseline = {
      source: process.argv[2],
      runtimeSha256: sha256,
      ...result,
    };
  }
  const result = { ...candidate, containmentFault, historicalBaseline };
  writeFileSync(
    process.env.QA_OUT ?? "qa/current/results/runtime-shaft-clearance-report.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  if (!candidate.passed) process.exitCode = 1;
}
