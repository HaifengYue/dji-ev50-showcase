import {affectedScope} from "./affected-scope.mts";
import {conservativeBoxesOverlap} from "./broadphase.mts";
import {resolveEvidence} from "./reference-records.mjs";
/** V22 every-mesh attachment proof: material interfaces, retained fits, and bounded decorations. */
import fs from "node:fs";
import assert from "node:assert/strict";
import * as T from "three";
import { loadAudit } from "./audit-scene.mts";
import {
  mesh,
  frame,
  materialContact,
  boreRays,
  rayDistances,
  decorationDistances,
  EPSILON,
  spanArea,
  samples,
  basis,
} from "../lib/support-geometry.mts";
const { pointInSolid, containedComponents } =
  await import("../lib/solid-contact.mjs");
const { intersectMeshTriangles } =
  await import("../lib/triangle-contact.mjs");
const path =
    process.env.QA_SUPPORT_CONTRACT ??
    "qa/contracts/supports.json",
  c = JSON.parse(fs.readFileSync(path, "utf8"));
assert(
  c.reviewed === true || process.env.QA_PREFLIGHT === "1",
  "Every support contract must be reviewed before final evidence",
);
const sources = process.env.QA_MODEL
  ? [process.env.QA_MODEL]
  : ["assets/blender/xp4-source.glb", "public/models/xp4.glb"];
const priorContract = JSON.parse(fs.readFileSync("qa/contracts/reference-supports.json", "utf8"));
const priorEvidence = resolveEvidence("qa/v23/verification/final/support-report.json");
const priorReportPath = priorEvidence.path;
const priorReport = priorEvidence.data;
const refinement=JSON.parse(fs.readFileSync("qa/contracts/model-refinement.json", "utf8"));
const inheritance = JSON.parse(fs.readFileSync((process.env.QA_DIR ?? "qa/current/results") + "/inheritance-report.json", "utf8"));
assert(inheritance.passed && priorReport.passed);

