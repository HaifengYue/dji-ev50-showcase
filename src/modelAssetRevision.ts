/** Cache key bound to actual current runtime bytes. */
export const MODEL_ASSET_REVISION =
  "20261008-annotated-surface-and-transverse-output-bb67af8c";
export function modelAssetUrl(variant: "xp4") {
  return `/models/${variant}.glb?v=${MODEL_ASSET_REVISION}`;
}
