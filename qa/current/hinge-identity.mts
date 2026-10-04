/** Independent hinge identity and geometric placement checks. No author move list or Blender required. */
import assert from 'node:assert/strict';
import * as T from 'three';
import {solidTopology} from '../lib/solid-contact.mjs';

export type Side = 'L' | 'R';
export type Encoding = 'source' | 'runtime';
export const ENCODING_TOLERANCE = Object.freeze({source: 1e-6, runtime: 6e-5});
export const HINGE_POSES = Object.freeze([1, .75, .5, .25, 0, .5, 1]);
const families = ['WingPivot', 'RootAxisStart', 'RootAxisEnd', 'RootBearingCenter',
  'RootBearingFixed', 'RootBearingSeal', 'RootBearingHousing', 'RootHingeShaft',
  'RootHingeEndcap', 'RootCarrierMoving', 'RootCarrierThrust', 'RootCarrierBridge',
  'RootFairingFixed', 'RootFairingMoving', 'RootFixedBearingPedestal'] as const;
export type HingeFamily = typeof families[number];
export type HingeIdentity = {name: string; family: HingeFamily; side: Side; suffix: string; pairKey: string; moving: boolean; mesh: boolean};
export const REQUIRED_HINGE_PAIRS = Object.freeze(families.flatMap(family =>
  ['RootBearingCenter', 'RootBearingFixed', 'RootBearingSeal'].includes(family)
    ? ['Front', 'Rear'].map(suffix => family + '_' + suffix)
    : family === 'RootHingeEndcap' ? ['RootHingeEndcap_-0148', 'RootHingeEndcap_0148'] : [family]));

