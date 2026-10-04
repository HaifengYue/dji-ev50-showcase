/** 独立整翼演示：八秒单程，两端零速度，手动拖动与反向均保留当前姿态。 */
export const TILT_DURATION = 8;
export type TiltState = {
  progress: number;
  direction: 1 | -1;
  playing: boolean;
  repeat: boolean;
  rate: number;
};
export const INITIAL_TILT: TiltState = {
  progress: 0,
  direction: 1,
  playing: false,
  repeat: false,
  rate: 1,
};
export type TiltAction =
  | { type: "begin"; direction: 1 | -1 }
  | { type: "pause" }
  | { type: "scrub"; progress: number }
  | { type: "repeat"; enabled: boolean }
  | { type: "rate"; value: number }
  | { type: "reset" }
  | { type: "tick"; seconds: number };
export const easeTilt = (phase: number) => phase * phase * (3 - 2 * phase);
export const tiltPhase = (progress: number) =>
  0.5 - Math.sin(Math.asin(1 - 2 * progress) / 3);
export function tiltReducer(state: TiltState, action: TiltAction): TiltState {
  switch (action.type) {
    case "begin":
      return {
        ...state,
        direction: action.direction,
        playing:
          action.direction === 1 ? state.progress < 1 : state.progress > 0,
      };
    case "pause":
      return { ...state, playing: false };
    case "scrub":
      if (!Number.isFinite(action.progress)) return state;
      return {
        ...state,
        progress: Math.max(0, Math.min(1, action.progress)),
        playing: false,
      };
    case "repeat":
      return { ...state, repeat: action.enabled };
    case "rate":
      return Number.isFinite(action.value) && action.value > 0
        ? { ...state, rate: Math.max(0.25, Math.min(2, action.value)) }
        : state;
    case "reset":
      return { ...INITIAL_TILT, repeat: state.repeat, rate: state.rate };
    case "tick": {
      if (
        !state.playing ||
        !Number.isFinite(action.seconds) ||
        action.seconds <= 0
      )
        return state;
      const distance = (action.seconds * state.rate) / TILT_DURATION;
      const phase = tiltPhase(state.progress);
      if (!state.repeat) {
        const next = Math.max(
          0,
          Math.min(1, phase + state.direction * distance),
        );
        return {
          ...state,
          progress: easeTilt(next),
          playing: next > 0 && next < 1,
        };
      }
      // 平滑三角波保留越界余量；任意步长、暂停和反向都不会跳变。
      const cycle =
        ((state.direction === 1 ? phase : 2 - phase) + distance) % 2;
      return {
        ...state,
        progress: easeTilt(cycle <= 1 ? cycle : 2 - cycle),
        direction: cycle < 1 ? 1 : -1,
      };
    }
  }
}
