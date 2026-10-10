/** Shared visual tuning only. Flight clocks, pose, camera and geometry never depend on it. */
export const SCENE_APPEARANCE = {
  product: { background: 0x202c34, exposure: 1, environmentIntensity: 0.45 },
  flight: {
    // Keep highlights and white trails while giving terrain a little more depth.
    exposure: 0.96,
    environmentIntensity: 0.45,
    fog: { daylight: 0x93bed7, golden: 0xd3baa2, near: 2000, far: 7400 },
  },
  sky: {
    zenith: 0x328bd7,
    horizon: 0x86c2e5,
    cloudShadow: [0.68, 0.78, 0.87] as const,
    cloudHighlight: [1, 1, 1] as const,
    cloudOpacity: 0.9,
  },
} as const;
