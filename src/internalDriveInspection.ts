import * as THREE from "three";
import { getPresentationFrame } from "./inspection";

/** 仅移开指定机壳与减速箱罩；传动件、连杆与槽边支承始终保留。 */
export const INTERNAL_DRIVE_SHELL_NAMES = [
  "Fuselage",
  "ActuatorSideSlot_L",
  "ActuatorSideSlot_R",
  "Drive_ReductionHousing",
  // 以下仅为附着在机身壳面的检修缝、紧固件与接收器外形。
  // GLTFLoader 会净化 Blender 的 .001 等后缀，使用实际运行节点名。
  "Dorsal_hatch_main",
  "Hatch_fastener_main",
  "Hatch_fastener_main001",
  "Hatch_fastener_main002",
  "Hatch_fastener_main003",
  "Tail_boom_join",
  "Lower_fuselage_join",
  "Lower_fuselage_join001",
  "Lower_fuselage_join002",
  "Lower_fuselage_join003",
  "Dorsal_small_receiver",
  "Tail_receiver",
] as const;

/** 纯展示层：不修改仿真、层级、变换、材质、旋桨或外部回执。 */
export function createInternalDriveInspection(scene: THREE.Object3D) {
  let active = false;
  let saved: Array<{ object: THREE.Object3D; visible: boolean }> = [];
  const restore = () => {
    for (const { object, visible } of saved) object.visible = visible;
    saved = [];
    active = false;
  };
  return {
    setActive(next: boolean) {
      if (next === active) return;
      if (!next) {
        restore();
        return;
      }
      saved = INTERNAL_DRIVE_SHELL_NAMES.flatMap((name) => {
        const object = scene.getObjectByName(name);
        return object ? [{ object, visible: object.visible }] : [];
      });
      for (const { object } of saved) object.visible = false;
      active = true;
    },
    dispose: restore,
  };
}

/** 同时容纳固定执行器、移动横梁及左右连杆全行程，不随每帧运动推拉镜头。 */
export function getInternalDriveInspectionFrame(
  internalBounds: THREE.Box3,
  jointBounds: { L: THREE.Box3; R: THREE.Box3 },
  aspect: number,
) {
  const bounds = internalBounds
    .clone()
    .union(jointBounds.L)
    .union(jointBounds.R);
  if (bounds.isEmpty()) return null;
  return getPresentationFrame(bounds, aspect);
}
