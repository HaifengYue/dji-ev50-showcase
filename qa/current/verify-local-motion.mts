import {affectedScope} from "./affected-scope.mts";
import {conservativeBoxesOverlap} from "./broadphase.mts";
/** V24 所有改动及新增件对全机的细扫；相对运动配对不设接触豁免。 */
import fs from "node:fs";
import * as T from "three";
import { loadAudit } from "./audit-scene.mts";
import {exactPairCache} from "./exact-pair-cache.mts";
const { intersectMeshTriangles } =
  await import("../lib/triangle-contact.mjs");
const { containedComponents, pointInSolid } =
  await import("../lib/solid-contact.mjs");
const scope = JSON.parse(fs.readFileSync("qa/contracts/fuselage-slot-refinement.json", "utf8"));
const audit = await loadAudit(), impact=affectedScope(audit.scene,scope), changed = new Set(impact.rerunMeshes), selected = audit.meshes.filter(m=>changed.has(m.name));
const nameSet = new Set(selected.map((m) => m.name));
const relative = audit.pairs.filter(
    (p) => nameSet.has(p.a.name) || nameSet.has(p.b.name),
  ),
  fixed = audit.fixedPairs.filter(
    (p) => nameSet.has(p.a.name) || nameSet.has(p.b.name),
  );
const steps = Number(process.env.QA_STEPS ?? 360),
  contacts = new Map<string, any>(),
  unknown = new Map<string, any>();
let sat = 0,
  broad = 0,
  containmentTests = 0;
const fixedContacts: any[] = [];
let currentState: any = null;
const pairCache=exactPairCache();
function check(p: any, u: number, sameRigid = false) {
  if (!conservativeBoxesOverlap(p.a.qaBox,p.b.qaBox)) return;
  broad++;
  const {value:{r,c}}=pairCache.evaluate(p,()=>{
    const a=audit.snap(p.a),b=audit.snap(p.b),r=intersectMeshTriangles(a,b,{maxWitnesses:1,epsilon:1e-9});
    sat+=r.stats.triangleSATTests;
    const c=r.intersects?[]:containedComponents(a,b,audit.topology.get(p.a.name),audit.topology.get(p.b.name));
    if(!r.intersects)containmentTests++;
    return {r,c};
  });
  if (!sameRigid)
    for (const v of c.unresolved ?? []) {
      if (v.reason === "unresolved-ray-disagreement")
        unknown.set(p.key, { ...v, unfold: u });
    }
  if (r.intersects || c.length) {
    const row = {
      names: [p.a.name, p.b.name],
      groups: [p.a.qaGroup, p.b.qaGroup],
      unfold: u,
      state: currentState,
      surface: r.intersects,
      contained: c.length,
      witness: r.witnesses[0] ?? c[0],
    };
    if (sameRigid) fixedContacts.push(row);
    else {
      if (!contacts.has(p.key)) {
        contacts.set(p.key, { ...row, samples: 0 });
        console.log("FIRST_CONTACT", JSON.stringify(row));
      }
      contacts.get(p.key).samples++;
    }
  }
}
const states: any[] = [];
for (let i = 0; i <= steps; i++)
  states.push({
    label: "full wing conversion",
    wing: i / steps,
    fold: [0, 0.25, 0.75, 1],
    phase: [i * 0.07, 0, 0, 0],
  });
if (process.env.QA_WING_ONLY !== "1")
  for (let i = 0; i <= 110; i++)
    states.push({
      label: "new cargo hinge full stroke",
      wing: (i % 3) / 2,
      fold: [1, 1, 1, 1],
      hatch: i / 2,
    });
if (process.env.QA_WING_ONLY !== "1")
  for (const id of [
    "L_Inboard",
    "R_Inboard",
    "L_Outboard",
    "R_Outboard",
    "Tail_L",
    "Tail_R",
  ])
    for (let i = 0; i <= 48; i++)
      states.push({
        label: "physical control-surface attachment full stroke",
        wing: (i % 3) / 2,
        fold: [1, 1, 1, 1],
        surfaces: { [id]: -12 + i / 2 },
      });
for (const [i, state] of states.entries()) {
  currentState = state;
  audit.pose(state);
  for (const p of relative) check(p, state.wing);
  if (i === 0) for (const p of fixed) check(p, state.wing, true);
  if (i % 20 === 0)
    console.log(
      i + 1,
      "/",
      states.length,
      "contact pairs",
      contacts.size,
      "SAT",
      sat,
    );
}
if (!selected.some((m) => m.name === "Fuselage")) throw new Error("Missing modified fuselage geometry");
const topology = Object.fromEntries(
  selected.map((m) => [m.name, audit.topology.get(m.name)]),
);
const decorationNames=new Set(JSON.parse(fs.readFileSync("qa/contracts/supports.json","utf8")).decorations.map(d=>d.name));
const open = selected
  .filter((m) => !decorationNames.has(m.name) && !audit.topology.get(m.name).closed)
  .map((m) => m.name);
const report = {
  passed: contacts.size === 0 && unknown.size === 0 && open.length === 0,
  source: audit.source,
  currentSnapshotTopologyRefreshes: audit.topologyRefreshes,
  exactPairCache:pairCache.stats(),
  sha256: audit.sha256,
  samples: states.length,
  wingOnlyDiagnostic: process.env.QA_WING_ONLY === "1",
  states,
  selectedMeshes: selected.map((m) => m.name),
  affectedScope: impact,
  relativePairs: relative.length,
  fixedPairs: fixed.length,
  triangleSATTests: sat,
  broadphaseHits: broad,
  containmentTests,
  contacts: [...contacts.values()],
  unresolved: [...unknown.values()],
  open,
  topology,
  fixedContacts,
  limitations: [
    "All named linkage meshes versus all actual meshes in different rigid groups, no adjacency exemption; epsilon=1e-9 unchanged",
    "Same-rigid contacts are reported separately rather than automatically accepted; finite support-seat contracts must independently validate intentional attachment overlap",
    "Finite full-wing plus local hatch/control-surface pose sampling is not continuous collision or manufacturing certification; no browser proof",
  ],
};
fs.writeFileSync(
  process.env.QA_OUT ?? "qa/current/local-motion-report.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    { passed: report.passed, contacts: report.contacts, fixedContacts, open },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
