import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../../threejs/node_modules/three/build/three.module.js';
import { loadRuntimeRig } from './lib/runtime-rotor-motion.mts';
import { applyModelPose, applySurfacePose, measureModelRig } from '../../../threejs/src/aircraft/skytrans/core/rig.ts';
import { defaultSimulationState } from '../../../threejs/src/aircraft/skytrans/core/simulation.ts';
import { cargoPresentationLift } from '../../../threejs/src/aircraft/skytrans/localControl.ts';

test('Local hatch slider clears the floor across both wing endpoints without changing external pose rules', async () => {
  const { rig, parent } = await loadRuntimeRig();
  const measurements = measureModelRig(rig);
  const surfaces = defaultSimulationState().surfaces;
  let minimum = Infinity;
  for (const wing of [0, 1]) for (let hatch = 0; hatch <= 55; hatch += 0.5) {
    parent.position.y = measurements.groundOffset + cargoPresentationLift(null, 'local', hatch, measurements.detailLift);
    applyModelPose(rig, wing);
    applySurfacePose(rig, surfaces, hatch);
    parent.updateMatrixWorld(true);
    const bottom = new THREE.Box3().setFromObject(parent).min.y;
    minimum = Math.min(minimum, bottom);
    assert.ok(bottom >= -0.630001, `hatch ${hatch}°, wing ${wing}: bottom ${bottom}`);
  }
  assert.equal(cargoPresentationLift(null, 'external', 55, measurements.detailLift), 0);
  assert.equal(cargoPresentationLift(null, 'replay', 55, measurements.detailLift), 0);
  assert.equal(cargoPresentationLift(null, 'local', 0, measurements.detailLift), 0);
  console.log(JSON.stringify({ hatchSamples: 222, minimumY: minimum, measuredLift: measurements.detailLift, floorY: -0.63, browserTested: false }));
});
