import { Quaternion, Vector3 } from 'three';
import { FlightController, labels, type Frame, type State } from '../../flight';
import { MISSION_DURATION, sourceTime } from '../../timing';
import { MOTOR_IDS, type MotorCommands } from './core/motors';
import { GROUND_HEIGHT } from './core/rig';

/** Shared world: right-handed metres, +Y up, body +X right/+Z nose, XYZW quaternion.
 * Both source GLBs have +Z noses and -Z tails. Keep unit scale and identity alignment;
 * no negative scale, swapped axes, or transformed copies of source rig geometry.
 * Route position is the ground-contact datum. Source Transwing measurements include
 * their old hangar floor at -0.6 m; only the parent body's Y offset compensates it.
 * Legacy Python/replay positionM is the original rig-translation convention:
 * worldDatum = legacyPosition + [0, GROUND_HEIGHT, 0]. Unified poses use world datum.
 */
export const TRANSWING_COORDINATES = Object.freeze({
  units: 'metres',
  handedness: 'right',
  up: '+Y',
  forward: '+Z',
  right: '+X',
  quaternionOrder: 'xyzw',
  scale: 1,
  bodyAlignment: [0, 0, 0, 1] as const,
  worldOrigin: 'ground-contact datum',
  legacyGroundHeight: GROUND_HEIGHT,
});
export const worldToLegacyPosition = (position: readonly [number, number, number]) =>
  [position[0], position[1] - GROUND_HEIGHT, position[2]] as [number, number, number];
export const legacyToWorldPosition = (position: readonly [number, number, number]) =>
  new Vector3(position[0], position[1] + GROUND_HEIGHT, position[2]);
export const bodyGroundOffset = (measuredOffset: number) => measuredOffset - GROUND_HEIGHT;
export const WORLD_FLIGHT_DURATION = MISSION_DURATION;

// These are the shared flight.json phase boundaries expressed by timing.ts' mission clock.
// A 180-second visual mission, not an aerodynamic simulation or actual flight controller.
export const WORLD_FLIGHT_PHASES = [
  { id: 'idle', state: 'IDLE', start: 0, detail: '共同起降点待命。' },
  { id: 'starting', state: 'STARTING', start: 1, detail: '四台电机展开并升速。' },
  { id: 'takeoff', state: 'TAKEOFF', start: 4, detail: '整翼收拢，沿共享航线垂直起飞。' },
  { id: 'hover', state: 'HOVER', start: 16, detail: '悬停并准备整翼转换。' },
  {
    id: 'wing-transition',
    state: 'TRANSITION_TO_CRUISE',
    start: 18,
    detail: '整翼连续展开，后电机随升力功率减小并停桨。',
  },
  { id: 'cruise', state: 'CRUISE', start: 42, detail: '两台前电机巡航，沿共同地形航线飞行。' },
  {
    id: 'deceleration-transition',
    state: 'TRANSITION_TO_HOVER',
    start: 138,
    detail: '后电机恢复，整翼回转进入悬停。',
  },
  { id: 'hover-return', state: 'HOVER', start: 162, detail: '返回起降点上空悬停。' },
  { id: 'landing', state: 'LANDING', start: 164, detail: '垂直下降至共同起降点。' },
  { id: 'shutdown', state: 'SHUTDOWN', start: 176, detail: '四台电机减速、寻位并收桨。' },
].map((phase) => ({ ...phase, label: labels[phase.state as State] }));
export function worldFlightPhase(time: number) {
  return (
    [...WORLD_FLIGHT_PHASES].reverse().find((phase) => time >= phase.start) ??
    WORLD_FLIGHT_PHASES[0]
  );
}
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
export function worldMechanism(time: number, lift: number, cruise: number) {
  const t = sourceTime(time).time;
  const wingTilt = t < 20 ? smooth((t - 14) / 6) : t < 44 ? 1 : 1 - smooth((t - 44) / 6);
  const motors = Object.fromEntries(
    MOTOR_IDS.map((id) => {
      const power = id.endsWith('Rear') ? lift : Math.max(lift, cruise);
      const targetRpm = Math.max(0, Math.min(1, power)) * 1800;
      return [id, { targetRpm, enabled: targetRpm >= 60 }];
    }),
  ) as MotorCommands;
  return { wingTilt, motors };
}

/** Route adapter owns no scene, renderer, model, camera or second animation clock. */
export class TranswingWorldFlight {
  readonly controller: FlightController;
  path: Vector3[];
  readonly identityAlignment = new Quaternion();
  constructor(frames: Frame[]) {
    if (!frames.length) throw new Error('Shared flight frames are required');
    this.controller = new FlightController(frames);
    this.controller.mode = 'flight';
    this.controller.seek(0);
    this.path = this.controller.getPath();
  }
  setRoute(route: FlightController['route']) {
    this.controller.setRoute(route);
    this.path = this.controller.getPath();
  }
  sample(time: number) {
    this.controller.seek(time);
    return {
      position: this.controller.position,
      quaternion: this.controller.quaternion,
      speedMps: this.controller.speedMps,
      routeProgress: this.controller.routeProgress,
      state: this.controller.state,
      ...worldMechanism(time, this.controller.lift, this.controller.cruise),
    };
  }
}
