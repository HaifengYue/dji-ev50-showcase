import type * as T from 'three';
import type { Frame, routes } from '../flight';
import type {
  ControlLease,
  AircraftControlCommand,
  AdapterAircraftState,
} from '../control/contracts';

export type AircraftId = 'ev50' | 'transwing';
export type AircraftMode = 'product' | 'flight';
export type AircraftQuality = 'Low' | 'Medium' | 'High';
export type AircraftSnapshot = {
  ready: boolean;
  mode: AircraftMode;
  playing: boolean;
  time: number;
  duration: number;
  state: string;
  label: string;
  speedMps: number;
  altitude: number;
  lift: string;
  cruise: string;
  /** Replay owns model state while still allowing play/pause, restart and frame seeking. */
  control?: 'local' | 'external' | 'replay';
  /** Frame timelines use zero-based indices for both time and duration. */
  timeUnit?: 'seconds' | 'frames' | 'percent';
  /** Actual transport rate, omitted for a live externally owned clock. */
  playbackRate?: number;
  loop?: boolean;
  timelineLabel?: string;
  /** True only when a live external owner locks transport controls. */
  externallyControlled?: boolean;
};
/** World pose in metres: +X east/right, +Y up, +Z south/body forward.
 * Adapters retain asset-local pivots; this datum never receives mechanism transforms. */
export type AircraftWorldState = {
  position: T.Vector3;
  quaternion: T.Quaternion;
  speedMps: number;
  time: number;
  mode: AircraftMode;
  routeProgress: number;
  path: T.Vector3[];
  route: keyof typeof routes;
  source: 'demo' | 'external' | 'replay';
};
export type AircraftHost = {
  flightFrames: Frame[];
  setSceneMode: (mode: AircraftMode) => void;
  clearTrail: () => void;
  scene: T.Scene;
  renderer: T.WebGLRenderer;
  canvas: HTMLCanvasElement;
  panel: HTMLElement;
  assetUrl: (path: string) => string;
  setCamera: (camera: T.Camera) => void;
  report: (message: string) => void;
};
export interface AircraftInstance {
  readonly id: AircraftId;
  update(dt: number, now: number): void;
  resize(): void;
  setQuality(quality: AircraftQuality): void;
  setMode(mode: AircraftMode): void;
  playPause(): void;
  restart(): void;
  /** Position uses the snapshot timeUnit (seconds by default). */
  seek(position: number): void;
  setSpeed(speed: number): void;
  setLoop(loop: boolean): void;
  setView(view: string): void;
  snapshot(): AircraftSnapshot;
  worldState?(): AircraftWorldState;
  setControlLease?(lease: ControlLease | null, reason?: string): void;
  applyControl?(command: AircraftControlCommand): void;
  normalizedState?(): AdapterAircraftState;
  controlBlockedReason?(): string | undefined;
  setRoute?(route: keyof typeof routes): void;
  describe(): unknown;
  dispose(): void;
}
