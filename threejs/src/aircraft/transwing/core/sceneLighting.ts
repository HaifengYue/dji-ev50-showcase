/** V17：亮色展台的小幅光比调整；仅影响呈现，不参与仿真。 */
export const SCENE_TONE_MAPPING_EXPOSURE = 0.94;

export type SceneEnvironment = 'hangar' | 'sky';
type SceneLighting = {
  background: string;
  ambient: number;
  hemisphere: { color: string; groundColor: string; intensity: number };
  sun: { position: [number, number, number]; intensity: number };
  coolFill: {
    position: [number, number, number];
    color: string;
    intensity: number;
  };
  warmFill: {
    position: [number, number, number];
    color: string;
    intensity: number;
  };
  topReflection: number;
  sideReflection: number;
};

const common = {
  sun: { position: [9, 14, 7] as [number, number, number], intensity: 2.35 },
  coolFill: {
    position: [-8, 5, -5] as [number, number, number],
    color: '#c8e4ff',
    intensity: 28,
  },
  warmFill: {
    position: [8, 2, 4] as [number, number, number],
    color: '#fff3df',
    intensity: 12,
  },
};

export const SCENE_LIGHTING: Record<SceneEnvironment, SceneLighting> = {
  hangar: {
    ...common,
    background: '#d4e0eb',
    ambient: 0.32,
    hemisphere: { color: '#eaf4ff', groundColor: '#6b7f94', intensity: 0.68 },
    coolFill: { ...common.coolFill, intensity: 32 },
    topReflection: 2.5,
    sideReflection: 1.8,
  },
  sky: {
    ...common,
    background: '#c6dcec',
    ambient: 0.55,
    hemisphere: { color: '#eaf4ff', groundColor: '#6b7f94', intensity: 0.85 },
    sun: { ...common.sun, intensity: 2.7 },
    topReflection: 2.8,
    sideReflection: 1.6,
  },
};
