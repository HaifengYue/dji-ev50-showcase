import * as THREE from 'three';
import { RENDER_QUALITY } from './renderQuality';

/** Rendering tolerances in conceptual scene units u; never alter aircraft geometry. */
export const AIRCRAFT_SHADOW = {
  mapSize: RENDER_QUALITY.shadowMapSize,
  boundsPadding: 0.25,
  explodedWingOffset: 1.4,
  normalBias: 0.0005,
  depthBiasUnits: 0.0001,
  groundHeight: -0.63,
} as const;

/** Rotating the aircraft cannot escape this origin-centred measured envelope. */
export function aircraftShadowRadius(bounds: THREE.Box3, groundOffset: number) {
  const x = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x));
  const y = Math.max(Math.abs(bounds.min.y - groundOffset), Math.abs(bounds.max.y - groundOffset));
  const z = Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z));
  return Math.hypot(x, y, z) + AIRCRAFT_SHADOW.boundsPadding;
}

/** Keep the sun direction, and follow the aircraft instead of clipping flight. */
export function updateAircraftShadow(
  light: THREE.DirectionalLight,
  sunOffset: readonly [number, number, number],
  anchor: THREE.Vector3,
  measuredRadius: number,
  exploded: boolean,
) {
  const extent = measuredRadius + (exploded ? AIRCRAFT_SHADOW.explodedWingOffset : 0);
  light.target.position.copy(anchor);
  light.target.updateMatrixWorld();
  light.position.set(...sunOffset).add(anchor);
  const distance = Math.hypot(...sunOffset);
  const upward = sunOffset[1] / distance;
  const near = Math.max(0.1, distance - extent - 0.5);
  // Include the actual ground receiver even when the aircraft is airborne.
  const far = Math.max(
    distance + extent + 0.5,
    distance + (Math.max(0, anchor.y - AIRCRAFT_SHADOW.groundHeight) + extent) / upward + 0.5,
  );
  const camera = light.shadow.camera;
  if (
    camera.left !== -extent ||
    camera.right !== extent ||
    camera.near !== near ||
    camera.far !== far
  ) {
    camera.left = camera.bottom = -extent;
    camera.right = camera.top = extent;
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }
  // A constant 0.0001 u depth offset avoids a larger bias at high flight altitude.
  light.shadow.bias = -AIRCRAFT_SHADOW.depthBiasUnits / (far - near);
  light.shadow.normalBias = AIRCRAFT_SHADOW.normalBias;
}
