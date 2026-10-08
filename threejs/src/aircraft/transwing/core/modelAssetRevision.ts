/** Cache key bound to actual current runtime bytes. */
export const MODEL_ASSET_REVISION = '20261008-continuous-main-tilt-and-root-curves-380e44e9';
export function modelAssetUrl(variant: 'xp4', assetUrl: (path: string) => string) {
  return assetUrl(`transwing/models/${variant}.glb?v=${MODEL_ASSET_REVISION}`);
}
