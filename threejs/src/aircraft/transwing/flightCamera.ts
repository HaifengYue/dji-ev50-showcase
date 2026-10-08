import { Quaternion, Vector3 } from 'three';
export type TranswingFlightView = 'follow' | 'wide' | 'fpv' | 'down';
/** Transwing-only mounts in its +Z nose / +Y up / metre body convention.
 * FPV lies beyond the nose sensor (z=2.01); downward mount clears the belly.
 * No EV50 rotor, nose or fuselage geometry assumptions are reused.
 */
export const TRANSWING_CAMERA_MOUNTS = {
  follow: { position: [10, 5, -16], target: [0, 1, 3], up: [0, 1, 0] },
  wide: { position: [34, 24, -54], target: [0, 1, 10], up: [0, 1, 0] },
  fpv: { position: [0, 0.45, 2.5], target: [0, 0.45, 52.5], up: [0, 1, 0] },
  down: { position: [0, -0.8, 0], target: [0, -50, 0], up: [0, 0, 1] },
} as const;
export function trackingCameraPose(
  view: TranswingFlightView,
  position: Vector3,
  quaternion: Quaternion,
) {
  const mount = TRANSWING_CAMERA_MOUNTS[view];
  const transform = (value: readonly [number, number, number]) =>
    new Vector3(...value).applyQuaternion(quaternion).add(position);
  return {
    position: transform(mount.position),
    target: transform(mount.target),
    up: new Vector3(...mount.up).applyQuaternion(quaternion),
  };
}
