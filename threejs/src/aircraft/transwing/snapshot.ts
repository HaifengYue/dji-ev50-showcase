import type { AircraftMode, AircraftSnapshot } from '../types';
import type { ExperienceState } from './core/experience';
import { getFlight, TOTAL } from './core/flight';
import { MOTOR_IDS } from './core/motors';
import type { RuntimeSnapshot, SimulationState } from './core/simulation';

/** Timeline positions are local mechanism percent, flight/live seconds, or zero-based JSON frames.
 * External ownership locks playback; replay owns model state but permits transport controls.
 */
export function buildTranswingSnapshot(
  snapshot: RuntimeSnapshot,
  pose: SimulationState,
  experience: ExperienceState,
  mode: AircraftMode,
  localPlayback: { rate: number; loop: boolean } = { rate: 1, loop: true },
): AircraftSnapshot {
  const flight = getFlight(experience.time);
  const nonlocal = snapshot.control !== 'local';
  const external = snapshot.control === 'external';
  const replay = snapshot.control === 'replay';
  const duration = replay
    ? Math.max(0, snapshot.replayCount - 1)
    : external
      ? 0
      : mode === 'product'
        ? 100
        : TOTAL;
  const time = replay
    ? snapshot.replayIndex
    : external
      ? pose.time.seconds
      : mode === 'product'
        ? pose.wingTilt * 100
        : experience.time;
  return {
    ready: snapshot.ready,
    mode,
    playing: replay
      ? snapshot.replayPlaying
      : external
        ? !pose.time.paused
        : mode === 'product'
          ? experience.tilt.playing
          : experience.playing,
    time,
    duration,
    control: snapshot.control,
    timeUnit: replay ? 'frames' : !external && mode === 'product' ? 'percent' : 'seconds',
    playbackRate: external
      ? undefined
      : replay
        ? snapshot.replayRate
        : mode === 'product'
          ? experience.tilt.rate
          : localPlayback.rate,
    loop: nonlocal ? false : mode === 'product' ? experience.tilt.repeat : localPlayback.loop,
    timelineLabel: replay
      ? 'JSON 回放帧'
      : external
        ? 'Python 仿真时间'
        : mode === 'product'
          ? '整翼机构进度'
          : 'Transwing 飞行演示',
    state: nonlocal ? snapshot.control : mode === 'product' ? 'mechanism' : flight.phase.id,
    label: replay
      ? 'JSON 离线回放'
      : external
        ? 'Python 外部控制'
        : mode === 'product'
          ? `整翼 ${Math.round(pose.wingTilt * 120)}°`
          : flight.phase.label,
    speedMps: nonlocal || mode === 'product' ? 0 : flight.speed * 20,
    altitude: pose.positionM[1],
    lift: `${Math.round(pose.wingTilt * 100)}%`,
    cruise: `${MOTOR_IDS.filter((id) => snapshot.actuators[id].rpm > 0).length}/4`,
    externallyControlled: external,
  };
}
