/** Lightweight host integration check, not a rebake or physical-motion suite. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../../threejs/node_modules/three/build/three.module.js';
import { loadRuntimeRig } from './lib/runtime-rotor-motion.mts';

test('Current runtime loads through the host Three.js and native rig', async () => {
  const { rig, parent } = await loadRuntimeRig();
  assert.ok(parent instanceof THREE.Group);
  assert.ok(rig.scene instanceof THREE.Object3D);
  assert.equal(rig.props.length, 4);
  assert.equal(rig.blades.length, 8);
});
