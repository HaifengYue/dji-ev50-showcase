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
  seek(seconds: number): void;
  setSpeed(speed: number): void;
  setLoop(loop: boolean): void;
  setView(view: string): void;
  snapshot(): AircraftSnapshot;
  describe(): unknown;
  dispose(): void;
}