/** Side is a complete underscore-delimited token. Rear/Root/Leading are not sides. */
export function structuredSide(name: string): Side | null {
  const tokens = name.split('_').filter(token => token === 'L' || token === 'R');
  if (tokens.length > 1) throw new Error('Ambiguous structured side: ' + name);
  return tokens[0] as Side ?? null;
}
export function hingeIdentity(name: string): HingeIdentity | null {
  const family = families.find(f => name === f || name.startsWith(f + '_'));
  if (!family) {
    assert(!/^(WingPivot(?:_|$)|Root(?:Axis|Bearing|Hinge|Carrier|Fairing|FixedBearingPedestal))/.test(name), 'Unreviewed hinge family: ' + name);
    return null;
  }
  let side: Side, suffix = '';
  if (family === 'RootHingeEndcap') {
    // GLTFLoader strips periods from animation-safe names; permit both exact spellings.
    const match = /^RootHingeEndcap_([LR])(-?0\.?148)$/.exec(name);
    assert(match, 'Malformed hinge endcap identity: ' + name);
    side = match[1] as Side; suffix = match[2].replace('.', '');
  } else {
    const match = new RegExp('^' + family + '_([LR])(?:_(Front|Rear))?$').exec(name);
    assert(match, 'Malformed hinge identity: ' + name);
    side = structuredSide(name)!; suffix = match[2] ?? '';
    const hasStation = ['RootBearingCenter', 'RootBearingFixed', 'RootBearingSeal'].includes(family);
    assert.equal(!!suffix, hasStation, 'Missing/unexpected hinge station: ' + name);
  }
  return {name, family, side, suffix, pairKey: family + (suffix ? '_' + suffix : ''),
    moving: family.startsWith('RootCarrier') || family === 'RootFairingMoving',
    mesh: !['WingPivot', 'RootAxisStart', 'RootAxisEnd', 'RootBearingCenter'].includes(family)};
}
export function hingeInventory(names: string[]) {
  const rows = names.map(hingeIdentity).filter((x): x is HingeIdentity => x !== null);
  const pairs = new Map<string, Partial<Record<Side, HingeIdentity>>>();
  for (const row of rows) {
    const pair = pairs.get(row.pairKey) ?? {};
    assert(!pair[row.side], 'Duplicate hinge side identity: ' + row.name);
    pair[row.side] = row; pairs.set(row.pairKey, pair);
  }
  for (const key of REQUIRED_HINGE_PAIRS) {
    const pair = pairs.get(key);
    assert(pair?.L && pair?.R, 'Incomplete both-side hinge pair: ' + key);
  }
  assert.equal(pairs.size, REQUIRED_HINGE_PAIRS.length, 'Unreviewed hinge pair');
  return {rows, pairs};
}
export const hingeAxis = (side: Side) => new T.Vector3(side === 'L' ? 1 : -1, 1, 1).normalize();
export const sideSign = (side: Side) => side === 'L' ? -1 : 1;
export const mirror = (p: T.Vector3) => new T.Vector3(-p.x, p.y, p.z);
export function cruiseToPose(point: T.Vector3, pivot: T.Vector3, side: Side, wing: number, moving: boolean) {
  return moving ? point.clone().sub(pivot).applyAxisAngle(hingeAxis(side), -sideSign(side) * 2 * Math.PI * (wing - 1) / 3).add(pivot) : point.clone();
}
export function worldPoints(mesh: T.Mesh): T.Vector3[] {
  const position = mesh.geometry.getAttribute('position');
  assert(position && position.itemSize === 3 && position.count > 0, 'Missing decoded position data: ' + mesh.name);
  return Array.from({length: position.count}, (_, i) => new T.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
}
export type MeshMeasure = {centroid: number[]; axial: number[]; radial: number[]; volume: number; vertexCount: number};
/** Signed tetrahedral volume centroid uses triangles, not biased duplicated corner averages or object origins. */
export function meshMeasure(points: T.Vector3[], indices: ArrayLike<number> | null, pivot: T.Vector3, axis: T.Vector3): MeshMeasure {
  assert(points.length > 0 && points.every(p => p.toArray().every(Number.isFinite)), 'Nonfinite/empty decoded hinge geometry');
  const local = points.map(p => p.clone().sub(pivot));
  let minA = Infinity, maxA = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const p of local) {
    const axial = p.dot(axis), radial = p.clone().addScaledVector(axis, -axial).length();
    minA = Math.min(minA, axial); maxA = Math.max(maxA, axial); minR = Math.min(minR, radial); maxR = Math.max(maxR, radial);
  }
  const count = indices?.length ?? points.length; assert.equal(count % 3, 0, 'Hinge geometry is not triangulated');
  const centroid = new T.Vector3(); let volume6 = 0;
  for (let i = 0; i < count; i += 3) {
    const [a, b, c] = [0, 1, 2].map(k => local[indices ? indices[i + k] : i + k]);
    assert(a && b && c, 'Decoded hinge triangle has missing vertex');
    const v6 = a.dot(b.clone().cross(c)); volume6 += v6;
    centroid.addScaledVector(a.clone().add(b).add(c), v6 / 4);
  }
  assert(Number.isFinite(volume6) && Math.abs(volume6) > 1e-18, 'Hinge has no measurable signed material volume');
  centroid.divideScalar(volume6);
  return {centroid: centroid.toArray(), axial: [minA, maxA], radial: [minR, maxR], volume: volume6 / 6, vertexCount: points.length};
}
export function measurementResidual(actual: MeshMeasure, cruise: MeshMeasure, side: Side, wing: number, moving: boolean) {
  const center = cruiseToPose(new T.Vector3(...cruise.centroid), new T.Vector3(), side, wing, moving);
  return {centroid: new T.Vector3(...actual.centroid).distanceTo(center),
    axial: Math.max(...actual.axial.map((v, i) => Math.abs(v - cruise.axial[i]))),
    radial: Math.max(...actual.radial.map((v, i) => Math.abs(v - cruise.radial[i])))};
}
export function rigidPlacementResidual(cruise: T.Vector3[], actual: T.Vector3[], pivot: T.Vector3, side: Side, wing: number, moving: boolean) {
  assert.equal(actual.length, cruise.length, 'Rigid hinge changed decoded vertex count');
  let maximum = 0;
  for (let i = 0; i < actual.length; i++) maximum = Math.max(maximum, actual[i].distanceTo(cruiseToPose(cruise[i], pivot, side, wing, moving)));
  return maximum;
}
export function mirrorResidual(left: MeshMeasure, right: MeshMeasure) {
  return {centroid: mirror(new T.Vector3(...left.centroid)).distanceTo(new T.Vector3(...right.centroid)),
    axial: Math.max(...left.axial.map((v, i) => Math.abs(v - right.axial[i]))),
    radial: Math.max(...left.radial.map((v, i) => Math.abs(v - right.radial[i])))};
}

