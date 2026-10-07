/** Cache key bound to actual current runtime bytes. */
export const MODEL_ASSET_REVISION =
  "20261007-v27-inset-integrated-b-annotation-refined-8f0840ad";
export function modelAssetUrl(variant: "xp4") {
  return `/models/${variant}.glb?v=${MODEL_ASSET_REVISION}`;
}
