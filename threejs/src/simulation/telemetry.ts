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
export type RecordingFormat = 'ev50-json' | 'mavlink-jsonl';

/**
 * Incrementally turns the MAVLink-shaped JSON messages used on a WebSocket
 * into the page's complete visual frame.  This deliberately handles only
 * state messages: command messages belong to the local test broker and are
 * never forwarded to an aircraft from this browser.
 */
export class MavlinkLiveDecoder {
  private sequence = 0;
  private position: Record<string, unknown> | undefined;
  private attitude: Record<string, unknown> | undefined;
  private actuator: Record<string, unknown> | undefined;
  private positionTime: number | undefined;
  private attitudeTime: number | undefined;
  private actuatorTime: number | undefined;
  private emittedTime: number | undefined;

  reset() {
    this.sequence = 0;
    this.position = this.attitude = this.actuator = undefined;
    this.positionTime = this.attitudeTime = this.actuatorTime = this.emittedTime = undefined;
  }

  push(input: unknown): TelemetryFrame | null {
    const message = object(input);
    if (message.type === 'EV50_VISUAL_FRAME') return normalizeFrame(message.frame);
    if (message.version === 1 && 'frame' in message && 'position' in message)
      return normalizeFrame(message);
    if (
      !['LOCAL_POSITION_NED', 'ATTITUDE_QUATERNION', 'ACTUATOR_OUTPUT_STATUS'].includes(
        String(message.type),
      )
    )
      return null;
    const time = mavlinkTime(message);
    if (message.type === 'LOCAL_POSITION_NED') {
      this.position = message;
      this.positionTime = time;
    }
    if (message.type === 'ACTUATOR_OUTPUT_STATUS') {
      this.actuator = message;
      this.actuatorTime = time;
    }
    if (message.type === 'ATTITUDE_QUATERNION') {
      this.attitude = message;
      this.attitudeTime = time;
    }
    if (
      !this.position ||
      !this.attitude ||
      this.positionTime !== this.attitudeTime ||
      this.emittedTime === this.positionTime
    )
      return null;
    const outputs = Array.isArray(this.actuator?.actuator) ? this.actuator.actuator : [];
    const controls = Array.isArray(this.actuator?.controls) ? this.actuator.controls : [];
    this.emittedTime = this.positionTime;
    return normalizeFrame({
      version: 1,
      sequence: this.sequence++,
      time: this.positionTime,
      frame: 'NED',
      position: [this.position.x, this.position.y, this.position.z],
      velocity: [this.position.vx ?? 0, this.position.vy ?? 0, this.position.vz ?? 0],
      quaternion: fromMavlinkQuaternion(this.attitude),
      rotorRpm: Array.from({ length: ROTOR_NAMES.length }, (_, i) => outputs[i] ?? 0),
      surfaces: {
        aileron: controls[0] ?? 0,
        elevator: controls[1] ?? 0,
        rudder: controls[2] ?? 0,
      },
    });
  }
}

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
  let source = input;
  if (typeof source === 'string') {
    const text = source;
    try {
      source = JSON.parse(text) as unknown;
    } catch {
      return validateRecording(parseMavlinkJsonl(text));
    }
  }
  const log = object(source);
  if (
    log.version !== 1 ||
    !Array.isArray(log.frames) ||
    log.frames.length < 2 ||
    log.frames.length > MAX_LOG_FRAMES
  )
    throw new Error(`Recording requires version 1 and 2–${MAX_LOG_FRAMES} frames`);
  return validateRecording(log.frames.map(normalizeFrame));
}

function validateRecording(frames: TelemetryFrame[]) {
  for (let i = 1; i < frames.length; i++)
    if (frames[i].sequence <= frames[i - 1].sequence || frames[i].time < frames[i - 1].time)
      throw new Error('Recording sequence/time must be monotonic');
  if (frames.at(-1)!.time <= frames[0].time)
    throw new Error('Recording must have a positive duration');
  return frames;
}

const toNed = ([x, y, z]: Vec3): Vec3 => [-z, x, -y];
const fromMavlinkQuaternion = (message: Record<string, unknown>): Quat => [
  number(message.q2, 'ATTITUDE_QUATERNION.q2', -1e6, 1e6),
  number(message.q3, 'ATTITUDE_QUATERNION.q3', -1e6, 1e6),
  number(message.q4, 'ATTITUDE_QUATERNION.q4', -1e6, 1e6),
  number(message.q1, 'ATTITUDE_QUATERNION.q1', -1e6, 1e6),
];
const mavlinkTime = (message: Record<string, unknown>) => {
  const raw = message.time_usec ?? message.timestamp_us ?? message.timestamp;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0)
    throw new Error('MAVLink JSONL message requires nonnegative time_usec or timestamp_us');
  return raw / 1e6;
};

