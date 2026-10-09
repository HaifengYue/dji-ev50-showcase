import { Quaternion, Vector3 } from 'three';
import { FlightController, labels, routes, type Frame, type State } from '../../flight';
import { sourceTime } from '../../timing';
import {
  DEMO_DURATION,
  DEMO_TIMES,
  DemoMotorTimeline,
  demoMotorCommands,
  demoVertical,
  sharedDemoTime,
} from './demoProfile';
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
export const WORLD_FLIGHT_DURATION = DEMO_DURATION;

// Same shared route phases, retimed only for this aircraft's local demonstration.
export const WORLD_FLIGHT_PHASES = [
  { id: 'idle', state: 'IDLE', start: 0, detail: '共同起降点待命。' },
  { id: 'starting', state: 'STARTING', start: 1, detail: '四台电机展开并升速。' },
  { id: 'takeoff', state: 'TAKEOFF', start: 4, detail: '整翼收拢，沿共享航线垂直起飞。' },
  { id: 'hover', state: 'HOVER', start: DEMO_TIMES.hover, detail: '悬停并准备整翼转换。' },
  {
    id: 'wing-transition',
    state: 'TRANSITION_TO_CRUISE',
    start: DEMO_TIMES.transition,
    detail: '整翼连续展开，后电机随升力功率减小并停桨。',
  },
  {
    id: 'cruise',
    state: 'CRUISE',
    start: DEMO_TIMES.cruise,
    detail: '两台前电机巡航，沿共同地形航线飞行。',
  },
  {
    id: 'deceleration-transition',
    state: 'TRANSITION_TO_HOVER',
    start: DEMO_TIMES.return,
    detail: '后电机恢复，整翼回转进入悬停。',
  },
  {
    id: 'hover-return',
    state: 'HOVER',
    start: DEMO_TIMES.hoverReturn,
    detail: '返回起降点上空悬停。',
  },
  { id: 'landing', state: 'LANDING', start: DEMO_TIMES.landing, detail: '垂直下降至共同起降点。' },
  {
    id: 'shutdown',
    state: 'SHUTDOWN',
    start: DEMO_TIMES.shutdown,
    detail: '四台电机减速、寻位并收桨。',
  },
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
export function worldMechanism(time: number) {
  const t = sourceTime(sharedDemoTime(time).time).time;
  const wingTilt = t < 20 ? smooth((t - 14) / 6) : t < 44 ? 1 : 1 - smooth((t - 44) / 6);
  return { wingTilt, motors: demoMotorCommands(time) };
}

/** Route adapter owns no scene, renderer, model, camera or second animation clock. */
export class TranswingWorldFlight {
  readonly controller: FlightController;
  readonly motors = new DemoMotorTimeline();
  verticalSpeedMps = 0;
  path: Vector3[];
  readonly identityAlignment = new Quaternion();
  constructor(frames: Frame[]) {
    if (!frames.length) throw new Error('Shared flight frames are required');
    this.controller = new FlightController(frames);
    this.controller.mode = 'flight';
    this.controller.seek(0);
    this.path = this.getPath();
  }
  setRoute(route: FlightController['route']) {
    this.controller.setRoute(route);
    this.path = this.getPath();
  }
  private getPath() {
    const path: Vector3[] = [];
    for (let t = 0; t <= WORLD_FLIGHT_DURATION; t += 0.5)
      path.push(this.sample(t).position.clone());
    this.sample(0);
    return path;
  }
  sample(time: number) {
    const shared = sharedDemoTime(time);
    this.controller.seek(shared.time);
    const vertical = demoVertical(time);
    const clock = sourceTime(shared.time);
    const index = Math.min(this.controller.frames.length - 1, Math.floor(clock.time * 30));
    const a = this.controller.frames[index],
      b = this.controller.frames[Math.min(index + 1, this.controller.frames.length - 1)];
    const horizontalSpeed =
      Math.hypot(b.position[0] - a.position[0], b.position[2] - a.position[2]) *
      routes[this.controller.route].scale *
      30 *
      clock.rate *
      shared.rate;
    this.controller.position.y = vertical.altitude;
    this.verticalSpeedMps = vertical.velocity;
    this.controller.speedMps = Math.hypot(horizontalSpeed, vertical.velocity);
    this.controller.routeProgress = Math.max(0, Math.min(1, time / WORLD_FLIGHT_DURATION));
    return {
      position: this.controller.position,
      quaternion: this.controller.quaternion,
      speedMps: this.controller.speedMps,
      verticalSpeedMps: this.verticalSpeedMps,
      routeProgress: this.controller.routeProgress,
      state: this.controller.state,
      ...worldMechanism(time),
    };
  }
}
