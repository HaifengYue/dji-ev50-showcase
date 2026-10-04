import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {ENCODING_TOLERANCE, HINGE_POSES, REQUIRED_HINGE_PAIRS, structuredSide, hingeIdentity,
  hingeInventory, hingeAxis, worldPoints, meshMeasure, markerResidual, nominalMeshResidual,
  measurementResidual, rigidPlacementResidual, mirrorResidual, cruiseToPose, APPROVED_HINGE_FAIRINGS,
  validateHingeFairingDesign, fairingShellEvidence, nominalHingeDimensions} from './hinge-identity.mts';

const fullNames = REQUIRED_HINGE_PAIRS.flatMap(key => ['L', 'R'].map(side => {
  if (key.startsWith('RootHingeEndcap_')) return key.replace('_', '_' + side);
  const station = /_(Front|Rear)$/.exec(key);
  return station ? key.slice(0, -station[0].length) + '_' + side + station[0] : key + '_' + side;
}));
const box = (center: T.Vector3, size = .02) => {
  const mesh = new T.Mesh(new T.BoxGeometry(size, size, size));
  mesh.position.copy(center); mesh.updateMatrixWorld(true);
  return mesh;
};
const measure = (mesh: T.Mesh, pivot = new T.Vector3(), axis = new T.Vector3(0, 1, 0)) => meshMeasure(worldPoints(mesh), mesh.geometry.index!.array, pivot, axis);
const exceeds = (r: Record<string, number>, tolerance: number = ENCODING_TOLERANCE.source) => Object.values(r).some(v => v > tolerance);
let tests = 0;
function check(name: string, fn: () => void) { tests++; test(name, fn); }

