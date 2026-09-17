/**
 * Versioned public contract for EV50 integrations.
 *
 * This project is a static site, so operations are dispatched in the browser
 * with `window.ev50API.request()`.  The operation names deliberately mirror
 * REST resource paths, which keeps a future HTTP/WebSocket adapter compatible
 * without changing consumer code.
 */
export const API_VERSION = '3.3.0';

export type CameraMode = 'free' | 'ground' | 'follow' | 'side' | 'wide' | 'fpv' | 'down';
export type RenderQuality = 'Low' | 'Medium' | 'High';
export type FlightControlCommand =
  | { type: 'motor'; lift: number; cruise: number }
  | { type: 'position'; position: number[] }
  | { type: 'velocity'; velocity: number[] }
  | { type: 'attitude'; quaternion: number[] };

export type ApiOperation =
  | 'system.health'
  | 'system.capabilities'
  | 'flight.state'
  | 'flight.command'
  | 'flight.play'
  | 'flight.pause'
  | 'flight.resume'
  | 'flight.reset'
  | 'flight.seek'
  | 'flight.speed'
  | 'mission.list'
  | 'mission.select'
  | 'settings.get'
  | 'settings.update'
  | 'simulation.state'
  | 'simulation.frame'
  | 'simulation.source'
  | 'simulation.connect'
  | 'simulation.disconnect'
  | 'simulation.replay.load'
  | 'simulation.replay.sample'
  | 'simulation.replay.seek'
  | 'simulation.pause'
  | 'simulation.resume'
  | 'simulation.record.start'
  | 'simulation.record.stop'
  | 'simulation.record.export'
  | 'aircraft.describe'
  | 'camera.describe'
  | 'scene.describe'
  | 'scene.configure'
  | 'scene.query';

export type ApiRequest = { id?: string; operation: ApiOperation | string; payload?: unknown };
export type ApiFailure = {
  id?: string;
  operation: string;
  ok: false;
  error: { code: string; message: string };
};
export type ApiSuccess<T = unknown> = { id?: string; operation: string; ok: true; data: T };
export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiFailure;

export type ApiSettings = {
  loop: boolean;
  playbackSpeed: number;
  camera: CameraMode;
  quality: RenderQuality;
  annotations: boolean;
};

export const endpointManifest = [
  {
    operation: 'system.health',
    path: '/api/v1/health',
    method: 'GET',
    description: '运行状态与 API 版本',
  },
  {
    operation: 'system.capabilities',
    path: '/api/v1/capabilities',
    method: 'GET',
    description: '已实现与预留能力',
  },
  {
    operation: 'flight.state',
    path: '/api/v1/flight/state',
    method: 'GET',
    description: '飞行状态快照',
  },
  {
    operation: 'flight.command',
    path: '/api/v1/flight/commands',
    method: 'POST',
    description: '位置、速度、姿态或电机指令',
  },
  {
    operation: 'flight.play',
    path: '/api/v1/flight/play',
    method: 'POST',
    description: '恢复预设航线',
  },
  {
    operation: 'flight.pause',
    path: '/api/v1/flight/pause',
    method: 'POST',
    description: '暂停当前模式',
  },
  {
    operation: 'flight.resume',
    path: '/api/v1/flight/resume',
    method: 'POST',
    description: '恢复当前模式',
  },
  {
    operation: 'flight.reset',
    path: '/api/v1/flight/reset',
    method: 'POST',
    description: '复位到任务起点',
  },
  {
    operation: 'flight.seek',
    path: '/api/v1/flight/time',
    method: 'PUT',
    description: '定位任务时间',
  },
  {
    operation: 'flight.speed',
    path: '/api/v1/flight/speed',
    method: 'PUT',
    description: '设置预设航线播放倍率',
  },
  {
    operation: 'mission.list',
    path: '/api/v1/missions',
    method: 'GET',
    description: '获取可用航线',
  },
  {
    operation: 'mission.select',
    path: '/api/v1/missions/current',
    method: 'PUT',
    description: '切换当前航线',
  },
  {
    operation: 'settings.get',
    path: '/api/v1/settings',
    method: 'GET',
    description: '读取展示设置',
  },
  {
    operation: 'settings.update',
    path: '/api/v1/settings',
    method: 'PATCH',
    description: '更新展示设置',
  },
] as const;

/** Browser operations; HTTP route aliases are not implied by this list. */
export const visualOperations = [
  'simulation.state',
  'simulation.frame',
  'simulation.source',
  'simulation.connect',
  'simulation.disconnect',
  'simulation.replay.load',
  'simulation.replay.sample',
  'simulation.replay.seek',
  'simulation.pause',
  'simulation.resume',
  'simulation.record.start',
  'simulation.record.stop',
  'simulation.record.export',
  'aircraft.describe',
  'camera.describe',
  'scene.describe',
  'scene.configure',
  'scene.query',
] as const;

/** Namespaces reserved for future features. Do not expose an operation until it has an implementation and tests. */
export const reservedNamespaces = ['assets', 'telemetry'] as const;
