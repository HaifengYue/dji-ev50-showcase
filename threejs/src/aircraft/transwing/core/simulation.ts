import {
  MOTOR_IDS,
  newMotorCommands,
  newMotorStates,
  stepMotors,
  type MotorCommands,
  type MotorStates,
  type MotorId,
} from './motors';
import { SURFACE_IDS, resolveSurfacePatch, type SurfacePatch } from './surfaces';
export { SURFACE_IDS } from './surfaces';
export const PROTOCOL = 'transwing.sim.v1' as const;
export type SimulationState = {
  owner: 'ui' | 'external';
  positionM: [number, number, number];
  attitude: [number, number, number, number];
  motors: MotorCommands;
  wingTilt: number;
  surfaces: Record<(typeof SURFACE_IDS)[number], number>;
  hatchDeg: number;
  display: {
    wireframe: boolean;
    exploded: boolean;
    environment: 'hangar' | 'sky';
  };
  time: { seconds: number; mode: 'deterministic'; paused: boolean };
};
export type StatePatch = Omit<
  Partial<SimulationState>,
  'owner' | 'motors' | 'surfaces' | 'display' | 'time'
> & {
  motors?: Partial<
    Record<(typeof MOTOR_IDS)[number], Partial<MotorCommands[(typeof MOTOR_IDS)[number]]>>
  >;
  surfaces?: SurfacePatch;
  display?: Partial<SimulationState['display']>;
  time?: Partial<SimulationState['time']>;
};
export type SimulationOperation =
  'set' | 'step' | 'seek' | 'reset' | 'snapshot' | 'interrupt' | 'pause';
