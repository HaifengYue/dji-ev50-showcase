/** Narrow independent actual-geometry hinge gate; no Blender, collision sweep or author move list. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import * as T from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {createModelRig, applyModelPose} from '../../src/rig.ts';
import {verifiedReference} from './reference-records.mjs';
import {HINGE_BASELINE} from './hinge-identity-baseline.mts';
import {ENCODING_TOLERANCE, HINGE_POSES, hingeIdentity, hingeInventory, hingeAxis, worldPoints,
  meshMeasure, markerResidual, nominalMeshResidual, measurementResidual, rigidPlacementResidual,
  mirrorResidual, mirror, isHingeFairing, validateHingeFairingDesign, fairingShellEvidence, type Encoding, type MeshMeasure} from './hinge-identity.mts';

const baselineOnly = process.argv.includes('--baseline-check');
const markersOnly = process.argv.includes('--diagnostic-markers');
assert(!(baselineOnly && markersOnly), 'Choose one explicit diagnostic mode');
const previous = verifiedReference('previous-accepted-reference.json');
assert.equal(previous.sha256, HINGE_BASELINE.previousReferenceSha256);
assert.equal(previous.data.models.find((m: any) => m.encoding === 'source').modelSha256, HINGE_BASELINE.sourceModelSha256);
const contract = baselineOnly || markersOnly ? null : JSON.parse(fs.readFileSync('qa/contracts/layered-wing-refinement.json', 'utf8'));
if (contract) assert(contract.reviewed, 'Reviewed layered relocation contract is required');
const fairingDesign = contract ? validateHingeFairingDesign(contract.design.hingeFairings) : undefined;
const models: [Encoding, string][] = markersOnly
  ? [[(process.env.QA_ENCODING ?? 'source') as Encoding, process.env.QA_MODEL!]]
  : [['source', 'assets/blender/xp4-source.glb'], ['runtime', 'public/models/xp4.glb']];
assert(models.every(([encoding, file]) => file && Object.hasOwn(ENCODING_TOLERANCE, encoding)), 'Explicit diagnostic QA_MODEL and valid QA_ENCODING required');
const reports: any[] = [];
for (const [encoding, file] of models) {
  const bytes = fs.readFileSync(file), sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (contract) assert.equal(sha256, contract[encoding + 'Sha256'], 'Current hinge asset differs from reviewed contract');
  if (baselineOnly) assert.equal(sha256, previous.data.models.find((m: any) => m.encoding === encoding).modelSha256, 'Baseline diagnostic requires exact accepted asset');
  const {scene} = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const names: string[] = [], byName = new Map<string, T.Object3D>();
  scene.traverse(o => { names.push(o.name); assert(!byName.has(o.name), 'Duplicate actual scene name: ' + o.name); byName.set(o.name, o); });
  const tolerance = ENCODING_TOLERANCE[encoding], failures: any[] = [], poses: any[] = [];
  const fail = (reason: string, detail: any) => failures.push({reason, ...detail});
  const check = (reason: string, residuals: Record<string, number>, detail: any) => {
    if (Object.values(residuals).some(value => !Number.isFinite(value) || value > tolerance)) fail(reason, {...detail, residuals, tolerance});
  };
  const get = (name: string) => { const o = byName.get(name); assert(o, 'Missing actual hinge node ' + name); return o; };
  if (markersOnly) {
    // Explicit negative-test diagnostic. Missing unfinished attachments cannot turn it into a production pass.
    scene.updateMatrixWorld(true);
    const rows = names.map(hingeIdentity).filter(row => row && ['WingPivot', 'RootAxisStart', 'RootAxisEnd', 'RootBearingCenter', 'RootBearingFixed', 'RootBearingSeal'].includes(row.family));
    assert.equal(rows.length, 18, 'Marker diagnostic requires both pivots, axis ends, and both bearing stations on each side');
    const diagnosticIds = new Set(rows.map(row => row!.pairKey + ':' + row!.side));
    assert.equal(diagnosticIds.size, 18, 'Duplicate canonical marker/bearing diagnostic identity');
    for (const row of rows) {
      if (!row) continue;
      const node = get(row.name), pivot = get('WingPivot_' + row.side).getWorldPosition(new T.Vector3());
      if (!row.mesh) check('marker not at its canonical side/station on actual pivot axis', {placement: markerResidual(row, node.getWorldPosition(new T.Vector3()), pivot)}, {name: row.name});
      else {
        assert((node as T.Mesh).isMesh, 'Missing actual hinge hardware mesh: ' + row.name);
        const mesh = node as T.Mesh, points = worldPoints(mesh), measure = meshMeasure(points, mesh.geometry.index?.array ?? null, pivot, hingeAxis(row.side));
        check('actual decoded bearing material misses its canonical side/station/axis', nominalMeshResidual(row, measure, points, pivot), {name: row.name, measure});
      }
    }
    reports.push({encoding, file, sha256, passed: failures.length === 0, diagnosticOnly: true, failures});
    continue;
  }
  const inventory = hingeInventory(names), rig = createModelRig(scene);
  for (const row of inventory.rows) {
    const node = get(row.name); assert.equal(!!(node as T.Mesh).isMesh, row.mesh, 'Hinge marker/mesh type changed: ' + row.name);
    if (row.moving) assert.equal(node.parent?.name, 'WingPivot_' + row.side, 'Moving hinge must belong to its exact side pivot: ' + row.name);
    else if (row.family !== 'WingPivot') {
      let ancestor = node.parent;
      while (ancestor) { assert(!ancestor.name.startsWith('WingPivot_'), 'Fixed hinge follows a wing: ' + row.name); ancestor = ancestor.parent; }
    }
  }
  applyModelPose(rig, 1); scene.updateMatrixWorld(true);
  const cruisePivots = Object.fromEntries((['L', 'R'] as const).map(side => [side, get('WingPivot_' + side).getWorldPosition(new T.Vector3())]));
  const cruisePoints = new Map(inventory.rows.filter(row => row.mesh).map(row => [row.name, worldPoints(get(row.name) as T.Mesh)]));
  const fairingIndices = new Map(inventory.rows.filter(isHingeFairing).map(row => [row.name, Array.from((get(row.name) as T.Mesh).geometry.index?.array ?? [])]));
  const fairingShells: any[] = [];
  if (fairingDesign) for (const row of inventory.rows.filter(isHingeFairing)) {
    const mesh = get(row.name) as T.Mesh;
    const shell = fairingShellEvidence(row, cruisePoints.get(row.name)!, mesh.geometry.index?.array ?? null, cruisePivots[row.side], fairingDesign, tolerance);
    fairingShells.push({name: row.name, ...shell});
    if (!shell.passed) fail('actual fairing is not the reviewed complete positive thin shell', {name: row.name, shell});
  }
  for (const wing of HINGE_POSES) {
    applyModelPose(rig, wing); scene.updateMatrixWorld(true);
    const measurements = new Map<string, MeshMeasure>(), rows: any[] = [];
    for (const row of inventory.rows) {
      const node = get(row.name), pivot = get('WingPivot_' + row.side).getWorldPosition(new T.Vector3());
      check('hinge pivot drifted through the stroke', {placement: pivot.distanceTo(cruisePivots[row.side])}, {name: row.name, wing});
      if (contract) {
        const p = contract.design.rightPivotBlender, expected = new T.Vector3(p[0] * (row.side === 'L' ? -1 : 1), p[2], -p[1]);
        check('hinge does not occupy reviewed relocated position', {placement: pivot.distanceTo(expected)}, {side: row.side, wing});
      }
      if (!row.mesh) {
        const placement = markerResidual(row, node.getWorldPosition(new T.Vector3()), pivot);
        check('marker not at its canonical side/station on actual pivot axis', {placement}, {name: row.name, wing});
        rows.push({name: row.name, markerResidual: placement});
        continue;
      }
      const mesh = node as T.Mesh, points = worldPoints(mesh), measure = meshMeasure(points, mesh.geometry.index?.array ?? null, pivot, hingeAxis(row.side));
      if (fairingDesign && isHingeFairing(row)) assert.deepEqual(Array.from(mesh.geometry.index?.array ?? []), fairingIndices.get(row.name), 'Actual fairing triangle identity changed after shell proof: ' + row.name);
      measurements.set(row.pairKey + ':' + row.side, measure);
      const baseline = HINGE_BASELINE.measurements[row.name as keyof typeof HINGE_BASELINE.measurements];
      assert(baseline, 'Missing independently captured physical hinge reference: ' + row.name);
      // Only the four explicitly redesigned shells use the reviewed new meridians. All other hardware keeps its immutable physical baseline.
      const preservedPlacement = fairingDesign && isHingeFairing(row) ? null : measurementResidual(measure, baseline as unknown as MeshMeasure, row.side, wing, row.moving);
      const nominal = nominalMeshResidual(row, measure, points, pivot, fairingDesign);
      const rigid = rigidPlacementResidual(cruisePoints.get(row.name)!, points, cruisePivots[row.side], row.side, wing, row.moving);
      if (preservedPlacement) check('decoded hinge material lost accepted placement relative to relocated pivot', preservedPlacement, {name: row.name, wing});
      check('actual decoded hinge material misses physical axis/radius/axial station', nominal, {name: row.name, wing});
      check('decoded hinge vertices do not follow their expected fixed/moving rigid body', {rigid}, {name: row.name, wing});
      rows.push({name: row.name, measure, preservedPlacement, nominal, rigid});
    }
    const symmetry: any[] = [];
    for (const [key, pair] of inventory.pairs) {
      if (pair.L!.mesh) {
        const residuals = mirrorResidual(measurements.get(key + ':L')!, measurements.get(key + ':R')!);
        check('paired actual hinge material is not mirror placed', residuals, {pair: key, wing});
        symmetry.push({pair: key, residuals});
      } else {
        const left = get(pair.L!.name).getWorldPosition(new T.Vector3()), right = get(pair.R!.name).getWorldPosition(new T.Vector3());
        const residual = mirror(left).distanceTo(right);
        check('paired actual hinge markers are not mirror placed', {placement: residual}, {pair: key, wing});
        symmetry.push({pair: key, residual});
      }
    }
    poses.push({wing, rows, symmetry});
  }
  reports.push({encoding, file, sha256, tolerance, passed: failures.length === 0, inventory: inventory.rows, fairingDesign, fairingShells, poses, failures});
}
const report = {passed: reports.every(r => r.passed), baselineOnly, diagnosticOnly: markersOnly,
  certifiesCurrentLayeredPlacement: !baselineOnly && !markersOnly, reports,
  baseline: {sourceModelSha256: HINGE_BASELINE.sourceModelSha256, previousReferenceSha256: previous.sha256},
  method: 'Actual scene inventory and exact side/station grammar; real decoded triangles and all decoded mesh vertices. Mirror centers and axial/radial spans, not arbitrary local bases or hex phases. Independent 120-degree fixed-axis rigid motion relative to current pivots.',
  limitations: ['Representative stroke poses do not replace the mandatory full-stroke collision and support gates', 'Fairing wallThickness is the reviewed radial/depth construction offset, not a minimum or uniform normal wall thickness; shell proof grants no hardware-clearance exemption', 'Baseline/marker diagnostic modes cannot certify the new relocation', 'Concept geometry only; no engineering load or manufacturing certification']};
const output = process.env.QA_OUT ?? (markersOnly ? 'qa/current/hinge-identity-diagnostic-report.json' : 'qa/current/hinge-identity-report.json');
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log({passed: report.passed, certifiesCurrentLayeredPlacement: report.certifiesCurrentLayeredPlacement, models: reports.map(r => ({encoding: r.encoding, failures: r.failures}))});
if (!report.passed) process.exitCode = 1;