// Existing dimensions, independent of the current generator or its declared moved-node list.
// generate_transwing.py/ring_axis, hinge_supports.py and embedded_joint_surfaces.py.
export function nominalHingeDimensions(row: HingeIdentity, fairingDesign?: HingeFairingDesign) {
  const station = row.suffix === 'Front' ? -.050 : .060;
  switch (row.family) {
    case 'WingPivot': return {station: 0};
    case 'RootAxisStart': return {station: -.155};
    case 'RootAxisEnd': return {station: .155};
    case 'RootBearingCenter': return {station};
    case 'RootBearingFixed': return {station, length: .022, radii: [.017, .028]};
    case 'RootBearingSeal': return {station, length: .026, radii: [.016, .026]};
    case 'RootBearingHousing': return {station: .005, length: .132, radii: [.0258, .0277]};
    case 'RootCarrierMoving': return {station: -.020, length: .047, radii: [.030, .039]};
    case 'RootCarrierThrust': return {station: -.002, length: .009, radii: [.030, .039]};
    case 'RootHingeShaft': return {station: 0, length: .176, outerRadius: .014};
    case 'RootHingeEndcap': return {station: row.suffix.startsWith('-') ? -.088 : .088, length: .010, maximumRadius: .018};
    case 'RootFairingFixed': case 'RootFairingMoving': return {outerRadius: fairingDesign?.outerRadius ?? .054};
    default: return {};
  }
}
export function markerResidual(row: HingeIdentity, position: T.Vector3, pivot: T.Vector3) {
  const expected = pivot.clone().addScaledVector(hingeAxis(row.side), nominalHingeDimensions(row).station!);
  return position.distanceTo(expected);
}
export function nominalMeshResidual(row: HingeIdentity, measure: MeshMeasure, points: T.Vector3[], pivot: T.Vector3, fairingDesign?: HingeFairingDesign) {
  const axis = hingeAxis(row.side), nominal = nominalHingeDimensions(row, fairingDesign), errors: Record<string, number> = {};
  const center = new T.Vector3(...measure.centroid);
  if (!['RootCarrierBridge', 'RootFixedBearingPedestal'].includes(row.family)) errors.coaxis = center.clone().cross(axis).length();
  if (nominal.station !== undefined) errors.station = Math.abs(center.dot(axis) - nominal.station);
  if (nominal.length !== undefined) errors.axial = Math.max(Math.abs(measure.axial[0] - (nominal.station! - nominal.length / 2)), Math.abs(measure.axial[1] - (nominal.station! + nominal.length / 2)));
  if (nominal.outerRadius !== undefined) errors.outerRadius = Math.abs(measure.radial[1] - nominal.outerRadius);
  if (nominal.maximumRadius !== undefined) errors.maximumRadius = Math.max(0, measure.radial[1] - nominal.maximumRadius);
  if (nominal.radii) {
    errors.innerRadius = Math.abs(measure.radial[0] - nominal.radii[0]);
    errors.outerRadius = Math.abs(measure.radial[1] - nominal.radii[1]);
    // Every real corner must lie on one of the two retained cylindrical radii.
    errors.allCylinderCorners = points.reduce((max, p) => {
      const q = p.clone().sub(pivot), radial = q.addScaledVector(axis, -q.dot(axis)).length();
      return Math.max(max, Math.min(...nominal.radii!.map(r => Math.abs(radial - r))));
    }, 0);
  }
  return errors;
}


export const isHingeFairing = (row: HingeIdentity) => row.family === 'RootFairingFixed' || row.family === 'RootFairingMoving';
export type HingeFairingDesign = {outerRadius: number; wallThickness: number; fixedLength: number; movingLength: number;
  halfSeam: number; profile: {baseDepth: number; baseRadius: number; lapDepth: number; lapEnd: number};
  radialSegments: number; profileSegments: number; boreRadius: number};
