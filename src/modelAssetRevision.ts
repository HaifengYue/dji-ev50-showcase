/** V27 candidate-stage helper only; not approved for main integration. */
export const MODEL_ASSET_REVISION =
  "20261007-v27-inset-integrated-b-edge-linkage-334febcb";
export function modelAssetUrl(variant: "xp4") {
  return `/models/${variant}.glb?v=${MODEL_ASSET_REVISION}`;
}