export type StateEnvelope = {
  protocol: typeof PROTOCOL;
  revision: number;
  state: SimulationState;
  op: SimulationOperation;
  dt?: number;
  sessionId?: string;
  seq?: number;
  resync?: boolean;
  reason?: string;
};
export type RuntimeSnapshot = {
  state: SimulationState;
  actuators: MotorStates;
  ready: boolean;
  revision: number;
  control: 'local' | 'external' | 'replay';
  driver: 'demo' | 'manual';
  connection: 'offline' | 'connecting' | 'connected' | 'error';
  error: string | null;
  disposed: boolean;
  replayIndex: number;
  replayCount: number;
  replayPlaying: boolean;
  replayRate: 0.1 | 1;
  rotorShutter: boolean;
};
export type RuntimeEvent = {
  type: 'ready' | 'accepted' | 'applied' | 'state' | 'dispose';
  revision: number;
};
export const defaultSimulationState = (): SimulationState => ({
  owner: 'ui',
  positionM: [0, 0, 0],
  attitude: [0, 0, 0, 1],
  motors: newMotorCommands(),
  wingTilt: 0,
  surfaces: Object.fromEntries(SURFACE_IDS.map((id) => [id, 0])) as SimulationState['surfaces'],
  hatchDeg: 0,
  display: { wireframe: false, exploded: false, environment: 'hangar' },
  time: { seconds: 0, mode: 'deterministic', paused: true },
});
const copy = <T>(value: T): T => structuredClone(value);
function record(value: unknown, label: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new Error(`${label} 必须为普通对象`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error(`${label} 含未知字段`);
}
function number(value: unknown, min: number, max: number, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${label} 超出有效范围`);
}
function boolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} 必须为布尔值`);
}
function vector(value: unknown, size: number, label: string) {
  if (!Array.isArray(value) || value.length !== size) throw new Error(`${label} 长度错误`);
  value.forEach((n) => number(n, -100000, 100000, label));
}
/** 先建立完整候选，再验证所有交叉约束，失败不改变任何一个字段。 */
export function applyStatePatch(current: SimulationState, input: unknown): SimulationState {
  const patch = record(input, '状态补丁');
  keys(
    patch,
    ['positionM', 'attitude', 'motors', 'wingTilt', 'surfaces', 'hatchDeg', 'display', 'time'],
    '状态补丁',
  );
  const next = copy(current);
  for (const field of ['positionM', 'attitude', 'wingTilt', 'hatchDeg'] as const)
    if (field in patch) (next as unknown as Record<string, unknown>)[field] = copy(patch[field]);
  if ('surfaces' in patch) Object.assign(next.surfaces, resolveSurfacePatch(patch.surfaces));
  for (const field of ['display', 'time'] as const)
    if (field in patch) {
      const section = record(patch[field], field);
      keys(section, Object.keys(next[field]), field);
      Object.assign(next[field], section);
    }
  if ('motors' in patch) {
    const motors = record(patch.motors, '电机');
    keys(motors, MOTOR_IDS, '电机');
    for (const id of MOTOR_IDS)
      if (id in motors) {
        const motor = record(motors[id], id);
        keys(motor, ['targetRpm', 'enabled'], id);
        Object.assign(next.motors[id], motor);
      }
  }
  vector(next.positionM, 3, '位置');
  vector(next.attitude, 4, '姿态');
  const norm = Math.hypot(...next.attitude);
  if (Math.abs(norm - 1) > 1e-3) throw new Error('姿态必须为单位四元数，顺序为 x,y,z,w');
  next.attitude = next.attitude.map((value) => value / norm) as SimulationState['attitude'];
  number(next.wingTilt, 0, 1, '整翼倾转');
  number(next.hatchDeg, 0, 55, '舱盖');
  for (const id of SURFACE_IDS) number(next.surfaces[id], -12, 12, id);
  for (const id of MOTOR_IDS) {
    number(next.motors[id].targetRpm, 0, 12000, id);
    boolean(next.motors[id].enabled, id);
  }
  boolean(next.display.wireframe, '线框');
  boolean(next.display.exploded, '拆解');
  if (!['hangar', 'sky'].includes(next.display.environment)) throw new Error('场景枚举无效');
  if (
    next.display.exploded &&
    MOTOR_IDS.some((id) => next.motors[id].enabled || next.motors[id].targetRpm !== 0)
  )
    throw new Error('拆解模式需原子停用全部四台电机');
  number(next.time.seconds, 0, 86400, '时间');
  boolean(next.time.paused, '暂停');
  if (next.time.mode !== 'deterministic') throw new Error('外部时间必须由确定性步进驱动');
  return next;
}
export function validateState(input: unknown): SimulationState {
  const candidate = record(input, '完整状态');
  keys(candidate, Object.keys(defaultSimulationState()), '完整状态');
  if (Object.keys(defaultSimulationState()).some((key) => !(key in candidate)))
    throw new Error('完整状态缺少字段');
  const { owner, ...patch } = candidate;
  if (owner !== 'ui' && owner !== 'external') throw new Error('控制权枚举无效');
  for (const [section, expected] of [
    ['motors', MOTOR_IDS],
    ['surfaces', SURFACE_IDS],
    ['display', ['wireframe', 'exploded', 'environment']],
    ['time', ['seconds', 'mode', 'paused']],
  ] as const) {
    const value = record(patch[section], section);
    // 完整快照只允许既有规范 ID；别名仅用于命令补丁。
    keys(value, expected, section);
    if (expected.some((key) => !(key in value))) throw new Error(`${section} 完整状态缺少字段`);
  }
  for (const id of MOTOR_IDS) {
    const value = record(record(patch.motors, '电机')[id], id);
    if (!('enabled' in value) || !('targetRpm' in value)) throw new Error('完整电机状态缺少字段');
  }
  const next = applyStatePatch(defaultSimulationState(), patch);
  next.owner = owner;
  return next;
}
export function validateEnvelope(input: unknown): StateEnvelope {
  const e = record(input, '消息');
  keys(
    e,
    ['protocol', 'revision', 'state', 'op', 'dt', 'sessionId', 'seq', 'resync', 'reason'],
    '消息',
  );
  if (e.protocol !== PROTOCOL) throw new Error('协议版本不匹配');
  number(e.revision, 0, Number.MAX_SAFE_INTEGER, '版本序号');
  if (!Number.isSafeInteger(e.revision)) throw new Error('版本序号必须为安全整数');
  if (!['set', 'step', 'seek', 'reset', 'snapshot', 'interrupt', 'pause'].includes(e.op as string))
    throw new Error('操作枚举无效');
  if (e.op === 'step') number(e.dt, 0, 60, '时间步');
  if (e.seq !== undefined) {
    number(e.seq, 1, Number.MAX_SAFE_INTEGER, '命令序号');
    if (!Number.isSafeInteger(e.seq)) throw new Error('命令序号无效');
  }
  if (
    e.sessionId !== undefined &&
    (typeof e.sessionId !== 'string' || e.sessionId.length > 128 || !e.sessionId)
  )
    throw new Error('会话编号无效');
  if (e.resync !== undefined) boolean(e.resync, '重新同步');
  if (e.reason !== undefined && (typeof e.reason !== 'string' || e.reason.length > 256))
    throw new Error('控制释放原因无效');
  return { ...e, state: validateState(e.state) } as StateEnvelope;
}
type MotorStep = { before: MotorStates; commands: MotorCommands; dt: number };
export type MotorExposure = { samples: MotorStates[]; activeIds: MotorId[] };
export type RenderSample = {
  state: SimulationState;
  actuators: MotorStates;
  exposure: MotorExposure | null;
};
/** 有限 1/60 秒曝光，只采样已接收/已知的确定性轨迹，不向未来推算。 */
export function sampleMotorExposure(
  step: MotorStep,
  end: MotorStates,
  playbackRate = 1,
): MotorExposure | null {
  const activeIds = MOTOR_IDS.filter(
    (id) => end[id].rpm * playbackRate >= 600 && end[id].fold === 0,
  );
  if (!activeIds.length || step.dt <= 0) return null;
  // 双叶桨超过半圈后曝光覆盖重复：缩短取样窗，避免残影自身再发生整圈采样混叠。
  const maxRpm = Math.max(...activeIds.map((id) => end[id].rpm));
  const duration = Math.min(step.dt, playbackRate / 60, 30 / maxRpm);
  const samples = Array.from({ length: 16 }, (_, i) =>
    stepMotors(step.before, step.commands, Math.max(0, step.dt - (duration * (15 - i)) / 15)),
  );
  return { samples, activeIds };
}

