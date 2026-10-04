import {decorationTopology,verifyDecorationTopologySummary} from "./decoration-topology.mts";
import {verifiedReference} from './reference-records.mjs';
import {affectedScope} from "./affected-scope.mts";
/** V22 actual source/runtime drive and linkage topology, nonzero triangle area and volume checks. */
import fs from "node:fs";
import { loadAudit } from "./audit-scene.mts";
const refinement=JSON.parse(fs.readFileSync("qa/contracts/model-refinement.json", "utf8"));
const decorationNames=new Set(JSON.parse(fs.readFileSync("qa/contracts/supports.json","utf8")).decorations.map(d=>d.name));
const previousReference=verifiedReference('previous-accepted-reference.json').data;
const reports = [];
for (const source of [
  "assets/blender/xp4-source.glb",
  "public/models/xp4.glb",
]) {
  const a = await loadAudit(source),
    parts = [];
  const impact=affectedScope(a.scene,refinement),changed=new Set(impact.rerunMeshes);
  for (const m of a.meshes.filter((m) => (changed.has(m.name) && !decorationNames.has(m.name)) ||
    /^(Fixed_root_[LR]$|Composite_wing_|BraceWingSeat_|Drive_|Brace|ActuatorSideSlot|ControlHinge|ControlFlexure|ControlHorn|CargoHinge|CargoLatch|Fuselage$|RootFairing|Dorsal_antenna|Landing_wear_tip|Pod_wing_saddle|RootBearingHousing|RootFairing)/.test(
      m.name,
    ),
  )) {
    const snap = a.snap(m),
      top = a.topology.get(m.name);
    let zeroArea = 0,
      volume = 0,
      minArea = Infinity;
    for (const t of snap.triangles) {
      const [v0, v1, v2] = t.vertices,
        sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]),
        cross = (a: number[], b: number[]) => [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ],
        n = cross(sub(v1, v0), sub(v2, v0)),
        area = Math.hypot(...n) / 2;
      minArea = Math.min(minArea, area);
      if (area <= 1e-18) zeroArea++;
      const c = cross(v1, v2);
      volume += v0.reduce((s, v, i) => s + v * c[i], 0) / 6;
    }
    parts.push({
      name: m.name,
      closed: top.closed,
      boundary: top.boundaryEdgeCount,
      nonmanifold: top.nonmanifoldEdgeCount,
      components: top.componentCount,
      zeroAreaTriangles: zeroArea,
      minArea,
      volume: Math.abs(volume),
      passed: top.closed && !zeroArea && Math.abs(volume) > 1e-10 && (!/^(Fuselage$|ActuatorSideSlot_[LR]$|Fixed_root_[LR]$|Composite_wing_[LR]$)/.test(m.name) || top.componentCount===1),
    });
  }
  const prior=previousReference.models.find(m=>m.encoding===(source.includes('source')?'source':'runtime'));
  const decorations=a.meshes.filter(m=>changed.has(m.name)&&decorationNames.has(m.name)).map(m=>{const before=prior.nodes.find(n=>n.name===m.name)?.topology;if(!before)throw new Error('改动装饰缺少已验收的拓扑参照 '+m.name);return {name:m.name,...verifyDecorationTopologySummary(before,decorationTopology(a.snap(m)))};});
  reports.push({
    source,
    sha256: a.sha256,
    changedMeshes: [...changed].sort(),
    affectedScope: impact,
    parts,
    decorations,
    passed: parts.every((p) => p.passed) && decorations.every(d=>d.passed),
  });
}
if (!reports.every((r) => r.parts.some((p) => p.name.startsWith("Drive_"))))
  throw new Error("Missing V22 drive geometry");
for (const r of reports) {
  const beam = r.parts.find((p) => p.name === "Drive_Crossbeam");
  if (!beam || beam.components !== 1 || !beam.passed)
    throw new Error(
      "Crossbeam must be one continuous closed solid, not disconnected decorative sections",
    );
}
const r = {
  passed: reports.every((r) => r.passed),
  reports,
  limitations: [
    "Actual decoded triangle area tolerance1e-18 and existing positive-volume1e-10; topology welding1e-12 unchanged",
    "Closed manifold topology/positive volume is not a proof of no self-intersections; cross-component collision audit remains separate",
  ],
};
fs.writeFileSync(
  process.env.QA_OUT ?? "qa/current/results/solids-report.json",
  JSON.stringify(r, null, 2),
);
console.log(JSON.stringify(r, null, 2));
if (!r.passed) process.exitCode = 1;