check('complete side tokens cannot alias Rear, Root, Right or Leading suffixes', () => {
  assert.equal(structuredSide('RootBearingCenter_L_Rear'), 'L');
  assert.equal(structuredSide('RootBearingSeal_R_Front'), 'R');
  assert.equal(structuredSide('Something_L_Leading'), 'L');
  assert.equal(structuredSide('Something_R_Leading'), 'R');
  assert.equal(structuredSide('Something_Rear_Leading'), null);
  assert.equal(structuredSide('Root_Root_Right'), null);
  assert.throws(() => structuredSide('Something_L_R'), /Ambiguous/);
});
check('hinge grammar resolves legacy decimal and loader-sanitized endcap stations identically', () => {
  assert.equal(hingeIdentity('RootHingeEndcap_L-0.148')!.pairKey, hingeIdentity('RootHingeEndcap_R-0148')!.pairKey);
  assert.equal(hingeIdentity('RootHingeEndcap_L0.148')!.side, 'L');
  assert.equal(hingeIdentity('RootHingeEndcap_R0148')!.suffix, '0148');
  assert.throws(() => hingeIdentity('RootHingeEndcap_L0148_Rear'));
});
check('actual inventory requires both sides of every station independently of any author list', () => {
  const inventory = hingeInventory([...fullNames, 'Root_access_cover_L', 'Unrelated']);
  assert.equal(inventory.pairs.size, 19); assert.equal(inventory.rows.length, 38);
  assert.equal(inventory.rows.filter(r => r.mesh).length, 28);
  assert.throws(() => hingeInventory(fullNames.filter(n => n !== 'RootBearingCenter_L_Rear')), /Incomplete/);
  assert.throws(() => hingeInventory(fullNames.filter(n => !n.startsWith('RootHingeEndcap_'))), /Incomplete/);
});
check('malformed, duplicated or unreviewed hinge identities fail closed', () => {
  assert.throws(() => hingeIdentity('RootBearingCenter_L'), /station/);
  assert.throws(() => hingeIdentity('RootBearingFixed_Rear_L'), /Malformed/);
  assert.throws(() => hingeIdentity('RootBearingSeal_L_Leading'), /Malformed/);
  assert.throws(() => hingeIdentity('RootCarrierUnexpected_L'), /Unreviewed/);
  assert.throws(() => hingeInventory([...fullNames, 'RootBearingSeal_L_Rear']), /Duplicate/);
  assert.throws(() => hingeInventory([...fullNames, 'RootHingeEndcap_L-0.148']), /Duplicate/);
});
check('regression: substring side loop translates L_Rear twice, exact tokens translate once', () => {
  const name = 'RootBearingCenter_L_Rear', row = hingeIdentity(name)!;
  const oldPivot = new T.Vector3(-1.35, -.22, 1.3), leftShift = new T.Vector3(-.06, 0, .11), rightShift = new T.Vector3(.06, 0, .11);
  const oldMarker = oldPivot.clone().addScaledVector(hingeAxis('L'), .060), newPivot = oldPivot.clone().add(leftShift);
  const bad = oldMarker.clone(), good = oldMarker.clone();
  for (const [side, shift] of [['L', leftShift], ['R', rightShift]] as const) {
    if (name.includes('_' + side)) bad.add(shift);
    if (structuredSide(name) === side) good.add(shift);
  }
  assert(markerResidual(row, good, newPivot) < ENCODING_TOLERANCE.source);
  assert(markerResidual(row, bad, newPivot) > .12);
  assert.equal(row.side, 'L');
});
check('hinge relocation is permitted: only actual pivot-relative axial station is fixed', () => {
  const row = hingeIdentity('RootAxisStart_R')!, pivot = new T.Vector3(4, 2, -3);
  assert(markerResidual(row, pivot.clone().addScaledVector(hingeAxis('R'), -.155), pivot) < 1e-12);
});
check('correct markers cannot hide a baked-world-space bearing translation', () => {
  const row = hingeIdentity('RootBearingFixed_L_Rear')!, pivot = new T.Vector3(-1.41, -.22, 1.41), axis = hingeAxis('L');
  const nominalCenter = pivot.clone().addScaledVector(axis, .060);
  const mesh = box(nominalCenter); mesh.geometry.applyMatrix4(mesh.matrixWorld); mesh.position.set(0, 0, 0); mesh.updateMatrixWorld(true);
  mesh.geometry.translate(.06, 0, .11); // Actual vertices move, while the object origin remains zero.
  assert.deepEqual(mesh.position.toArray(), [0, 0, 0]);
  const points = worldPoints(mesh), actual = meshMeasure(points, mesh.geometry.index!.array, pivot, axis);
  assert(exceeds(nominalMeshResidual(row, actual, points, pivot)));
  assert(new T.Vector3(...actual.centroid).cross(axis).length() > .01);
});
check('decoded signed-triangle centroid is independent of duplicated normal corners and world translation', () => {
  const a = box(new T.Vector3(1.2, 3.4, 5.6)), b = new T.Mesh(a.geometry.toNonIndexed());
  b.position.copy(a.position); b.updateMatrixWorld(true);
  const x = measure(a), y = meshMeasure(worldPoints(b), null, new T.Vector3(), new T.Vector3(0, 1, 0));
  assert(new T.Vector3(...x.centroid).distanceTo(a.position) < 1e-9);
  assert(new T.Vector3(...x.centroid).distanceTo(new T.Vector3(...y.centroid)) < 1e-9);
});
check('hexagonal endcap phase and different local bases preserve physical symmetry', () => {
  const axis = new T.Vector3(0, 1, 0), a = new T.Mesh(new T.CylinderGeometry(.018, .018, .010, 6));
  const b = new T.Mesh(new T.CylinderGeometry(.018, .018, .010, 6));
  a.rotation.y = .21; b.rotation.y = -.37; a.position.y = b.position.y = .088;
  a.updateMatrixWorld(true); b.updateMatrixWorld(true);
  assert(!exceeds(mirrorResidual(measure(a, new T.Vector3(), axis), measure(b, new T.Vector3(), axis))));
});
check('centroid symmetry detects misplaced hardware despite unchanged object origins', () => {
  const a = box(new T.Vector3(-.05, .02, .03)), b = box(new T.Vector3(.05, .02, .03));
  const left = measure(a), right = measure(b); assert(!exceeds(mirrorResidual(left, right)));
  b.geometry.translate(.001, 0, 0); assert(exceeds(mirrorResidual(left, measure(b))));
});
check('relative placement baseline allows new pivot world position and preserves noncoax supports', () => {
  const oldPivot = new T.Vector3(-1, 0, 1), newPivot = new T.Vector3(-2, .5, 3), offset = new T.Vector3(-.07, -.015, .03);
  const a = box(oldPivot.clone().add(offset)), b = box(newPivot.clone().add(offset));
  const baseline = measure(a, oldPivot, hingeAxis('L')), actual = measure(b, newPivot, hingeAxis('L'));
  assert(!exceeds(measurementResidual(actual, baseline, 'L', 1, true)));
  b.geometry.translate(0, .002, 0); assert(exceeds(measurementResidual(measure(b, newPivot, hingeAxis('L')), baseline, 'L', 1, true)));
});
check('representative forward/reverse poses enforce independent expected rigid motion for all vertices', () => {
  const pivot = new T.Vector3(-1.41, -.22, 1.41), mesh = box(pivot.clone().add(new T.Vector3(-.07, -.015, .03)));
  const points = worldPoints(mesh);
  assert.equal(HINGE_POSES[0], 1); assert.equal(HINGE_POSES.at(-1), 1); assert(HINGE_POSES.includes(0));
  for (const wing of HINGE_POSES) {
    const expected = points.map(p => cruiseToPose(p, pivot, 'L', wing, true));
    assert(rigidPlacementResidual(points, expected, pivot, 'L', wing, true) < 1e-12);
    if (wing !== 1) assert(rigidPlacementResidual(points, points, pivot, 'L', wing, true) > 1e-3);
    assert.equal(rigidPlacementResidual(points, points, pivot, 'L', wing, false), 0);
  }
});
check('single-vertex deformation and wrong-side moving attachment cannot hide in a rigid node origin', () => {
  const pivot = new T.Vector3(-1, 0, 1), points = worldPoints(box(pivot.clone().add(new T.Vector3(-.07, .02, .03))));
  const expected = points.map(p => cruiseToPose(p, pivot, 'L', .5, true));
  const broken = expected.map(p => p.clone()); broken[3].x += .0002;
  assert(rigidPlacementResidual(points, broken, pivot, 'L', .5, true) > ENCODING_TOLERANCE.runtime);
  const wrongSide = points.map(p => cruiseToPose(p, pivot, 'R', .5, true));
  assert(rigidPlacementResidual(points, wrongSide, pivot, 'L', .5, true) > .01);
  assert.throws(() => rigidPlacementResidual(points, broken.slice(1), pivot, 'L', .5, true), /vertex count/);
});
check('source and runtime thresholds remain exactly established encoding tolerances', () => {
  assert.deepEqual(ENCODING_TOLERANCE, {source: 1e-6, runtime: 6e-5});
  assert(exceeds({placement: 1.001e-6}, ENCODING_TOLERANCE.source));
  assert(exceeds({placement: 6.001e-5}, ENCODING_TOLERANCE.runtime));
});
check('invalid or empty decoded meshes cannot produce a passing centroid/span', () => {
  assert.throws(() => meshMeasure([], null, new T.Vector3(), hingeAxis('L')));
  assert.throws(() => meshMeasure([new T.Vector3(NaN, 0, 0)], null, new T.Vector3(), hingeAxis('L')));
  assert.throws(() => meshMeasure([new T.Vector3(), new T.Vector3(1, 0, 0), new T.Vector3(2, 0, 0)], null, new T.Vector3(), hingeAxis('L')), /volume/);
});