/**
 * Exchanges readable MAVLink-shaped JSONL, not binary MAVLink .tlog bytes.
 * The EV50_VISUAL_FRAME message preserves the exact visual packet; standard
 * envelopes make the log legible to robotics tooling that consumes JSONL.
 */
export function exportMavlinkJsonl(frames: TelemetryFrame[]) {
  return frames
    .flatMap((frame) => {
      const time_usec = Math.round(frame.time * 1e6);
      const position = toNed(frame.position),
        velocity = toNed(frame.velocity);
      const attitude = new Quaternion()
        .fromArray(frame.quaternion)
        .premultiply(nedToScene.clone().invert())
        .multiply(modelToFrd.clone().invert())
        .normalize();
      const [qx, qy, qz, qw] = attitude.toArray();
      return [
        { time_usec, type: 'HEARTBEAT', vehicle_type: 'VTOL', autopilot: 'EV50_VISUAL' },
        {
          time_usec,
          type: 'LOCAL_POSITION_NED',
          x: position[0],
          y: position[1],
          z: position[2],
          vx: velocity[0],
          vy: velocity[1],
          vz: velocity[2],
        },
        { time_usec, type: 'ATTITUDE_QUATERNION', q1: qw, q2: qx, q3: qy, q4: qz },
        {
          time_usec,
          type: 'ACTUATOR_OUTPUT_STATUS',
          actuator: frame.rotorRpm,
          controls: [frame.surfaces.aileron, frame.surfaces.elevator, frame.surfaces.rudder],
        },
        { time_usec, type: 'EV50_VISUAL_FRAME', frame },
      ];
    })
    .map((message) => JSON.stringify(message))
    .join('\n')
    .concat('\n');
}

/** Reads our lossless MAVLink-shaped JSONL and common position/attitude packets. */
export function parseMavlinkJsonl(text: string): TelemetryFrame[] {
  const grouped = new Map<
    number,
    {
      position?: Record<string, unknown>;
      attitude?: Record<string, unknown>;
      actuator?: Record<string, unknown>;
    }
  >();
  const exact: TelemetryFrame[] = [];
  for (const [lineNumber, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let message: Record<string, unknown>;
    try {
      message = object(JSON.parse(line));
    } catch {
      throw new Error(`Invalid MAVLink JSONL on line ${lineNumber + 1}`);
    }
    if (message.type === 'EV50_VISUAL_FRAME') {
      exact.push(normalizeFrame(message.frame));
      continue;
    }
    const time = mavlinkTime(message);
    const group = grouped.get(time) ?? {};
    if (message.type === 'LOCAL_POSITION_NED') group.position = message;
    if (message.type === 'ATTITUDE_QUATERNION') group.attitude = message;
    if (message.type === 'ACTUATOR_OUTPUT_STATUS') group.actuator = message;
    grouped.set(time, group);
  }
  if (exact.length) return exact;
  const frames: TelemetryFrame[] = [];
  for (const [time, messages] of [...grouped.entries()].sort(([a], [b]) => a - b)) {
    if (!messages.position || !messages.attitude) continue;
    const position = messages.position,
      actuator = messages.actuator ?? {},
      outputs = Array.isArray(actuator.actuator) ? actuator.actuator : [],
      controls = Array.isArray(actuator.controls) ? actuator.controls : [];
    frames.push(
      normalizeFrame({
        version: 1,
        sequence: frames.length,
        time,
        frame: 'NED',
        position: [position.x, position.y, position.z],
        velocity: [position.vx ?? 0, position.vy ?? 0, position.vz ?? 0],
        quaternion: fromMavlinkQuaternion(messages.attitude),
        rotorRpm: Array.from({ length: ROTOR_NAMES.length }, (_, i) => outputs[i] ?? 0),
        surfaces: {
          aileron: controls[0] ?? 0,
          elevator: controls[1] ?? 0,
          rudder: controls[2] ?? 0,
        },
      }),
    );
  }
  if (frames.length < 2)
    throw new Error('MAVLink JSONL requires two complete position and attitude samples');
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
