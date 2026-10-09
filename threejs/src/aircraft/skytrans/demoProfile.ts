import { CRUISE_ALTITUDE } from '../../terrain';
import {
  MOTOR_IDS,
  newMotorStates,
  stepMotors,
  type MotorCommands,
  type MotorStates,
} from './core/motors';
import type { MotorExposure } from './core/simulation';

/** Configurable presentation choices, NOT measured P4 performance or a flight controller.
 * Rates are per simulation second; the user's playback multiplier changes wall-clock motion.
 * Keep the shared terrain/path, but give the 180 m vertical legs enough actual time.
 */
export const SKYTRANS_DEMO_PROFILE = Object.freeze({
  altitudeM: CRUISE_ALTITUDE,
  climbMps: 3,
  descentMps: 2,
  velocityRampSeconds: 4,
  takeoffRpm: 1800,
  hoverRpm: 1600,
  cruiseRpm: 1800,
  landingRpm: 1550,
  shutdownSeconds: 6,
});
const profile = SKYTRANS_DEMO_PROFILE;
export const DEMO_TIMES = Object.freeze({
  starting: 1,
  takeoff: 4,
  hover: 4 + profile.altitudeM / profile.climbMps + profile.velocityRampSeconds,
  transition: 6 + profile.altitudeM / profile.climbMps + profile.velocityRampSeconds,
  cruise: 30 + profile.altitudeM / profile.climbMps + profile.velocityRampSeconds,
  return: 126 + profile.altitudeM / profile.climbMps + profile.velocityRampSeconds,
  hoverReturn: 150 + profile.altitudeM / profile.climbMps + profile.velocityRampSeconds,
  landing: 152 + profile.altitudeM / profile.climbMps + profile.velocityRampSeconds,
  shutdown:
    152 +
    profile.altitudeM / profile.climbMps +
    profile.altitudeM / profile.descentMps +
    2 * profile.velocityRampSeconds,
});
export const DEMO_DURATION = DEMO_TIMES.shutdown + profile.shutdownSeconds;
const clamp = (t: number) => Math.max(0, Math.min(1, t));
export const smoothDemo = (t: number) => {
  const u = clamp(t);
  return u * u * (3 - 2 * u);
};
const blend = (a: number, b: number, t: number) => a + (b - a) * smoothDemo(t);
const integral = (u: number) => u ** 3 - u ** 4 / 2;

/** Exact integral of a smoothstep velocity ramp, constant-speed middle, mirrored braking.
 * Distance = vmax * (duration - ramp). Peak acceleration = 1.5 * vmax / ramp.
 * Position, velocity and acceleration meet the stationary endpoints continuously.
 */
export function verticalLeg(
  elapsed: number,
  speed: number,
  distance = profile.altitudeM,
  ramp = profile.velocityRampSeconds,
) {
  const duration = distance / speed + ramp;
  if (elapsed <= 0) return { distance: 0, velocity: 0, acceleration: 0, duration };
  if (elapsed >= duration) return { distance, velocity: 0, acceleration: 0, duration };
  if (elapsed < ramp) {
    const u = elapsed / ramp;
    return {
      distance: speed * ramp * integral(u),
      velocity: speed * smoothDemo(u),
      acceleration: (speed * 6 * u * (1 - u)) / ramp,
      duration,
    };
  }
  if (elapsed > duration - ramp) {
    const u = (duration - elapsed) / ramp;
    return {
      distance: distance - speed * ramp * integral(u),
      velocity: speed * smoothDemo(u),
      acceleration: (-speed * 6 * u * (1 - u)) / ramp,
      duration,
    };
  }
  return { distance: speed * (elapsed - ramp / 2), velocity: speed, acceleration: 0, duration };
}
export function demoVertical(time: number) {
  if (time < DEMO_TIMES.hover) {
    const leg = verticalLeg(time - DEMO_TIMES.takeoff, profile.climbMps);
    return { altitude: leg.distance, velocity: leg.velocity, acceleration: leg.acceleration };
  }
  const leg = verticalLeg(time - DEMO_TIMES.landing, profile.descentMps);
  return {
    altitude: profile.altitudeM - leg.distance,
    velocity: -leg.velocity,
    acceleration: -leg.acceleration,
  };
}

