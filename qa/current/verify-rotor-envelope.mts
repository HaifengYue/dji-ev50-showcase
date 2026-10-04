import {affectedScope} from "./affected-scope.mts";
import {conservativeBoxesOverlap} from "./broadphase.mts";
// V14全部四桨全周保守包络：覆盖不同旋翼独立相位，且不把同WingPivot内的新舵面跳过。
import fs from "node:fs";
import * as T from "three";
import {
  triangleDistance,
  envelopeTriangle,
  cylinderSeparation,
} from "../lib/rotor-envelope-geometry.mjs";
import {loadAudit,surfaceIds} from "./audit-scene.mts";
const audit=await loadAudit();
const poses=[];
for(const unfold of [0,.25,.5,.75,1])for(let mask=0;mask<64;mask++)poses.push({unfold,surfaces:Object.fromEntries(surfaceIds.map((id,i)=>[id,mask&(1<<i)?12:-12])),hatch:mask%2?55:0});
const loadDetailAudit=async()=>({...audit,poses,detailPose:(state)=>audit.pose({label:state.label,wing:state.unfold,fold:[0,0,0,0],surfaces:state.surfaces??{},hatch:state.hatch??0})});
const a = await loadDetailAudit(),
  out = process.env.QA_OUT ?? "qa/current/results/rotor-envelope-report.json";
const props = [];
a.scene.traverse((o) => {
  if (/^Prop_/.test(o.name)) props.push(o);
});
const isChild = (object, parent) => {
  for (let n = object; n; n = n.parent) if (n === parent) return true;
  return false;
};
const owner = (m) => props.find((p) => isChild(m, p));
const impact=affectedScope(a.scene,JSON.parse(fs.readFileSync("qa/contracts/fuselage-slot-refinement.json", "utf8"))), changed = new Set(impact.rerunMeshes);
if(a.meshes.some(m=>owner(m)&&changed.has(m.name)))throw new Error("本轮旋翼必须恒等；旋翼改动须扩展到全部包络目标，不能继承旧配对");
const body = a.meshes.filter((m) => !owner(m) && changed.has(m.name));
const triangles = (m) =>
  a.snap(m).triangles.map((t) => ({
    index: t.triangleIndex,
    v: t.vertices.map((p) => new T.Vector3(...p)),
  }));
function rotor(p) {
  const suffix = p.name.slice(5),
    start = a.scene.getObjectByName("MotorAxisStart_" + suffix),
    end = a.scene.getObjectByName("MotorAxisEnd_" + suffix),
    c = p.getWorldPosition(new T.Vector3()),
    n = end
      .getWorldPosition(new T.Vector3())
      .sub(start.getWorldPosition(new T.Vector3()))
      .normalize();
  const blades = a.meshes.filter(
    (m) => isChild(m, p) && /^Blade_[LR]_(Front|Rear)_[AB]$/.test(m.name),
  );
  if (blades.length !== 2) throw Error(p.name + "必须有两片真实桨叶");
  let radius = 0,
    innerRadius = Infinity,
    halfThickness = 0;
  const slabs = [];
  for (const m of blades)
    for (const { v: tri, index } of triangles(m)) {
      const hs = tri.map((v) => v.clone().sub(c).dot(n)),
        flat = tri.map((v, i) => v.clone().addScaledVector(n, -hs[i])),
        rmin = triangleDistance(flat, c),
        rmax = Math.max(...flat.map((v) => v.distanceTo(c))),
        lo = Math.min(...hs),
        hi = Math.max(...hs);
      radius = Math.max(radius, rmax);
      innerRadius = Math.min(innerRadius, rmin);
      halfThickness = Math.max(halfThickness, Math.abs(lo), Math.abs(hi));
      slabs.push({
        c: c.clone().addScaledVector(n, (lo + hi) / 2),
        n,
        radius: rmax,
        innerRadius: rmin,
        halfThickness: (hi - lo) / 2,
        blade: m.name,
        sourceTriangleIndex: index,
      });
    }
  const extent = new T.Vector3(
    ...[0, 1, 2].map(
      (i) =>
        radius * Math.sqrt(Math.max(0, 1 - n.getComponent(i) ** 2)) +
        halfThickness * Math.abs(n.getComponent(i)),
    ),
  );
  const box = new T.Box3(c.clone().sub(extent), c.clone().add(extent));
  return {
    name: p.name,
    node: p,
    c,
    n,
    radius,
    innerRadius,
    halfThickness,
    slabs,
    box,
  };
}
const states = [];
for (let k = 0; k <= 200; k++)
  states.push({
    unfold: k / 200,
    controls: { inboard: 0, outboard: 0, tail: 0, hatch: 0 },
    label: "真实主动画中立包络",
    reachable: true,
    rotorStress: false,
  });
for (const state of a.poses)
  states.push({
    ...state,
    label: "外部API六舵面/货舱与四桨全转包络",
    reachable: true,
    rotorStress: true,
  });
