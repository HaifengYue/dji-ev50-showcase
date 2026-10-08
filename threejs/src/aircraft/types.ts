import type * as T from 'three';

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
export type AircraftHost = {
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
  describe(): unknown;
  dispose(): void;
}