/** Map only local demo time to the unchanged EV50 reference route. External clocks never use it. */
const anchors = [
  [0, 0],
  [4, 4],
  [DEMO_TIMES.hover, 16],
  [DEMO_TIMES.landing, 164],
  [DEMO_TIMES.shutdown, 176],
  [DEMO_DURATION, 180],
];
export function sharedDemoTime(time: number) {
  const t = Math.max(0, Math.min(DEMO_DURATION, time));
  let i = 0;
  while (i < anchors.length - 2 && t >= anchors[i + 1][0]) i++;
  const [start, source] = anchors[i],
    [end, next] = anchors[i + 1];
  const rate = (next - source) / (end - start);
  return { time: source + (t - start) * rate, rate };
}

/** All targets explicitly use demo RPM. Rear motors stop during forward conversion and finish folding before cruise,
 * and restart before reverse conversion; the actuator FSM still owns unfold/spin/index/fold.
 */
export function demoMotorCommands(time: number): MotorCommands {
  const t = DEMO_TIMES;
  let front = 0,
    rear = 0;
  if (time >= t.starting && time < t.takeoff)
    front = rear = blend(
      0,
      profile.takeoffRpm,
      (time - t.starting) / (t.takeoff - t.starting - 0.5),
    );
  else if (time < t.hover && time >= t.takeoff) front = rear = profile.takeoffRpm;
  else if (time < t.transition && time >= t.hover)
    front = rear = blend(profile.takeoffRpm, profile.hoverRpm, (time - t.hover) / 2);
  else if (time < t.cruise && time >= t.transition) {
    front = blend(profile.hoverRpm, profile.cruiseRpm, (time - t.transition) / 24);
    rear = blend(profile.hoverRpm, 0, (time - t.transition) / 19);
  } else if (time < t.return && time >= t.cruise) {
    front = profile.cruiseRpm;
    rear = time >= t.return - 3 ? blend(0, profile.hoverRpm, (time - (t.return - 3)) / 2) : 0;
  } else if (time < t.hoverReturn && time >= t.return) {
    front = blend(profile.cruiseRpm, profile.hoverRpm, (time - t.return) / 24);
    rear = profile.hoverRpm;
  } else if (time < t.landing && time >= t.hoverReturn)
    front = rear = blend(profile.hoverRpm, profile.landingRpm, (time - t.hoverReturn) / 2);
  else if (time < t.shutdown && time >= t.landing) front = rear = profile.landingRpm;
  else if (time >= t.shutdown) front = rear = blend(profile.landingRpm, 0, (time - t.shutdown) / 2);
  return Object.fromEntries(
    MOTOR_IDS.map((id) => {
      const targetRpm = id.endsWith('Rear') ? rear : front;
      return [id, { targetRpm, enabled: targetRpm >= 60 }];
    }),
  ) as MotorCommands;
}

/** Fixed 120 Hz command integration, cached at 30 Hz. A seek and uninterrupted playback
 * sample the same motor trajectory, independent of render cadence and playback speed.
 */
export class DemoMotorTimeline {
  private readonly checkpoints: MotorStates[] = [newMotorStates()];
  private integrate(before: MotorStates, startTick: number, endTime: number) {
    let state = before;
    for (let tick = startTick; tick / 120 < endTime - 1e-10; tick++) {
      const start = tick / 120,
        end = Math.min((tick + 1) / 120, endTime);
      state = stepMotors(state, demoMotorCommands((start + end) / 2), end - start);
    }
    return state;
  }
  sample(time: number) {
    const t = Math.max(0, Math.min(DEMO_DURATION, time));
    const frame = Math.floor(t * 30 + 1e-9);
    while (this.checkpoints.length <= frame) {
      const i = this.checkpoints.length;
      this.checkpoints.push(this.integrate(this.checkpoints[i - 1], (i - 1) * 4, i / 30));
    }
    return this.integrate(this.checkpoints[frame], frame * 4, t);
  }
  exposure(time: number, playbackRate: number): MotorExposure | null {
    const end = this.sample(time);
    const activeIds = MOTOR_IDS.filter(
      (id) => end[id].rpm * playbackRate >= 600 && end[id].fold === 0,
    );
    if (!activeIds.length || time <= 0) return null;
    const duration = Math.min(
      time,
      playbackRate / 60,
      30 / Math.max(...activeIds.map((id) => end[id].rpm)),
    );
    return {
      activeIds,
      samples: Array.from({ length: 16 }, (_, i) => this.sample(time - (duration * (15 - i)) / 15)),
    };
  }
}