const contacts = new Map(),
  overlaps = [],
  clearance = [];
let meshTriangleChecks = 0,
  slabTriangleChecks = 0;
for (const [sampleIndex, state] of states.entries()) {
  a.detailPose(state);
  const rs = props.map(rotor);
  const targetTriangles = new Map();
  const getTriangles = (m) => {
    if (!targetTriangles.has(m)) targetTriangles.set(m, triangles(m));
    return targetTriangles.get(m);
  };
  const active = rs;
  for (const r of active) {
    for (const m of body) {
      if (!conservativeBoxesOverlap(r.box,m.qaBox)) continue;
      const tri = getTriangles(m);
      let hit = null;
      for (const t of tri) {
        meshTriangleChecks++;
        if (!envelopeTriangle(r, t.v)) continue;
        for (const slab of r.slabs) {
          slabTriangleChecks++;
          const narrow = envelopeTriangle(slab, t.v);
          if (narrow) {
            hit = {
              ...narrow,
              bodyTriangleIndex: t.index,
              blade: slab.blade,
              bladeTriangleIndex: slab.sourceTriangleIndex,
            };
            break;
          }
        }
        if (hit) break;
      }
      if (hit) {
        const key = [r.name, m.name].join(" / ");
        if (!contacts.has(key))
          contacts.set(key, {
            rotor: r.name,
            mesh: m.name,
            firstSample: state,
            sampleCount: 0,
            reachableSampleCount: 0,
            witness: hit,
          });
        const entry = contacts.get(key);
        entry.sampleCount++;
        if (state.reachable) entry.reachableSampleCount++;
      }
    }
  }
  for (let i = 0; i < active.length; i++)
    for (let j = i + 1; j < active.length; j++) {
      const x = active[i],
        y = active[j],
        r = cylinderSeparation(x, y);
      if (!r.separated)
        overlaps.push({ sample: state, a: x.name, b: y.name, ...r });
      else if (!state.rotorStress)
        clearance.push({ unfold: state.unfold, a: x.name, b: y.name, ...r });
    }
  if (sampleIndex % 20 === 0)
    console.log(
      "全周包络",
      sampleIndex,
      "/",
      states.length,
      "候选接触",
      contacts.size,
      "未分离桨盘",
      overlaps.length,
    );
}
const reachableContacts = [...contacts.values()].filter(
    (c) => c.reachableSampleCount > 0,
  ),
  reachableOverlaps = overlaps.filter((o) => o.sample.reachable),
  report = {
    source: a.source,
    sha256: a.sha256,
    passed: reachableContacts.length === 0 && reachableOverlaps.length === 0,
    stressPassed: contacts.size === 0 && overlaps.length === 0,
    execution: "实际运行时模型经真实姿态函数驱动",
    sampleCount: states.length,
    changedTargets: body.map(m=>m.name),
    appliedPoseStates: states.map(state=>({wing:state.unfold,fold:[0,0,0,0],surfaces:state.surfaces??{},hatch:state.hatch??0})),
    affectedScope: impact,
    unchangedRotorBodyPairsInherited: true,
    neutralMainMotionSamples: 201,
    detailStressSamples: a.poses.length,
    meshTriangleChecks,
    slabTriangleChecks,
    contacts: [...contacts.values()],
    reachableContacts,
    unseparatedRotorEnvelopes: overlaps,
    minimumCylinderSeparatingGap: Math.min(
      ...clearance.map((c) => c.separatingGap),
    ),
    minimumSeparationEvidence: clearance
      .sort((x, y) => x.separatingGap - y.separatingGap)
      .slice(0, 8),
    method:
      "每片实际桨叶三角形的轴向高度/径向范围形成保守全周环柱超集；所有改动的非旋翼网格实际三角形与之裁剪检查；未变网格与原旋翼之间的证据在精确恒等门槛后继承V22。不同旋翼以有限厚度全圆柱超集分离轴证明任意相位分離；未分离则保留未解析，不伪称实交。独立MotorAxis标记定义轴，不硬编码局部Y。",
    limitations: [
      "全周包络消除相位采样空隙，整翼与舵面仍为有限姿态样本，非解析连续认证",
      "保守环柱候选接触不能单独证明真实桨叶撞击，发现后需实体细化，未擅自豁免",
      "201个中立整翼姿态和320个六舵面极限/舱盖组合全部四桨展开；这些组合可由外部API提交，不再沿旧后桨停车豁免",
      "旋翼实体完整包含在大型闭合件内由对应主动画表面/包含报告覆盖，不由单一表面包络决定",
      "没有执行浏览器，也不证明材料或飞行安全",
    ],
  };
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      out,
      passed: report.passed,
      stressPassed: report.stressPassed,
      sha256: report.sha256,
      contacts: report.contacts.map((c) => [c.rotor, c.mesh]),
      minimumCylinderSeparatingGap: report.minimumCylinderSeparatingGap,
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
