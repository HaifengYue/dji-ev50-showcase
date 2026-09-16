import { Matrix4, Quaternion, Vector3 } from 'three';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type CoordinateFrame = 'SCENE' | 'NED' | 'ENU';
export type Surfaces = { aileron: number; elevator: number; rudder: number };
/** A complete, read-only visual state, never a flight-control command. */
export interface TelemetryFrame {
  version: 1;
  sequence: number;
  time: number;
  frame: CoordinateFrame;
  position: Vec3;
  quaternion: Quat;
  velocity: Vec3;
  rotorRpm: number[];
  surfaces: Surfaces;
}
export const ROTOR_NAMES = [
  'LiftRotor_Left_Front_0',
  'LiftRotor_Left_Front_1',
  'LiftRotor_Left_Rear_0',
  'LiftRotor_Left_Rear_1',
  'LiftRotor_Right_Front_0',
  'LiftRotor_Right_Front_1',
  'LiftRotor_Right_Rear_0',
  'LiftRotor_Right_Rear_1',
  'CruiseRotor_Left',
  'CruiseRotor_Right',
  'CruiseRotor_Tail',
] as const;
export const MAX_LOG_FRAMES = 12000;
export const STALE_SECONDS = 0.75;
export const INTERPOLATION_DELAY = 0.08;

const number = (v: unknown, label: string, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw new Error(`${label} must be finite and within [${min}, ${max}]`);
  return v;
};
const vector = (v: unknown, size: number, label: string, bound: number): number[] => {
  if (!Array.isArray(v) || v.length !== size) throw new Error(`${label} requires ${size} values`);
  return Array.from(v, (n, i) => number(n, `${label}[${i}]`, -bound, bound));
};
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected an object');
  return v as Record<string, unknown>;
};

// Scene = East, Up, South. Model = -Right, Up, Forward.
// Input aerospace quaternions rotate FRD body vectors into the named world.
const nedToScene = new Quaternion().setFromRotationMatrix(
  new Matrix4().set(0, 1, 0, 0, 0, 0, -1, 0, -1, 0, 0, 0, 0, 0, 0, 1),
);
const enuToScene = new Quaternion().setFromRotationMatrix(
  new Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1),
);
const modelToFrd = new Quaternion().setFromRotationMatrix(
  new Matrix4().set(0, 0, 1, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 1),
);

/** Validate the entire packet before changing any state. Output owns its arrays. */
export function normalizeFrame(input: unknown): TelemetryFrame {
  const f = object(input);
  if (f.version !== 1) throw new Error('Unsupported telemetry version; expected 1');
  const sequence = number(f.sequence, 'sequence', 0, Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(sequence)) throw new Error('sequence must be an integer');
  const time = number(f.time, 'time (seconds)', 0, 1e12);
  if (!['SCENE', 'NED', 'ENU'].includes(String(f.frame)))
    throw new Error('Unknown coordinate frame');
  const p = new Vector3().fromArray(vector(f.position, 3, 'position (m)', 1e7));
  const v = new Vector3().fromArray(vector(f.velocity, 3, 'velocity (m/s)', 1e5));
  const q = new Quaternion().fromArray(vector(f.quaternion, 4, 'quaternion xyzw', 1e6));
  if (q.lengthSq() < 1e-16) throw new Error('Quaternion must be nonzero');
  q.normalize();
  const rpm = vector(f.rotorRpm, ROTOR_NAMES.length, 'rotorRpm', 30000);
  if (rpm.some((n) => n < 0))
    throw new Error('rotorRpm must be nonnegative; direction comes from the asset');
  const s = object(f.surfaces);
  const surfaces = {
    aileron: number(s.aileron, 'aileron', -1, 1),
    elevator: number(s.elevator, 'elevator', -1, 1),
    rudder: number(s.rudder, 'rudder', -1, 1),
  };
  if (f.frame !== 'SCENE') {
    const world = f.frame === 'NED' ? nedToScene : enuToScene;
    p.applyQuaternion(world);
    v.applyQuaternion(world);
    q.premultiply(world).multiply(modelToFrd).normalize();
  }
  return {
    version: 1,
    sequence,
    time,
    frame: 'SCENE',
    position: p.toArray(),
    velocity: v.toArray(),
    quaternion: q.toArray(),
    rotorRpm: rpm,
    surfaces,
  };
}

export function interpolate(
  a: TelemetryFrame,
  b: TelemetryFrame,
  fraction: number,
): TelemetryFrame {
  const t = Math.max(0, Math.min(1, fraction));
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return {
    ...a,
    sequence: t >= 1 ? b.sequence : a.sequence,
    time: lerp(a.time, b.time),
    position: a.position.map((v, i) => lerp(v, b.position[i])) as Vec3,
    velocity: a.velocity.map((v, i) => lerp(v, b.velocity[i])) as Vec3,
    quaternion: new Quaternion()
      .fromArray(a.quaternion)
      .slerp(new Quaternion().fromArray(b.quaternion), t)
      .toArray(),
    rotorRpm: a.rotorRpm.map((v, i) => lerp(v, b.rotorRpm[i])),
    surfaces: {
      aileron: lerp(a.surfaces.aileron, b.surfaces.aileron),
      elevator: lerp(a.surfaces.elevator, b.surfaces.elevator),
      rudder: lerp(a.surfaces.rudder, b.surfaces.rudder),
    },
  };
}