/** These are the explicitly authorized new physical dimensions, not enlarged acceptance tolerances. */
export const APPROVED_HINGE_FAIRINGS: HingeFairingDesign = Object.freeze({outerRadius: .044, wallThickness: .0025,
  fixedLength: .142, movingLength: .082, halfSeam: .0015,
  profile: Object.freeze({baseDepth: .21, baseRadius: .42, lapDepth: .030, lapEnd: .160}),
  radialSegments: 72, profileSegments: 20, boreRadius: .045});
export function validateHingeFairingDesign(value: any): HingeFairingDesign {
  assert(value && typeof value === 'object', 'Reviewed design.hingeFairings is required for redesigned shells');
  for (const key of Object.keys(APPROVED_HINGE_FAIRINGS) as (keyof HingeFairingDesign)[])
    assert.deepEqual(value[key], APPROVED_HINGE_FAIRINGS[key], 'Unapproved hinge-fairing dimension: ' + key);
  return value;
}
export function hingeFairingMeridian(row: HingeIdentity, design: HingeFairingDesign) {
  assert(isHingeFairing(row), 'Fairing meridian requires an exact fairing identity');
  const outward = row.family === 'RootFairingFixed' ? 1 : -1;
  const length = outward === 1 ? design.fixedLength : design.movingLength;
  const result: {layer: number; k: number; r: number; t: number}[] = [];
  for (const layer of [0, 1]) for (let k = 0; k <= design.profileSegments; k++) {
    const phi = Math.PI * .5 * k / design.profileSegments, radius = design.outerRadius - layer * design.wallThickness;
    const r = radius * Math.sin(phi), q = Math.max(0, Math.min(1, r / design.profile.lapEnd));
    const profile = design.profile.baseDepth * (1 - Math.exp(-((r / design.profile.baseRadius) ** 2))) - design.profile.lapDepth * (1 - q * q * (3 - 2 * q));
    result.push({layer, k, r, t: profile + outward * (design.halfSeam + (length - layer * design.wallThickness) * Math.cos(phi))});
  }
  return result;
}
/** Actual decoded shell, including both complete meridians and the sole finite closing rim.
 * Wall is the prescribed radial/depth offset; this does not claim uniform surface-normal thickness.
 * Inner hardware clearance still requires the mandatory actual all-face collision/support gates. */
