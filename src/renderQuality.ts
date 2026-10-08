/** Presentation-only sampling. Never changes the authored aircraft geometry. */
export const RENDER_QUALITY = {
  highDpr: [1.5, 2] as [number, number],
  lowDpr: [1, 1] as [number, number],
  shadowMapSize: 4096,
} as const;

/** Bound shadow allocation to the GPU limit, including older/mobile devices. */
export function shadowMapSizeForLimit(
  maxTextureSize: number,
  viewportWidth = 1024,
): number {
  const limit = Number.isFinite(maxTextureSize)
    ? Math.max(1, Math.floor(maxTextureSize))
    : 2048;
  return Math.min(
    viewportWidth < 768 ? 2048 : RENDER_QUALITY.shadowMapSize,
    2 ** Math.floor(Math.log2(limit)),
  );
}
import type { DirectionalLightShadow } from "three";

/** Three allocates a shadow target once; explicitly release it on quality changes. */
export function syncShadowAllocation(
  shadow: DirectionalLightShadow,
  mapSize: number,
  enabled: boolean,
) {
  if (
    shadow.map &&
    (!enabled || shadow.map.width !== mapSize || shadow.map.height !== mapSize)
  ) {
    shadow.map.dispose();
    shadow.map = null;
  }
  shadow.mapSize.set(mapSize, mapSize);
}