/** Bounded receive-time jitter buffer. Never predicts or clamps source positions. */
export class TelemetryBuffer {
  private entries: { frame: TelemetryFrame; receivedAt: number }[] = [];
  accepted = 0;
  rejected = 0;
  gaps = 0;
  reset() {
    this.entries = [];
    this.accepted = this.rejected = this.gaps = 0;
  }
  push(input: unknown, now: number): TelemetryFrame {
    try {
      number(now, 'receive time', 0, 1e12);
      const frame = normalizeFrame(input),
        last = this.entries.at(-1);
      if (
        last &&
        (frame.sequence <= last.frame.sequence ||
          frame.time < last.frame.time ||
          now < last.receivedAt)
      )
        throw new Error('Out-of-order frame; reset the session before restarting a source clock');
      if (last) this.gaps += frame.sequence - last.frame.sequence - 1;
      this.entries.push({ frame, receivedAt: now });
      if (this.entries.length > 120) this.entries.shift();
      this.accepted++;
      return normalizeFrame(frame);
    } catch (error) {
      this.rejected++;
      throw error;
    }
  }
  sample(now: number): TelemetryFrame | null {
    const first = this.entries[0];
    if (!first) return null;
    const target = now - INTERPOLATION_DELAY;
    if (target <= first.receivedAt) return normalizeFrame(first.frame);
    for (let i = 1; i < this.entries.length; i++) {
      const a = this.entries[i - 1],
        b = this.entries[i];
      if (target < b.receivedAt) {
        const gap = b.receivedAt - a.receivedAt;
        // A recovered connection must not glide across a long outage.
        return gap > STALE_SECONDS
          ? normalizeFrame(a.frame)
          : interpolate(a.frame, b.frame, gap ? (target - a.receivedAt) / gap : 1);
      }
    }
    return normalizeFrame(this.entries.at(-1)!.frame);
  }
  status(now: number) {
    const last = this.entries.at(-1),
      age = last ? Math.max(0, now - last.receivedAt) : null;
    return {
      accepted: this.accepted,
      rejected: this.rejected,
      gaps: this.gaps,
      buffered: this.entries.length,
      ageSeconds: age,
      stale: age !== null && age > STALE_SECONDS,
      waiting: !last,
    };
  }
}

export function parseRecording(input: unknown): TelemetryFrame[] {
  const log = object(input);
  if (
    log.version !== 1 ||
    !Array.isArray(log.frames) ||
    log.frames.length < 2 ||
    log.frames.length > MAX_LOG_FRAMES
  )
    throw new Error(`Recording requires version 1 and 2–${MAX_LOG_FRAMES} frames`);
  const frames = log.frames.map(normalizeFrame);
  for (let i = 1; i < frames.length; i++)
    if (frames[i].sequence <= frames[i - 1].sequence || frames[i].time < frames[i - 1].time)
      throw new Error('Recording sequence/time must be monotonic');
  if (frames.at(-1)!.time <= frames[0].time)
    throw new Error('Recording must have a positive duration');
  return frames;
}

export class TelemetryReplay {
  private frames: TelemetryFrame[] = [];
  time = 0;
  duration = 0;
  playing = false;
  load(input: unknown) {
    const frames = parseRecording(input); // No partial mutation on a bad log.
    this.frames = frames;
    this.duration = frames.at(-1)!.time - frames[0].time;
    this.time = 0;
    this.playing = true;
  }
  seek(time: number) {
    this.time = number(time, 'replay time', 0, this.duration);
  }
  tick(dt: number) {
    if (this.playing) {
      this.time = Math.min(this.duration, this.time + Math.max(0, dt));
      if (this.time >= this.duration) this.playing = false;
    }
    return this.sample();
  }
  sample(): TelemetryFrame | null {
    if (!this.frames.length) return null;
    const target = this.frames[0].time + this.time;
    let lo = 0,
      hi = this.frames.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.frames[mid].time <= target) lo = mid;
      else hi = mid - 1;
    }
    const a = this.frames[lo],
      b = this.frames[Math.min(lo + 1, this.frames.length - 1)];
    return interpolate(a, b, b.time === a.time ? 0 : (target - a.time) / (b.time - a.time));
  }
}

/** Deterministic graphics fixture. No aircraft dynamics or autopilot is simulated. */
export function sampleRecording() {
  const frames: TelemetryFrame[] = [];
  for (let i = 0; i <= 900; i++) {
    const time = i / 20,
      u = Math.min(1, time / 8),
      settle = Math.min(1, (45 - time) / 8);
    const height = 24 * Math.sin((Math.min(u, settle) * Math.PI) / 2) ** 2;
    const angle = Math.max(0, Math.min(1, (time - 8) / 29)) * Math.PI * 2;
    const moving = time > 8 && time < 37,
      omega = moving ? (Math.PI * 2) / 29 : 0;
    const power = Math.min(1, height / 2),
      cruise = moving ? 1800 : 0;
    frames.push({
      version: 1,
      sequence: i,
      time,
      frame: 'SCENE',
      position: [20 * Math.sin(angle), height, 20 * (Math.cos(angle) - 1)],
      velocity: [
        20 * Math.cos(angle) * omega,
        time < 8
          ? ((24 * Math.PI) / 16) * Math.sin(Math.PI * u)
          : time > 37
            ? ((-24 * Math.PI) / 16) * Math.sin(Math.PI * settle)
            : 0,
        -20 * Math.sin(angle) * omega,
      ],
      quaternion: new Quaternion()
        .setFromAxisAngle(new Vector3(0, 1, 0), moving ? angle + Math.PI / 2 : Math.PI / 2)
        .toArray(),
      rotorRpm: ROTOR_NAMES.map((_, j) => (j < 8 ? power * (moving ? 450 : 1500) : cruise)),
      surfaces: {
        aileron: moving ? 0.25 * Math.sin(time) : 0,
        elevator: 0.1 * Math.sin(time * 0.5),
        rudder: moving ? 0.15 : 0,
      },
    });
  }
  return { version: 1, description: 'Synthetic visual fixture, not a flight model', frames };
}
