import type { AircraftId } from './types';

/** Aircraft capabilities are explicit: incompatible telemetry never crosses airframes. */
export const AIRCRAFT = [
  {
    id: 'ev50',
    name: 'EV50',
    description: '复合翼运载无人机 · 8 + 3 动力系统',
    sourceCommit: '3b1887e23465824d3452eb4052e793e1f55b3469',
    capabilities: ['product', 'flight', 'ev50-telemetry', 'ulog-replay', 'sensor-cameras'],
    cameras: [
      ['free', '自由观察'],
      ['ground', '地面展示'],
      ['follow', '无人机跟随'],
      ['side', '侧面电影'],
      ['wide', '远景固定'],
      ['fpv', '机鼻相机'],
      ['down', '下视相机'],
    ],
  },
  {
    id: 'transwing',
    name: 'TRANSWING P4',
    description: '整翼倾转 · 四电机折桨 · 六路独立舵面',
    sourceCommit: '2ecb723d46b90fe509ae5c2ff7c1735a7b66b7b3',
    capabilities: [
      'product',
      'flight',
      'wing-tilt',
      'four-motors',
      'independent-surfaces',
      'python',
      'json-replay',
    ],
    cameras: [
      ['free', '自由观察'],
      ['front', '正面检查'],
      ['side', '侧面检查'],
      ['top', '正交俯视'],
      ['joint-L', '左关节'],
      ['joint-R', '右关节'],
    ],
  },
] as const;
export function isAircraftId(value: unknown): value is AircraftId {
  return typeof value === 'string' && AIRCRAFT.some((entry) => entry.id === value);
}
export function aircraftDescriptor(id: AircraftId) {
  return AIRCRAFT.find((entry) => entry.id === id)!;
}
export function aircraftFromUrl(url: URL): AircraftId {
  const value = url.searchParams.get('aircraft');
  return isAircraftId(value) ? value : 'ev50';
}
