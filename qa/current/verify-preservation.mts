/** 当前源/运行模型对已验收严格指纹；不依赖旧完整整机，也不伪造旧顶点。 */
import fs from "node:fs";
import {loadAcceptedReference,referenceNodeMap} from "./reference-data.mts";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { measureNumericMeshDrift } from "../lib/numeric-drift.mts";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
const contractPath =
  process.env.QA_REFINEMENTS ?? "qa/contracts/fuselage-slot-refinement.json";
const c = JSON.parse(fs.readFileSync(contractPath, "utf8"));
assert(c.reviewed === true || process.env.QA_PREFLIGHT === "1");
const encoding = process.env.QA_ENCODING ?? "source";
const referenceArtifact=loadAcceptedReference(),reference=referenceArtifact.data.models.find((m:any)=>m.encoding===encoding);assert(reference);
assert.equal((c.numericOnlyGeometryChanges??[]).length,0,"紧凑指纹不允许伪造缺失坐标去验证数值近似白名单");
const paths=[referenceArtifact.path,encoding==='runtime'?'public/models/xp4.glb':'assets/blender/xp4-source.glb'];
const sha=(b:any)=>crypto.createHash('sha256').update(b).digest('hex'),currentBytes=fs.readFileSync(paths[1]);
if(c.reviewed)assert.equal(encoding==='source'?c.sourceSha256:c.runtimeSha256,sha(currentBytes));
const current=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(currentBytes.buffer.slice(currentBytes.byteOffset,currentBytes.byteOffset+currentBytes.byteLength),'');
const currentNodes=new Map<string,any>();current.scene.traverse(o=>currentNodes.set(o.name,o));
const maps=[referenceNodeMap(reference),currentNodes];
const num = (n: number) => Number(n.toFixed(8)).toString();
function signature(o: any, normal: boolean, raw = true) {
  if(o._reference)return normal?o._reference.positionNormalTopology:o._reference.positionTopology;
  raw=true; // 两边都使用原始解码数值，不改用小数舍入掩盖差异。
  const p = o.geometry.attributes.position,
    n = o.geometry.attributes.normal,
    ix =
      o.geometry.index?.array ?? Array.from({ length: p.count }, (_, i) => i);
  const v = Array.from({ length: p.count }, (_, i) =>
    [
      p.getX(i),
      p.getY(i),
      p.getZ(i),
      ...(normal ? [n.getX(i), n.getY(i), n.getZ(i)] : []),
    ]
      .map(raw ? (v: number) => v.toString() : num)
      .join(","),
  );
  const tri = [];
  for (let i = 0; i < ix.length; i += 3) {
    const q = [v[ix[i]], v[ix[i + 1]], v[ix[i + 2]]];
    tri.push(
      [
        q.join("|"),
        [q[1], q[2], q[0]].join("|"),
        [q[2], q[0], q[1]].join("|"),
      ].sort()[0],
    );
  }
  // Unique positions avoid exporter normal splitting affecting position count; oriented triangle multiset preserves topology.
  return {
    uniquePositions: sha([...new Set(v)].sort().join("\n")),
    orientedTriangles: sha(tri.sort().join("\n")),
    triangleCount: tri.length,
  };
}
const geometryAllowed = new Set(c.geometryChanges),
  normalAllowed = new Set(c.normalOnlyChanges),
  transformAllowed = new Set(encoding === "runtime" ? (c.runtimeTransformChanges??c.runtimeEncodingTransformChanges) : c.transformChanges);
const failures: any[] = [],
  unchanged: any[] = [],
  geometryChanges: any[] = [],
  normalChanges: any[] = [],
  transformChanges: string[] = [],
  addedNodes: string[] = [],
  removedNodes: string[] = [],
  protectedNodes: any[] = [],
  numericGeometryDrift: any[] = [],
  extrasChanges: any[] = [];