export function fairingShellEvidence(row: HingeIdentity, points: T.Vector3[], indices: ArrayLike<number> | null,
  pivot: T.Vector3, design: HingeFairingDesign, tolerance: number) {
  assert(Object.values(ENCODING_TOLERANCE).includes(tolerance as any), 'Use an unchanged source/runtime encoding tolerance');
  const meridian = hingeFairingMeridian(row, design), axis = hingeAxis(row.side);
  const u = new T.Vector3(0, 0, 1).cross(axis).normalize(), v = axis.clone().cross(u).normalize();
  const groups = meridian.map(() => new Map<string, number>()), assignments: number[] = [];
  const vertexIds = new Map<string, number>(), edgeCounts = new Map<string, {count: number; balance: number}>();
  const key = (p: T.Vector3) => p.toArray().map(x => Math.round(x / 1e-12)).join(',');
  let maximumProfileResidual = 0;
  for (const p of points) {
    const q = p.clone().sub(pivot), t = q.dot(axis), radial = q.clone().addScaledVector(axis, -t), r = radial.length();
    let nearest = -1, residual = Infinity;
    for (const [i, expected] of meridian.entries()) { const d = Math.hypot(r - expected.r, t - expected.t); if (d < residual) { nearest = i; residual = d; } }
    maximumProfileResidual = Math.max(maximumProfileResidual, residual); assignments.push(nearest);
    groups[nearest].set(key(p), Math.atan2(radial.dot(v), radial.dot(u)));
    if (!vertexIds.has(key(p))) vertexIds.set(key(p), vertexIds.size);
  }
  const count = indices?.length ?? points.length; assert.equal(count % 3, 0);
  const triangles: any[] = []; let invalidSurfaceTriangles = 0, degenerateTriangles = 0, maximumTriangleAngularResidual = 0;
  for (let i = 0; i < count; i += 3) {
    const ids = [0, 1, 2].map(j => indices ? indices[i + j] : i + j), actual = ids.map(id => points[id]);
    assert(actual.every(Boolean), 'Fairing triangle references absent decoded vertex');
    const expected = ids.map(id => meridian[assignments[id]]), layers = new Set(expected.map(p => p.layer));
    const adjacentProfile = Math.max(...expected.map(p => p.k)) - Math.min(...expected.map(p => p.k)) <= 1;
    const validSurface = layers.size === 1 ? adjacentProfile : expected.every(p => p.k === design.profileSegments);
    if (!validSurface) invalidSurfaceTriangles++;
    const angles = actual.map(p => { const q = p.clone().sub(pivot); return Math.atan2(q.dot(v), q.dot(u)); });
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) if (expected[a].k && expected[b].k) {
      const gap = Math.abs(Math.atan2(Math.sin(angles[a] - angles[b]), Math.cos(angles[a] - angles[b])));
      maximumTriangleAngularResidual = Math.max(maximumTriangleAngularResidual, Math.min(expected[a].r, expected[b].r) * Math.max(0, gap - Math.PI * 2 / design.radialSegments));
    }
    const ab = actual[1].clone().sub(actual[0]), ac = actual[2].clone().sub(actual[0]);
    const longest = Math.max(ab.length(), ac.length(), actual[2].distanceTo(actual[1]));
    if (longest === 0 || ab.divideScalar(longest).cross(ac.divideScalar(longest)).length() <= 64 * Number.EPSILON) degenerateTriangles++;
    const welded = actual.map(p => vertexIds.get(key(p))!);
    for (let j = 0; j < 3; j++) { const a = welded[j], b = welded[(j + 1) % 3], edge = a < b ? a + ',' + b : b + ',' + a;
      const tally = edgeCounts.get(edge) ?? {count: 0, balance: 0}; tally.count++; tally.balance += a < b ? 1 : -1; edgeCounts.set(edge, tally); }
    triangles.push({triangleIndex: i / 3, vertices: actual.map(p => p.toArray())});
  }
  const topology = solidTopology({triangles}, 1e-12), measure = meshMeasure(points, indices, pivot, axis);
  const rings = meridian.map((expected, i) => {
    const angles = [...groups[i].values()].sort((a, b) => a - b), desired = expected.k === 0 ? 1 : design.radialSegments;
    const gaps = expected.k === 0 ? [] : angles.map((angle, j) => ((j + 1 < angles.length ? angles[j + 1] : angles[0] + Math.PI * 2) - angle));
    const maximumAngularSpacingResidual = gaps.length ? expected.r * Math.max(...gaps.map(gap => Math.abs(gap - Math.PI * 2 / design.radialSegments))) : 0;
    return {...expected, uniqueVertices: angles.length, expectedUniqueVertices: desired, maximumAngularSpacingResidual,
      passed: angles.length === desired && maximumAngularSpacingResidual <= tolerance};
  });
  const inconsistentWindingEdges = [...edgeCounts.values()].filter(e => e.count !== 2 || e.balance !== 0).length;
  const failures: string[] = [];
  if (maximumProfileResidual > tolerance || !Number.isFinite(maximumProfileResidual)) failures.push('actual decoded vertices miss reviewed inner/outer meridians');
  if (rings.some(r => !r.passed)) failures.push('incomplete or nonuniform actual inner/outer circumference');
  if (!topology.closed || topology.componentCount !== 1) failures.push('fairing must be one actual closed material component');
  if (inconsistentWindingEdges || degenerateTriangles || invalidSurfaceTriangles || maximumTriangleAngularResidual > tolerance) failures.push('fairing has invalid winding, degenerate faces or cavity-filling cross-layer faces');
  if (!(measure.volume > 1e-10)) failures.push('fairing must retain positive actual signed material volume');
  return {passed: failures.length === 0, failures, maximumProfileResidual, topology, signedVolume: measure.volume,
    degenerateTriangles, inconsistentWindingEdges, invalidSurfaceTriangles, maximumTriangleAngularResidual, rings,
    outerRadius: design.outerRadius, innerRimRadius: design.outerRadius - design.wallThickness,
    wallConstructionOffset: design.wallThickness,
    claimBoundary: 'Actual complete two-surface thin shell. No exemption or blanket inner-hardware/wing clearance claim; independent all-face collision and support gates remain mandatory.'};
}