function fairingFixture(side: 'L' | 'R', fixed: boolean, options: {radius?: number; wall?: number; fixedLength?: number; missingInner?: boolean; disconnected?: boolean} = {}) {
  const row = hingeIdentity('RootFairing' + (fixed ? 'Fixed_' : 'Moving_') + side)!;
  const design = APPROVED_HINGE_FAIRINGS, pivot = new T.Vector3(side === 'L' ? -1.41 : 1.41, -.22, 1.41);
  const axis = hingeAxis(side), u = new T.Vector3(0, 0, 1).cross(axis).normalize(), v = axis.clone().cross(u).normalize();
  const points: T.Vector3[] = [], indices: number[] = [], rims: number[][] = [];
  const radial = 72, profileCount = 20, outward = fixed ? 1 : -1, wall = options.wall ?? .0025;
  const addTriangle = (a: number, b: number, c: number, reverse: boolean) => indices.push(a, reverse ? c : b, reverse ? b : c);
  const addQuad = (a: number, b: number, c: number, d: number, reverse: boolean) => { addTriangle(a, b, c, reverse); addTriangle(a, c, d, reverse); };
  for (const inner of options.missingInner ? [false] : [false, true]) {
    const radius = (options.radius ?? .044) - (inner ? wall : 0), depth = (fixed ? options.fixedLength ?? .142 : .082) - (inner ? wall : 0);
    const rings: number[][] = [];
    for (let k = 0; k <= profileCount; k++) {
      const phi = Math.PI * .5 * k / profileCount, r = radius * Math.sin(phi), q = r / .16;
      const t = .21 * (1 - Math.exp(-((r / .42) ** 2))) - .030 * (1 - q * q * (3 - 2 * q)) + outward * (.0015 + depth * Math.cos(phi));
      const ring: number[] = [];
      for (let j = 0; j < (k === 0 ? 1 : radial); j++) {
        const angle = .271 + j * Math.PI * 2 / radial; ring.push(points.length);
        points.push(pivot.clone().addScaledVector(axis, t).addScaledVector(u, r * Math.cos(angle)).addScaledVector(v, r * Math.sin(angle)));
      }
      rings.push(ring);
    }
    const reverse = (fixed ? 0 : 1) !== (inner ? 0 : 1);
    for (let j = 0; j < radial; j++) addTriangle(rings[0][0], rings[1][j], rings[1][(j + 1) % radial], reverse);
    for (let k = 1; k < profileCount; k++) for (let j = 0; j < radial; j++) addQuad(rings[k][j], rings[k + 1][j], rings[k + 1][(j + 1) % radial], rings[k][(j + 1) % radial], reverse);
    rims.push(rings.at(-1)!);
    if (options.disconnected || options.missingInner) {
      const cap = points.length; points.push(pivot.clone().addScaledVector(axis, -.030 + outward * .0015 + (inner ? .0003 : 0)));
      for (let j = 0; j < radial; j++) addTriangle(cap, rings.at(-1)![(j + 1) % radial], rings.at(-1)![j], reverse);
    }
  }
  if (!options.missingInner && !options.disconnected) for (let j = 0; j < radial; j++) addQuad(rims[0][j], rims[0][(j + 1) % radial], rims[1][(j + 1) % radial], rims[1][j], !fixed);
  // One global orientation correction makes the independently assembled fixture a positive material solid.
  if (meshMeasure(points, indices, pivot, axis).volume < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  return {row, points, indices, pivot, design};
}
const shell = (f: ReturnType<typeof fairingFixture>, tolerance: number = ENCODING_TOLERANCE.source) => fairingShellEvidence(f.row, f.points, f.indices, f.pivot, f.design, tolerance);

check('new fairing shape requires exact reviewed contract dimensions, without enlarging tolerances', () => {
  assert.deepEqual(validateHingeFairingDesign(structuredClone(APPROVED_HINGE_FAIRINGS)), APPROVED_HINGE_FAIRINGS);
  assert.throws(() => validateHingeFairingDesign(undefined), /required/);
  for (const change of [{outerRadius: .054}, {wallThickness: .001}, {fixedLength: .134}, {movingLength: .084}, {boreRadius: .05}, {radialSegments: 36}])
    assert.throws(() => validateHingeFairingDesign({...APPROVED_HINGE_FAIRINGS, ...change}), /Unapproved/);
  assert.throws(() => validateHingeFairingDesign({...APPROVED_HINGE_FAIRINGS, profile: {...APPROVED_HINGE_FAIRINGS.profile, lapDepth: .02}}), /Unapproved/);
});
check('all four actual thin shells realize complete .044/.0415 meridians and positive singlecomponent material', () => {
  for (const side of ['L', 'R'] as const) for (const fixed of [false, true]) {
    const result = shell(fairingFixture(side, fixed));
    assert(result.passed, JSON.stringify(result.failures)); assert(result.topology.closed); assert.equal(result.topology.componentCount, 1);
    assert(result.signedVolume > 1e-10); assert.equal(result.rings.length, 42); assert(result.rings.every(r => r.passed));
    assert.equal(result.outerRadius, .044); assert(Math.abs(result.innerRimRadius - .0415) < 1e-15);
    assert.equal(result.wallConstructionOffset, .0025); assert.equal(result.invalidSurfaceTriangles, 0);
  }
});
check('old .054 fairings, wrong wall offsets, and old fixed axial length are rejected by actual vertices', () => {
  for (const options of [{radius: .054}, {wall: .001}, {fixedLength: .134}]) {
    const result = shell(fairingFixture('L', true, options)); assert(!result.passed); assert(result.maximumProfileResidual > ENCODING_TOLERANCE.source);
  }
});
check('only redesigned fairing dimensions change; every nonfairing hardware nominal stays identical', () => {
  for (const name of fullNames) {
    const row = hingeIdentity(name)!;
    if (!row.family.startsWith('RootFairing')) assert.deepEqual(nominalHingeDimensions(row, APPROVED_HINGE_FAIRINGS), nominalHingeDimensions(row));
  }
  assert.equal(nominalHingeDimensions(hingeIdentity('RootFairingMoving_L')!, APPROVED_HINGE_FAIRINGS).outerRadius, .044);
});
check('outer-only solid dome cannot stand in for the actual inner cavity and finite wall', () => {
  const result = shell(fairingFixture('R', true, {missingInner: true}));
  assert(!result.passed); assert(result.rings.some(r => r.layer === 1 && !r.passed));
});
check('two disconnected closed surfaces cannot stand in for one closed thin shell', () => {
  const result = shell(fairingFixture('L', false, {disconnected: true}));
  assert(!result.passed); assert.equal(result.topology.componentCount, 2);
});
check('missing triangle and inverted winding cannot claim a positive closed shell', () => {
  const open = fairingFixture('L', true); open.indices.splice(0, 3); const a = shell(open); assert(!a.passed); assert(!a.topology.closed);
  const inverted = fairingFixture('R', false); for (let i = 0; i < inverted.indices.length; i += 3) [inverted.indices[i], inverted.indices[i + 1]] = [inverted.indices[i + 1], inverted.indices[i]];
  const b = shell(inverted); assert(!b.passed); assert(b.signedVolume < 0);
});
check('extra cross-layer cavity-filling face is rejected even when its vertices fit both meridians', () => {
  const f = fairingFixture('R', false); f.indices.push(72 * 10, 72 * 11, 1 + 72 * 20 + 72 * 10);
  const result = shell(f); assert(!result.passed); assert(result.invalidSurfaceTriangles > 0);
});
check('shell vertex proof accepts ordinary encoded point error at unchanged runtime tolerance', () => {
  const f = fairingFixture('L', true); f.points = f.points.map(p => new T.Vector3(...p.toArray().map(x => Math.round(x / 1e-6) * 1e-6)));
  assert(shell(f, ENCODING_TOLERANCE.runtime).passed);
  f.points[123].addScaledVector(hingeAxis('L'), .001); assert(!shell(f, ENCODING_TOLERANCE.runtime).passed);
});

check('actual shell proof tolerates duplicated normal corners and arbitrary rigid angular phase', () => {
  const f = fairingFixture('R', false);
  const points = f.points.map(p => p.clone().sub(f.pivot).applyAxisAngle(hingeAxis('R'), .612).add(f.pivot));
  const duplicated = f.indices.map(i => points[i].clone());
  assert(fairingShellEvidence(f.row, duplicated, null, f.pivot, f.design, ENCODING_TOLERANCE.source).passed);
});
process.once('exit', () => {
  if (!process.exitCode && process.env.QA_OUT) fs.writeFileSync(process.env.QA_OUT, JSON.stringify({passed: true, checks: tests, noModelLoaded: true,
    regressions: ['L_Rear substring double relocation', 'baked geometry displaced under unchanged object origin', 'missing side/station', 'wrong rigid body', 'legitimate mirrored bases/hex phases']}, null, 2) + '\n');
});
