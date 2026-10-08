import type { AircraftSnapshot } from './types';

/** Shared HUD never conflates frame index, shape percentage, and simulation time. */
export function playbackPresentation(state: AircraftSnapshot) {
  const control = state.control ?? (state.externallyControlled ? 'external' : 'local');
  const external = control === 'external';
  const replay = control === 'replay';
  const timeUnit = state.timeUnit ?? 'seconds';
  const rateOptions = replay
    ? [0.1, 1]
    : state.mode === 'product'
      ? [0.25, 0.5, 1, 1.5, 2]
      : [0.25, 0.5, 1, 1.5, 2, 4];
  const timeLabel =
    timeUnit === 'frames'
      ? `${Math.round(state.time) + 1} / ${Math.round(state.duration) + 1} 帧`
      : timeUnit === 'percent'
        ? `${state.time.toFixed(1)}% 展开`
        : external
          ? `${state.time.toFixed(2)} s · Python 时钟`
          : `${state.time.toFixed(1)} / ${state.duration.toFixed(1)} s`;
  return {
    timeLabel,
    timelineLabel:
      state.timelineLabel ?? (state.mode === 'product' ? '整翼展开进度' : 'Transwing 飞行演示'),
    step: timeUnit === 'frames' ? '1' : timeUnit === 'percent' ? '0.1' : '0.01',
    rateOptions,
    rate: state.playbackRate ?? 1,
    loop: !!state.loop && control === 'local',
    disableMode: control !== 'local',
    disablePlay: external,
    disableSeek: external,
    disableRestart: external,
    disableSpeed: external,
    disableLoop: control !== 'local',
  };
}
