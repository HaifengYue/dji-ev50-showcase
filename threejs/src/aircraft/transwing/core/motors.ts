/** 折桨仅为受控可视化互锁，不是实测离心动力学或飞控模型。 */
export const MOTOR_IDS = ['L_Front', 'R_Front', 'L_Rear', 'R_Rear'] as const;
export type MotorId = (typeof MOTOR_IDS)[number];
export type MotorCommand = { targetRpm: number; enabled: boolean };
export type MotorCommands = Record<MotorId, MotorCommand>;
export type MotorStage =
  'folded' | 'unfolding' | 'accelerating' | 'running' | 'decelerating' | 'indexing' | 'folding';
export type MotorState = {
  rpm: number;
  phase: number;
  fold: number;
  stage: MotorStage;
  requested: boolean;
};
export type MotorStates = Record<MotorId, MotorState>;
export const MOTOR_LIMITS = {
  maxRpm: 12000,
  startRpm: 60,
  stopRpm: 20,
  acceleration: 2400,
  deceleration: 3600,
  unfoldSeconds: 0.65,
  foldSeconds: 0.8,
  indexSpeed: Math.PI,
} as const;
const TAU = Math.PI * 2;
const EPS = 1e-10;
export const newMotorState = (): MotorState => ({
  rpm: 0,
  phase: 0,
  fold: 1,
  stage: 'folded',
  requested: false,
});
export const newMotorStates = (): MotorStates =>
  Object.fromEntries(MOTOR_IDS.map((id) => [id, newMotorState()])) as MotorStates;
export const newMotorCommands = (): MotorCommands =>
  Object.fromEntries(
    MOTOR_IDS.map((id) => [id, { targetRpm: 0, enabled: false }]),
  ) as MotorCommands;
const phaseAfter = (phase: number, revolutions: number) =>
  (((phase + revolutions * TAU) % TAU) + TAU) % TAU;

/** 解析分段积分：大时间步与小步结果相同，每次最多跨越六个有限状态。 */
export function stepMotor(previous: MotorState, command: MotorCommand, dt: number): MotorState {
  if (
    !Number.isFinite(dt) ||
    dt < 0 ||
    dt > 60 ||
    !Number.isFinite(command.targetRpm) ||
    command.targetRpm < 0 ||
    command.targetRpm > MOTOR_LIMITS.maxRpm ||
    typeof command.enabled !== 'boolean'
  )
    throw new Error('电机命令或时间步无效');
  const state = { ...previous };
  if (!dt) return state;
  state.requested =
    command.enabled &&
    (state.requested
      ? command.targetRpm > MOTOR_LIMITS.stopRpm
      : command.targetRpm >= MOTOR_LIMITS.startRpm);
  let remaining = dt;
  for (let transition = 0; remaining > EPS && transition < 12; transition++) {
    if (state.requested) {
      if (state.fold > EPS) {
        state.stage = 'unfolding';
        state.rpm = 0;
        state.phase = 0;
        const used = Math.min(remaining, state.fold * MOTOR_LIMITS.unfoldSeconds);
        state.fold = Math.max(0, state.fold - used / MOTOR_LIMITS.unfoldSeconds);
        remaining -= used;
        continue;
      }
      state.fold = 0;
      const difference = command.targetRpm - state.rpm;
      if (Math.abs(difference) <= EPS) {
        state.stage = 'running';
        state.phase = phaseAfter(state.phase, (state.rpm * remaining) / 60);
        remaining = 0;
      } else {
        state.stage = difference > 0 ? 'accelerating' : 'decelerating';
        const rate = difference > 0 ? MOTOR_LIMITS.acceleration : -MOTOR_LIMITS.deceleration;
        const used = Math.min(remaining, Math.abs(difference / rate));
        const nextRpm = state.rpm + rate * used;
        state.phase = phaseAfter(state.phase, ((state.rpm + nextRpm) * used) / 120);
        state.rpm = Math.max(0, nextRpm);
        remaining -= used;
      }
    } else if (state.rpm > EPS) {
      state.stage = 'decelerating';
      state.fold = 0;
      const used = Math.min(remaining, state.rpm / MOTOR_LIMITS.deceleration);
      const nextRpm = Math.max(0, state.rpm - MOTOR_LIMITS.deceleration * used);
      state.phase = phaseAfter(state.phase, ((state.rpm + nextRpm) * used) / 120);
      state.rpm = nextRpm;
      remaining -= used;
    } else if (state.phase > EPS && TAU - state.phase > EPS) {
      state.stage = 'indexing';
      state.rpm = 0;
      state.fold = 0;
      const required = (TAU - state.phase) / MOTOR_LIMITS.indexSpeed;
      const used = Math.min(remaining, required);
      state.phase = used >= required - EPS ? 0 : state.phase + used * MOTOR_LIMITS.indexSpeed;
      remaining -= used;
    } else if (state.fold < 1 - EPS) {
      state.stage = 'folding';
      state.rpm = 0;
      state.phase = 0;
      const used = Math.min(remaining, (1 - state.fold) * MOTOR_LIMITS.foldSeconds);
      state.fold = Math.min(1, state.fold + used / MOTOR_LIMITS.foldSeconds);
      remaining -= used;
    } else {
      Object.assign(state, newMotorState());
      remaining = 0;
    }
  }
  if (state.fold < EPS) state.fold = 0;
  if (state.rpm < EPS) state.rpm = 0;
  if (state.fold >= 1 - EPS) {
    state.fold = 1;
    if (!state.requested) state.stage = 'folded';
  }
  if (state.requested && state.fold === 0 && Math.abs(state.rpm - command.targetRpm) < EPS)
    state.stage = 'running';
  return state;
}
export function stepMotors(states: MotorStates, commands: MotorCommands, dt: number): MotorStates {
  return Object.fromEntries(
    MOTOR_IDS.map((id) => [id, stepMotor(states[id], commands[id], dt)]),
  ) as MotorStates;
}