export class SimulationRuntime {
  private snapshot: RuntimeSnapshot = {
    state: defaultSimulationState(),
    actuators: newMotorStates(),
    ready: false,
    revision: -1,
    control: 'local',
    driver: 'demo',
    connection: 'offline',
    error: null,
    disposed: false,
    replayIndex: 0,
    replayCount: 0,
    replayPlaying: false,
    replayRate: 1,
    rotorShutter: true,
  };
  private listeners = new Set<() => void>();
  private events = new Set<(event: RuntimeEvent) => void>();
  private lastApplied = -1;
  private sequences = new Map<string, number>();
  private replayFrames: ReturnType<typeof parseRecording>['frames'] = [];
  private replayElapsed = 0;
  private motorStep: MotorStep | null = null;
  private exposureRemaining = 0;
  /** 仅快门显示寿命；绝不积分或修改外部仿真时间/电机状态。 */
  advancePresentation(dt: number) {
    number(dt, 0, 60, '呈现时间步');
    this.exposureRemaining = Math.max(0, this.exposureRemaining - dt);
  }
  setRotorShutter(enabled: boolean) {
    boolean(enabled, '快门扫掠');
    this.publish({ rotorShutter: enabled });
  }
  setReplayRate(rate: 0.1 | 1) {
    if (rate !== 0.1 && rate !== 1) throw new Error('回放速度只支持 1× / 0.1×');
    this.publish({ replayRate: rate });
  }
  private captureMotorStep(before: MotorStates, commands: MotorCommands, dt: number) {
    this.motorStep = dt > 0 ? { before, commands, dt } : null;
    this.exposureRemaining = dt > 0 ? Math.min(1, Math.max(0.15, dt * 2)) : 0;
  }
  private clearMotorExposure() {
    this.motorStep = null;
    this.exposureRemaining = 0;
  }
  /** JSON 已知区间内解析采样；实时主模型始终取已应用的真实端点。 */
  getRenderSample(): RenderSample {
    const snapshot = this.snapshot;
    let state = snapshot.state,
      actuators = snapshot.actuators;
    let step = this.motorStep;
    let active = this.exposureRemaining > 0;
    let rate = 1;
    if (snapshot.control === 'replay') {
      const frame = this.replayFrames[snapshot.replayIndex];
      const next = this.replayFrames[snapshot.replayIndex + 1];
      // next.dt>0 时，其起点就是当前命令帧；没有跨 set/reset/seek 插值。
      if (frame && next && next.dt > 0 && this.replayElapsed > 0) {
        const dt = Math.min(next.dt, this.replayElapsed);
        actuators = stepMotors(frame.actuators, next.state.motors, dt);
        state = {
          ...frame.state,
          time: { ...frame.state.time, seconds: frame.state.time.seconds + dt },
        };
        step = { before: frame.actuators, commands: next.state.motors, dt };
      } else step = this.motorStep;
      active = snapshot.replayPlaying;
      rate = snapshot.replayRate;
    }
    return {
      state,
      actuators,
      exposure:
        !snapshot.disposed && snapshot.rotorShutter && active && step
          ? sampleMotorExposure(step, actuators, rate)
          : null,
    };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  onEvent = (listener: (event: RuntimeEvent) => void) => {
    this.events.add(listener);
    return () => this.events.delete(listener);
  };
  private assertLive() {
    if (this.snapshot.disposed) throw new Error('查看器运行时已释放');
  }
  private emit(type: RuntimeEvent['type']) {
    for (const listener of this.events) listener({ type, revision: this.snapshot.revision });
  }
  private publish(patch: Partial<RuntimeSnapshot>) {
    this.assertLive();
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
    this.emit('state');
  }
  setReady(ready: boolean) {
    this.publish({ ready });
    this.emit('ready');
  }
  markApplied(revision: number) {
    if (!this.snapshot.ready || revision !== this.snapshot.revision || revision <= this.lastApplied)
      return false;
    this.lastApplied = revision;
    this.emit('applied');
    return true;
  }
  setConnection(connection: RuntimeSnapshot['connection'], error: string | null = null) {
    if (connection !== 'connected') this.clearMotorExposure();
    this.publish({ connection, error });
  }
  connect() {
    this.clearMotorExposure();
    this.publish({
      control: 'external',
      driver: 'demo',
      state: defaultSimulationState(),
      actuators: newMotorStates(),
      revision: -1,
      connection: 'connecting',
      error: null,
    });
    this.lastApplied = -1;
    this.sequences.clear();
  }
  accept(input: unknown) {
    this.assertLive();
    if (this.snapshot.control !== 'external') throw new Error('未启用外部控制');
    const envelope = validateEnvelope(input);
    if (envelope.revision <= this.snapshot.revision) return false;
    if (
      envelope.sessionId &&
      envelope.seq !== undefined &&
      !['snapshot', 'interrupt'].includes(envelope.op)
    ) {
      const last = this.sequences.get(envelope.sessionId) ?? -1;
      if (envelope.seq <= last) throw new Error('会话命令序号过期');
    }
    const resetting =
      ['seek', 'reset', 'snapshot', 'interrupt'].includes(envelope.op) ||
      !!envelope.resync ||
      envelope.state.display.exploded;
    const actuators = resetting
      ? newMotorStates()
      : envelope.op === 'step'
        ? stepMotors(this.snapshot.actuators, envelope.state.motors, envelope.dt!)
        : this.snapshot.actuators;
    if (
      resetting ||
      envelope.op === 'pause' ||
      (envelope.state.time.paused && !this.snapshot.state.time.paused)
    )
      this.clearMotorExposure();
    else if (envelope.op === 'step')
      this.captureMotorStep(this.snapshot.actuators, envelope.state.motors, envelope.dt!);
    if (envelope.sessionId && envelope.seq !== undefined)
      this.sequences.set(envelope.sessionId, envelope.seq);
    this.publish({
      state: envelope.state,
      actuators,
      revision: envelope.revision,
      connection: 'connected',
      error: envelope.resync ? '连接历史已过期，已安全复位桨系' : null,
    });
    this.emit('accepted');
    return true;
  }
  setLocal(patch: StatePatch, driver = this.snapshot.driver) {
    if (this.snapshot.control !== 'local') return false;
    const state = applyStatePatch(this.snapshot.state, patch);
    if (state.display.exploded || (state.time.paused && !this.snapshot.state.time.paused))
      this.clearMotorExposure();
    this.publish({
      state,
      driver,
      actuators: state.display.exploded ? newMotorStates() : this.snapshot.actuators,
    });
    return true;
  }
  stepLocal(dt: number) {
    if (this.snapshot.control !== 'local') return false;
    number(dt, 0, 60, '本地时间步');
    const state = applyStatePatch(this.snapshot.state, {
      time: { seconds: (this.snapshot.state.time.seconds + dt) % 86400 },
    });
    this.captureMotorStep(this.snapshot.actuators, state.motors, dt);
    this.publish({
      state,
      actuators: stepMotors(this.snapshot.actuators, state.motors, dt),
    });
    return true;
  }
  resetLocal() {
    this.clearMotorExposure();
    this.publish({
      state: defaultSimulationState(),
      actuators: newMotorStates(),
      revision: -1,
      control: 'local',
      driver: 'demo',
      connection: 'offline',
      error: null,
      replayIndex: 0,
      replayCount: 0,
      replayPlaying: false,
    });
    this.replayFrames = [];
    this.replayElapsed = 0;
    this.lastApplied = -1;
    this.sequences.clear();
  }
  seekLocal(seconds: number) {
    if (this.snapshot.control !== 'local') return;
    const state = applyStatePatch(this.snapshot.state, { time: { seconds } });
    this.clearMotorExposure();
    this.publish({ state, actuators: newMotorStates() });
  }
  replay(text: string) {
    const result = parseRecording(text);
    this.clearMotorExposure();
    this.replayFrames = result.frames;
    this.replayElapsed = 0;
    this.publish({
      state: result.frames[0].state,
      actuators: result.frames[0].actuators,
      control: 'replay',
      revision: 0,
      connection: 'offline',
      error: null,
      replayIndex: 0,
      replayCount: result.frames.length,
      replayPlaying: false,
    });
  }
  replayAt(index: number) {
    if (
      this.snapshot.control !== 'replay' ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= this.replayFrames.length
    )
      return;
    const frame = this.replayFrames[index];
    this.replayElapsed = 0;
    this.clearMotorExposure();
    this.publish({
      state: frame.state,
      actuators: frame.actuators,
      replayIndex: index,
      revision: index,
      replayPlaying: false,
    });
  }
  playReplay(playing: boolean) {
    if (this.snapshot.control !== 'replay') return;
    if (this.replayFrames.length < 2) {
      this.publish({ replayPlaying: false });
      return;
    }
    if (playing && this.snapshot.replayIndex === this.replayFrames.length - 1) this.replayAt(0);
    this.publish({ replayPlaying: playing });
  }
  advanceReplay(dt: number) {
    if (this.snapshot.control !== 'replay' || !this.snapshot.replayPlaying) return;
    number(dt, 0, 60, '记录时间步');
    this.replayElapsed += dt * this.snapshot.replayRate;
    let index = this.snapshot.replayIndex;
    while (
      index < this.replayFrames.length - 1 &&
      this.replayElapsed + 1e-9 >= this.replayFrames[index + 1].dt
    ) {
      const next = this.replayFrames[index + 1];
      this.replayElapsed -= next.dt;
      if (next.dt > 0)
        this.captureMotorStep(this.replayFrames[index].actuators, next.state.motors, next.dt);
      index++;
    }
    this.replayElapsed = Math.max(0, this.replayElapsed);
    if (index !== this.snapshot.replayIndex) {
      const frame = this.replayFrames[index];
      this.publish({
        state: frame.state,
        actuators: frame.actuators,
        replayIndex: index,
        revision: index,
        replayPlaying: index < this.replayFrames.length - 1,
      });
    }
  }
  dispose() {
    if (this.snapshot.disposed) return;
    this.clearMotorExposure();
    this.emit('dispose');
    this.snapshot = {
      ...this.snapshot,
      disposed: true,
      ready: false,
      replayPlaying: false,
    };
    this.listeners.clear();
    this.events.clear();
  }
}
/** 纯数据记录不执行脚本；全文件通过验证后才替换当前画面。 */
export function parseRecording(text: string) {
  if (new TextEncoder().encode(text).length > 1024 * 1024) throw new Error('记录最大为 1 MiB');
  const root = record(JSON.parse(text), '记录');
  keys(root, ['protocol', 'commands'], '记录');
  if (root.protocol !== PROTOCOL || !Array.isArray(root.commands) || root.commands.length > 10000)
    throw new Error('记录协议或条数无效，最多 10000 条');
  let state = defaultSimulationState(),
    actuators = newMotorStates();
  const frames = [{ state: copy(state), actuators: copy(actuators), dt: 0 }];
  for (const raw of root.commands) {
    const command = record(raw, '记录命令');
    keys(command, ['op', 'payload'], '记录命令');
    if (!('op' in command) || !('payload' in command)) throw new Error('记录命令缺少操作或参数');
    const payload = record(command.payload, '命令参数');
    if (command.op === 'set') {
      if (payload.time && 'seconds' in record(payload.time, '时间补丁'))
        throw new Error('时间秒数请使用 seek 或 step');
      state = applyStatePatch(state, payload);
    } else if (command.op === 'step') {
      keys(payload, ['dt'], '步进');
      number(payload.dt, 0, 60, '步进');
      state = applyStatePatch(state, {
        time: { seconds: state.time.seconds + payload.dt },
      });
      actuators = stepMotors(actuators, state.motors, payload.dt);
    } else if (command.op === 'seek') {
      keys(payload, ['seconds', 'state'], '跳转');
      number(payload.seconds, 0, 86400, '时间');
      state = applyStatePatch(state, payload.state ?? {});
      state = applyStatePatch(state, {
        time: { seconds: payload.seconds, paused: true },
      });
      actuators = newMotorStates();
    } else if (command.op === 'pause') {
      keys(payload, ['paused'], '暂停');
      state = applyStatePatch(state, {
        time: {
          paused: payload.paused === undefined ? true : (payload.paused as boolean),
        },
      });
    } else if (command.op === 'reset') {
      keys(payload, [], '复位');
      state = defaultSimulationState();
      actuators = newMotorStates();
    } else throw new Error('记录操作无效');
    if (state.display.exploded) actuators = newMotorStates();
    frames.push({
      state: copy(state),
      actuators: copy(actuators),
      dt: command.op === 'step' ? (payload.dt as number) : 0,
    });
  }
  return { state, actuators, count: root.commands.length, frames };
}