const reports: any[] = [];
for (const source of sources) {
  console.log("SUPPORT_BEGIN", source);
  const a = await loadAudit(source),
    encoding = source.includes("source") ? 1e-6 : 6e-5,
    rows: any[] = [],
    edges: any[] = [],
    failures: any[] = [];
  const impact=affectedScope(a.scene,refinement), changed=new Set(impact.rerunMeshes);
  const involvesChanged = (d:any) => [d.name,...(d.pair??[]),...(d.hosts??[])].some(n=>changed.has(n));
  a.pose({
    label: "complete model physical support",
    wing: 1,
    fold: [1, 1, 1, 1],
  });
  const allNames = a.meshes.map((m) => m.name).sort();
  assert.deepEqual(
    c.classification.map((r: any) => r.name).sort(),
    allNames,
    "Every current mesh must have exactly one support classification",
  );
  assert.equal(
    new Set(c.classification.map((r: any) => r.name)).size,
    allNames.length,
  );
  assert(
    a.meshes.every((m) => m.visible),
    "No normal-view mesh may be hidden to pass support audit",
  );
  const prior = priorReport.reports.find((r:any)=>r.source===source);
  assert(prior?.passed);
  let inheritedInterfaces = 0, newlyMeasuredInterfaces = 0;
  function inherit(d:any, kind:string) {
    const old = priorContract[kind].find((x:any)=>x.id===d.id);
    assert.deepEqual(d,old,"An inherited support contract changed: "+d.id);
    const row=prior.rows.find((r:any)=>r.id===d.id);assert(row?.passed);
    rows.push({...row,inheritedFrom:{report:priorReportPath,modelSha256:prior.sha256},rerun:false});
    if(kind==="decorations") for(const host of d.hosts)edges.push({id:d.id,pair:[d.name,host],type:"surface-decoration"});
    else if(kind!=="incidentalContacts")edges.push({id:d.id,pair:d.pair,type:row.type});
    inheritedInterfaces++;
  }
  for (const d of c.fixed) {
    if (newlyMeasuredInterfaces % 25 === 0) console.log("SUPPORT_FIXED", source, "measured", newlyMeasuredInterfaces, "inherited", inheritedInterfaces);
    if (!involvesChanged(d)) { inherit(d,"fixed"); continue; } newlyMeasuredInterfaces++;
    const r = materialContact(a, d.pair, d.frame ?? null),
      regions = d.regions ?? [d];
    const inRegion = (s: any, region: any) => {
      if (
        s.local.some(
          (v: number, k: number) =>
            v < region.min[k] - encoding || v > region.max[k] + encoding,
        )
      )
        return false;
      if (region.cylinder) {
        const cylinder = region.cylinder,
          axis = new T.Vector3(...cylinder.axis).normalize(),
          offset = new T.Vector3(...s.local).sub(
            new T.Vector3(...cylinder.center),
          ),
          t = offset.dot(axis),
          radial = offset.addScaledVector(axis, -t).length();
        return (
          radial <= cylinder.radius + encoding &&
          radial >= (cylinder.minimumRadius ?? 0) - encoding &&
          t >= cylinder.range[0] - encoding &&
          t <= cylinder.range[1] + encoding
        );
      }
      return true;
    };
    const bad = r.samples.filter(
        (s) => !regions.some((region) => inRegion(s, region)),
      ),
      regionCoverage = regions.map((region, index) => ({
        index,
        samples: r.samples.filter((s) => inRegion(s, region)).length,
        spanArea: spanArea(
          r.samples.filter((s) => inRegion(s, region)).map((s) => s.local),
        ),
      }));
    const passed =
      r.sameRigid &&
      (r.surfaceContact || r.samples.some((s) => s.state === "inside")) &&
      r.sampleCount >= 3 &&
      r.spanTriangleArea >= d.minimumContactArea &&
      r.componentCoverage
        .filter((x) => x.meshComponentCount > 1)
        .every((x) => x.contactSamples >= 3 && x.contactSpanArea > 1e-12) &&
      regionCoverage.every((x) => x.samples >= 3 && x.spanArea > 1e-12) &&
      !bad.length &&
      !r.unresolved.length;
    rows.push({
      id: d.id,
      type: "fixed-material",
      reason: d.reason,
      ...r,
      samples: undefined,
      regionCoverage,
      bad,
      passed,
    });
    if (passed) edges.push({ id: d.id, pair: d.pair, type: "fixed-material" });
    else
      failures.push({
        id: d.id,
        reason: "Missing or unbounded finite material attachment",
        bad: bad.slice(0, 3),
        samples: r.sampleCount,
        area: r.spanTriangleArea,
      });
  }
  const poses = c.poses ?? [
    { wing: 0 },
    { wing: 0.25 },
    { wing: 0.5 },
    { wing: 0.75 },
    { wing: 1 },
  ];
  console.log("SUPPORT_FITS", source, "fixed rows", rows.length);
  for (const d of c.fits) {
    if (!involvesChanged(d)) { inherit(d,"fits"); continue; } newlyMeasuredInterfaces++;
    const states: any[] = [];
    for (const p of poses) {
      a.pose({
        label: "articulated support",
        fold: [0, 0, 0, 0],
        phase: [0.13, 0.39, 0.61, 0.87],
        ...p,
      });
      if (d.type === "cylindrical") {
        const r = boreRays(a, d),
          f = frame(a, d.frame),
          center = new T.Vector3(...d.center).applyMatrix4(f.matrixWorld),
          axis = new T.Vector3(...d.axis).transformDirection(f.matrixWorld),
          { u, v } = basis(axis),
          shaft = a.snap(mesh(a, d.shaft));
        const ss = r.rows.map((q: any) => {
          const origin = center.clone().addScaledVector(axis, q.station),
            direction = u
              .clone()
              .multiplyScalar(Math.cos(q.angle))
              .addScaledVector(v, Math.sin(q.angle)),
            ds = rayDistances(shaft, origin, direction),
            radius = ds.at(-1);
          return {
            ...q,
            shaftRadius: radius ?? null,
            gap:
              radius === undefined || q.first === null
                ? null
                : q.first - radius,
          };
        });
        const bad = ss.filter(
          (q: any) =>
            q.first === null ||
            q.shaftRadius === null ||
            q.first < d.boreRadius[0] - encoding ||
            q.first > d.boreRadius[1] + encoding ||
            q.shaftRadius < d.shaftRadius[0] - encoding ||
            q.shaftRadius > d.shaftRadius[1] + encoding ||
            q.gap < d.gap[0] - encoding ||
            q.gap > d.gap[1] + encoding,
        );
        const closed = [d.host, d.shaft].map((n) => a.topology.get(n).closed),
          passed = closed.every(Boolean) && !bad.length;
        states.push({
          pose: p,
          closed,
          stations: d.stations,
          rayCount: ss.length,
          minimumGap: Math.min(...ss.map((q: any) => q.gap ?? Infinity)),
          maximumGap: Math.max(...ss.map((q: any) => q.gap ?? Infinity)),
          bad: bad.slice(0, 8),
          passed,
        });
      } else if (d.type === "spherical-end") {
        const anchor = frame(a, d.anchor).getWorldPosition(new T.Vector3()),
          eye = mesh(a, d.eye),
          ball = mesh(a, d.ball),
          ef = frame(a, d.eyeFrame),
          center = new T.Vector3(...d.eyeCenter).applyMatrix4(ef.matrixWorld),
          normal = new T.Vector3(...d.eyeNormal).transformDirection(
            ef.matrixWorld,
          ),
          { u, v } = basis(normal),
          es = a.snap(eye),
          bs = a.snap(ball),
          rs: any[] = [];
        for (const t of d.stations)
          for (let k = 0; k < 32; k++) {
            const angle = (k * 2 * Math.PI) / 32,
              origin = anchor.clone().addScaledVector(normal, t),
              direction = u
                .clone()
                .multiplyScalar(Math.cos(angle))
                .addScaledVector(v, Math.sin(angle)),
              ed = rayDistances(es, origin, direction),
              bd = rayDistances(bs, origin, direction);
            rs.push({
              station: t,
              angle,
              eyeRadius: ed[0] ?? null,
              ballRadius: bd.at(-1) ?? null,
              gap: ed.length && bd.length ? ed[0] - bd.at(-1)! : null,
            });
          }
        const bad = rs.filter(
            (q) =>
              q.gap === null ||
              q.gap < d.gap[0] - encoding ||
              q.gap > d.gap[1] + encoding ||
              q.eyeRadius < d.eyeRadius[0] - encoding ||
              q.eyeRadius > d.eyeRadius[1] + encoding,
          ),
          centerError = anchor.distanceTo(center),
          passed =
            centerError < 1e-6 &&
            !bad.length &&
            a.topology.get(d.eye).closed &&
            a.topology.get(d.ball).closed;
        states.push({
          pose: p,
          centerError,
          rayCount: rs.length,
          minimumGap: Math.min(...rs.map((q) => q.gap ?? Infinity)),
          maximumGap: Math.max(...rs.map((q) => q.gap ?? Infinity)),
          bad: bad.slice(0, 8),
          passed,
        });
      } else if (d.type === "flexure-end") {
        // Thin living-hinge visualization consists of two finite material lips attached to their skins.
        // The explicit small inspection split is measured over the actual complete shared hinge span.
        const fixed = mesh(a, d.fixed),
          moving = mesh(a, d.moving),
          start = frame(a, d.start).getWorldPosition(new T.Vector3()),
          end = frame(a, d.end).getWorldPosition(new T.Vector3()),
          axis = end.clone().sub(start).normalize(),
          length = end.distanceTo(start),
          ss = [a.snap(fixed), a.snap(moving)],
          limits: any[] = [];
        for (const s of ss) {
          const ps = samples(s).map((p) => new T.Vector3(...p).sub(start)),
            axial = ps.map((p) => p.dot(axis)),
            radial = ps.map((p) =>
              p.clone().addScaledVector(axis, -p.dot(axis)).length(),
            );
          limits.push({
            name: s.name,
            axial: [Math.min(...axial), Math.max(...axial)],
            minimumRadial: Math.min(...radial),
            maximumRadial: Math.max(...radial),
          });
        }
        const passed =
          limits.every(
            (r) =>
              r.axial[0] <= d.endTolerance + encoding &&
              r.axial[1] >= length - d.endTolerance - encoding &&
              r.minimumRadial <= d.maximumSplitHalfGap + encoding &&
              r.maximumRadial <= d.maximumLipRadius + encoding,
          ) &&
          a.topology.get(d.fixed).closed &&
          a.topology.get(d.moving).closed;
        states.push({ pose: p, hingeLength: length, limits, passed });
      } else throw new Error("Unknown reviewed support fit " + d.type);
    }
    const passed = states.every((r) => r.passed);
    rows.push({
      id: d.id,
      type: d.type,
      reason: d.reason,
      pair: d.pair,
      states,
      passed,
    });
    if (passed) edges.push({ id: d.id, pair: d.pair, type: d.type });
    else
      failures.push({
        id: d.id,
        reason: "Articulated fit lost geometric coverage",
        states: states.filter((r) => !r.passed),
      });
  }
  a.pose({
    label: "decorations on complete skins",
    wing: 1,
    fold: [1, 1, 1, 1],
  });
  console.log("SUPPORT_DECORATIONS", source, "rows", rows.length);
  for (const d of c.decorations) {
    if (!involvesChanged(d)) { inherit(d,"decorations"); continue; } newlyMeasuredInterfaces++;
    const r = decorationDistances(a, d),
      passed =
        r.maximumDistance <= d.maximumOffset + encoding &&
        d.hosts.every(
          (host: string) => mesh(a, host).qaGroup === mesh(a, d.name).qaGroup,
        );
    rows.push({
      id: d.id,
      type: "surface-decoration",
      reason: d.reason,
      ...r,
      rows: undefined,
      maximumOffset: d.maximumOffset,
      passed,
    });
    if (passed)
      for (const host of d.hosts)
        edges.push({
          id: d.id,
          pair: [d.name, host],
          type: "surface-decoration",
        });
    else
      failures.push({
        id: d.id,
        reason: "Decoration exceeds reviewed skin distance",
        maximum: r.maximumDistance,
        maximumAllowed: d.maximumOffset,
        worst: r.worst,
      });
  }
  for (const d of c.incidentalContacts ?? []) {
    if (!involvesChanged(d)) { inherit(d,"incidentalContacts"); continue; } newlyMeasuredInterfaces++;
    const r = materialContact(a, d.pair, d.frame ?? null),
      bad = r.samples.filter(
        (s) =>
          s.local.some(
            (v, k) => v < d.min[k] - encoding || v > d.max[k] + encoding,
          ) || s.depth > d.maximumMaterialDepth,
      );
    const passed = !bad.length && !r.unresolved.length;
    rows.push({
      id: d.id,
      type: "incidental-tangent-contact",
      reason: d.reason,
      ...r,
      samples: undefined,
      bad,
      supportPathEligible: false,
      passed,
    });
    if (!passed)
      failures.push({
        id: d.id,
        reason:
          "Incidental fixed tangency escaped its narrowly reviewed local bounds",
      });
  }
  const pairKey = (ns: string[]) => ns.slice().sort().join("/"),
    reviewedFixed = new Set(
      [...c.fixed, ...(c.incidentalContacts ?? [])].map((d) => pairKey(d.pair)),
    ),
    decorativeNames = new Set(c.decorations.map((d) => d.name)),
    fixedContactCoverage: any[] = [];
  console.log("SUPPORT_FIXED_CONTACT_COVERAGE", source, "rows", rows.length);
  for (const p of a.fixedPairs) {
    if (!changed.has(p.a.name) && !changed.has(p.b.name)) continue;
    if (
      decorativeNames.has(p.a.name) ||
      decorativeNames.has(p.b.name) ||
      !conservativeBoxesOverlap(p.a.qaBox,p.b.qaBox)
    )
      continue;
    const sa = a.snap(p.a),
      sb = a.snap(p.b),
      sat = intersectMeshTriangles(sa, sb, { maxWitnesses: 1, epsilon: 1e-9 }),
      contained = sat.intersects
        ? []
        : containedComponents(
            sa,
            sb,
            a.topology.get(p.a.name),
            a.topology.get(p.b.name),
          );
    for (const q of contained.unresolved ?? [])
      if (q.reason === "unresolved-ray-disagreement")
        failures.push({
          pair: [p.a.name, p.b.name],
          reason: "Unresolved whole fixed-contact discovery",
        });
    if (!sat.intersects && !contained.length) continue;
    const pair = [p.a.name, p.b.name],
      covered = reviewedFixed.has(pairKey(pair));
    fixedContactCoverage.push({
      pair,
      surface: sat.intersects,
      contained: contained.length,
      covered,
    });
    if (!covered)
      failures.push({
        pair,
        reason: "Unreviewed same-rigid non-decoration contact",
      });
  }
  const decorations = new Set(c.decorations.map((d: any) => d.name)),
    graph = new Map<string, any[]>();
  for (const edge of edges)
    for (const i of [0, 1]) {
      const from = edge.pair[i],
        to = edge.pair[1 - i];
      if (decorations.has(to)) continue;
      graph.set(from, [
        ...(graph.get(from) ?? []),
        { to, id: edge.id, type: edge.type },
      ]);
    }
  function route(start: string) {
    const queue = [{ name: start, nodes: [start], evidence: [] as string[] }],
      seen = new Set<string>();
    while (queue.length) {
      const p = queue.shift()!;
      if (p.name === c.anchor) return p;
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      for (const e of graph.get(p.name) ?? [])
        queue.push({
          name: e.to,
          nodes: [...p.nodes, e.to],
          evidence: [...p.evidence, e.id],
        });
    }
    return null;
  }
  const coverage = c.classification.map((d: any) => ({
    ...d,
    route: route(d.name),
  }));
  for (const d of coverage)
    if (!d.route)
      failures.push({
        name: d.name,
        reason: "No validated physical support path to primary airframe",
      });
  const faultInjections: any[] = [];
  const antenna = mesh(a, "Dorsal_antenna"),
    antennaPosition = antenna.position.clone();
  antenna.position.y += 1;
  a.update();
  const separated = materialContact(a, ["Dorsal_antenna", "Fuselage"]);
  assert(
    !separated.surfaceContact && separated.sampleCount === 0,
    "Disconnected but same-parent antenna must fail",
  );
  faultInjections.push({
    injected: "Antenna moved one model unit from skin without changing parent",
    rejected: true,
  });
  antenna.position.copy(antennaPosition);
  a.update();
  const cargoFit = c.fits.find((d: any) => d.id.startsWith("cargo-hinge:")),
    knuckle = mesh(a, cargoFit.host),
    knucklePosition = knuckle.position.clone();
  knuckle.position.y += 0.05;
  a.update();
  const brokenBore = boreRays(a, cargoFit);
  assert(
    !brokenBore.allHit ||
      brokenBore.rows.some(
        (r) =>
          r.first === null ||
          r.first > cargoFit.boreRadius[1] + encoding ||
          r.first < cargoFit.boreRadius[0] - encoding,
      ),
    "Displaced real hinge bore must fail",
  );
  faultInjections.push({
    injected: "Cargo moving knuckle shifted radially .05 with parent unchanged",
    rejected: true,
  });
  knuckle.position.copy(knucklePosition);
  a.update();
  const decoration = c.decorations.find(
      (d: any) => d.name === "Dorsal_hatch_main",
    ),
    deco = mesh(a, decoration.name),
    decoPosition = deco.position.clone();
  deco.position.y += 0.03;
  a.update();
  const floatingDecoration = decorationDistances(a, decoration);
  assert(
    floatingDecoration.maximumDistance > decoration.maximumOffset + encoding,
    "Excessive seam offset must fail",
  );
  faultInjections.push({
    injected: "Hatch seam shifted .03 off real skin",
    rejected: true,
  });
  deco.position.copy(decoPosition);
  a.update();
  reports.push({
    source,
    sha256: a.sha256,
    changedMeshes: [...changed].sort(),
    affectedScope: impact,
    encodingTolerance: encoding,
    meshCount: allNames.length,
    visibleMeshCount: a.meshes.filter((m) => m.visible).length,
    rows,
    coverage,
    faultInjections,
    fixedContactCoverage,
    fixedDiscoveryScope: "Every same-rigid pair involving a changed mesh; unchanged pairs explicitly inherited after exact source/runtime geometry and transform identity",
    newlyMeasuredInterfaces,
    inheritedInterfaces,
    failures,
    passed: !failures.length,
  });
  console.log(
    source,
    "meshes",
    allNames.length,
    "interfaces",
    rows.length,
    "failures",
    failures.length,
    JSON.stringify(failures.slice(0, 8)),
  );
}
const result = {
  modelVersion: 24,
  contractReviewed: c.reviewed === true,
  passed: reports.every((r) => r.passed),
  contractPath: path,
  numericTolerances: EPSILON,
  reports,
  limitations: [
    "All283 meshes retain physical paths: changed-related interfaces remeasured, other passed interfaces explicitly inherited only after exact source/runtime identity. All meshes remain visible; no parenting-only support claim",
    "Finite samples and explicit fitting gaps are conceptual geometric support evidence, not tolerance, strength, assembly, fatigue or airworthiness certification",
    "Surface decorations have reviewed finite offsets from actual skins; they cannot act as load-bearing intermediate nodes in a support path",
    "Fuselage is the primary structural anchor; all other meshes require a path through validated finite material attachment or explicitly bounded functional fit",
    "Source/runtime encoding tolerance only bounds authored fit dimensions, never changes SAT1e-9 or solid1e-8",
  ],
};
fs.writeFileSync(
  process.env.QA_OUT ?? "qa/current/results/support-report.json",
  JSON.stringify(result, null, 2),
);
if (!result.passed) process.exitCode = 1;