for (const [name, a] of maps[0]) {
  const b = maps[1].get(name);
  if (!b) {
    removedNodes.push(name);
    continue;
  }
  const protectedNode = c.protectedNodePrefixes.some((p: string) =>
    name.startsWith(p),
  );
  const extrasKeys=[...new Set([...Object.keys(a.userData),...Object.keys(b.userData)])].sort();
  const extrasDiff=extrasKeys.filter(key=>Object.hasOwn(a.userData,key)!==Object.hasOwn(b.userData,key)||JSON.stringify(a.userData[key])!==JSON.stringify(b.userData[key])).map(key=>({key,beforePresent:Object.hasOwn(a.userData,key),before:a.userData[key]??null,afterPresent:Object.hasOwn(b.userData,key),after:b.userData[key]??null}));
  if(extrasDiff.length){
    const actual={name,properties:extrasDiff};extrasChanges.push(actual);
    const expected=(c.extrasChanges??[]).find((r:any)=>r.name===name);
    if(JSON.stringify(actual)!==JSON.stringify(expected))failures.push({name,reason:"undeclared exact operational metadata change",actual,expected});
  }
  if (a.isMesh !== b.isMesh)
    failures.push({ name, reason: "node type changed" });
  if (a.parent?.name !== b.parent?.name)
    failures.push({ name, reason: "parent changed" });
  let positionsEqual = true,
    normalsEqual = true;
  if (a.isMesh && b.isMesh) {
    const numericRule = (c.numericOnlyGeometryChanges ?? []).find(
      (r: any) => r.name === name,
    );
    if (numericRule)
      numericGeometryDrift.push(
        measureNumericMeshDrift(a, b, numericRule.maximumPositionError),
      );
    const before = signature(a, false),
      after = signature(b, false),
      beforeNormal = signature(a, true),
      afterNormal = signature(b, true);
    positionsEqual = JSON.stringify(before) === JSON.stringify(after);
    normalsEqual = JSON.stringify(beforeNormal) === JSON.stringify(afterNormal);
    const record = {
      name,
      equal: positionsEqual && normalsEqual,
      positionTopologyEqual: positionsEqual,
      cornerNormalsEqual: normalsEqual,
      before,
      after,
      beforeNormal,
      afterNormal,
    };
    if (!positionsEqual) {
      geometryChanges.push(record);
      if (!geometryAllowed.has(name))
        failures.push({
          name,
          reason: "undeclared vertex/oriented topology change",
        });
    } else if (!normalsEqual) {
      normalChanges.push(record);
      if (!normalAllowed.has(name) && !geometryAllowed.has(name))
        failures.push({ name, reason: "undeclared corner-normal change" });
    } else unchanged.push(record);
    const rawPositionTopologyEqual =
      JSON.stringify(signature(a, false, true)) ===
      JSON.stringify(signature(b, false, true));
    if (!geometryAllowed.has(name) && JSON.stringify(signature(a, true, true)) !== JSON.stringify(signature(b, true, true))) failures.push({name, reason: "unchanged mesh lacks exact decoded position/normal/oriented-topology identity"});
    if (normalAllowed.has(name) && !rawPositionTopologyEqual)
      failures.push({
        name,
        reason:
          "normal-only whitelist changed exact Float32 position/oriented topology",
      });
    if (
      protectedNode &&
      JSON.stringify(signature(a, true, true)) !==
        JSON.stringify(signature(b, true, true))
    )
      failures.push({
        name,
        reason:
          "protected main hinge exact Float32 positions/normals/topology changed",
      });
    (record as any).exactFloat32PositionTopologyEqual =
      rawPositionTopologyEqual;
    const mat = (o: any) => {
      const m = o.material;
      return {
        name: m.name,
        color: m.color.toArray(),
        metalness: m.metalness,
        roughness: m.roughness,
        opacity: m.opacity,
        side: m.side,
      };
    };
    if (JSON.stringify(mat(a)) !== JSON.stringify(mat(b)))
      failures.push({ name, reason: "material changed" });
  }
  a.updateMatrix();
  b.updateMatrix();
  const delta = Math.max(
    ...a.matrix.elements.map((v: number, i: number) =>
      Math.abs(v - b.matrix.elements[i]),
    ),
  );
  const numericTransform = (c.numericOnlyTransformChanges ?? []).find(
    (r: any) => r.name === name,
  );
  if (numericTransform)
    assert(
      delta <= numericTransform.maximumMatrixDifference,
      `${name} exceeds explicitly bounded Float32 rest drift`,
    );
  // 源端全部TRS精确保留；运行端仅显式声明的压缩坐标重基对象可改变局部变换。
  if (!transformAllowed.has(name)) {
    if (delta !== 0) failures.push({name, reason:"node lacks exact undeclared local-transform identity", maximumMatrixDifference:delta});
    for (const field of ["position", "quaternion", "scale"]) if (JSON.stringify(a[field].toArray()) !== JSON.stringify(b[field].toArray())) failures.push({name, reason:"undeclared exact TRS component changed", field});
  }
  if (delta > 1e-9) {
    transformChanges.push(name);
    if (!transformAllowed.has(name))
      failures.push({
        name,
        reason: "undeclared local transform change",
        maximumMatrixDifference: delta,
      });
  }
  if (protectedNode) {
    protectedNodes.push({
      name,
      positionsEqual,
      normalsEqual,
      maximumMatrixDifference: delta,
      parentEqual: a.parent?.name === b.parent?.name,
    });
    if (!positionsEqual || !normalsEqual || delta > 1e-9)
      failures.push({ name, reason: "protected main hinge hardware changed" });
  }
}
for (const [name] of maps[1]) if (!maps[0].has(name)) addedNodes.push(name);
function exact(actual: string[], expected: string[], label: string) {
  if (
    JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())
  )
    failures.push({
      reason: label,
      actual: [...actual].sort(),
      expected: [...expected].sort(),
    });
}
exact(extrasChanges.map(r=>r.name),(c.extrasChanges??[]).map((r:any)=>r.name),"operational metadata scope differs");
exact(addedNodes, c.addedNodes, "addition scope differs");
exact(removedNodes, c.removedNodes, "removal scope differs");
exact(transformChanges, [...transformAllowed], "transform scope differs");
exact(
  geometryChanges.map((r) => r.name),
  c.geometryChanges,
  "geometry scope differs",
);
exact(
  normalChanges.map((r) => r.name),
  c.normalOnlyChanges,
  "normal-only scope differs",
);
assert(protectedNodes.length > 25, "Protected hardware list absent");
assert.deepEqual(reference.animations.map((c:any)=>c.name).sort(),current.animations.map(c=>c.name).sort(),"动作片段必须精确保留");
const animationChanges:any[]=[],timelineChanges:any[]=[];
for(const old of reference.animations){const next=current.animations.find(c=>c.name===old.name)!;assert.equal(old.duration,next.duration);assert.deepEqual(old.tracks.map((t:any)=>t.name).sort(),next.tracks.map(t=>t.name).sort());
 for(const t of old.tracks){const n=next.tracks.find(v=>v.name===t.name)!;assert.equal(t.valueSize,n.getValueSize());assert.equal(t.interpolation,n.getInterpolation());const node=t.name.split('.')[0];
  if(t.timesLength!==n.times.length||t.timesSha256!==sha(JSON.stringify(Array.from(n.times)))){timelineChanges.push({clip:old.name,track:t.name,before:t.timesLength,after:n.times.length});if(!c.animationTimelineChangeNodes.includes(node))failures.push({reason:'undeclared sample timeline change',track:t.name});}
  if(t.valuesLength!==n.values.length||t.valuesSha256!==sha(JSON.stringify(Array.from(n.values)))){animationChanges.push({clip:old.name,track:t.name});if(!c.animationChangeNodes.includes(node))failures.push({reason:'undeclared animation value change',track:t.name});}
 }
}
const report = {
  modelVersion: 24,
  encoding,
  paths,
  exactUnchangedMeshIdentityRequired: true,
  passed: !failures.length,
  sourceSha256: sha(currentBytes),
  baselineSha256: reference.acceptedModelSha256,
  referenceArtifact:{path:referenceArtifact.path,sha256:referenceArtifact.sha256},
  exactRawReferenceFingerprints:true,
  contractPath,
  contractSha256: sha(fs.readFileSync(contractPath)),
  unchangedGeometryAndCornerNormals: unchanged,
  declaredGeometryChanges: geometryChanges,
  declaredNormalOnlyChanges: normalChanges,
  protectedNodes,
  numericGeometryDrift,
  declaredExtrasChanges: extrasChanges,
  removedNodes,
  addedNodes,
  declaredTransformChanges: transformChanges,
  declaredAnimationChanges: animationChanges,
  declaredAnimationTimelineChanges: timelineChanges,
  unrelatedAnimationTrackDataPreserved: !failures.some(
    (f) => f.reason.includes("animation") || f.reason.includes("timeline"),
  ),
  failures,
  limitations: [
    "Position/oriented-topology identity is separated from corner-normal changes; exporter vertex duplication from normal splitting does not alter triangle topology",
    "Finite geometric support, hollow material and full motion checks are separate mandatory gates",
  ],
};
fs.writeFileSync(
  process.env.QA_OUT ?? "qa/current/preservation-report.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      geometryChanges: geometryChanges.map((r) => r.name),
      normalChanges: normalChanges.map((r) => r.name),
      transformChanges,
      addedNodes,
      protected: protectedNodes.length,
      animationChanges,
      timelineChanges,
      failures,
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
