import * as THREE from "three";

/** 相对于当前观察目标的距离/倍率，整机与局部检查共用，不受世界坐标平移影响。 */
export const CAMERA_NAVIGATION = {
  minDistance: 0.2,
  maxDistance: 240,
  minZoom: 0.08,
  maxZoom: 40,
  enablePan: true,
  screenSpacePanning: true,
  zoomToCursor: true,
} as const;

export const CAMERA_CLIP_DEFAULTS = { near: 0.1, far: 600 } as const;

/** 视景尺寸变化只更新投影宽高比，不重新取景或改变用户的轨道状态。 */
export function resizeCameraProjection(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  aspect: number,
) {
  if (!Number.isFinite(aspect) || aspect <= 0) return;
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = aspect;
  } else {
    const center = (camera.left + camera.right) / 2;
    const width = (camera.top - camera.bottom) * aspect;
    camera.left = center - width / 2;
    camera.right = center + width / 2;
  }
  camera.updateProjectionMatrix();
}

export function getCameraDepthRange(distance: number) {
  if (!Number.isFinite(distance) || distance < 0)
    throw new Error("镜头距离必须为非负有限数值");
  return {
    // 仅在近距离降低近裁面；普通取景保留原有深度精度，减少薄缝闪烁。
    near: THREE.MathUtils.clamp(distance * 0.02, 0.005, 0.1),
    // 正交极远景切回透视时，过渡起点可能比手动轨道上限更远。
    far: Math.max(CAMERA_CLIP_DEFAULTS.far, distance * 3),
    fogNear: Math.max(30, distance * 1.1),
    fogFar: Math.max(78, distance * 1.1 + 48),
  };
}

/** 只调整深度范围，不重设位置、方位、目标或用户缩放。 */
export function syncCameraDepthRange(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  target: THREE.Vector3,
  fog: THREE.Fog | THREE.FogExp2 | null = null,
) {
  const range = getCameraDepthRange(camera.position.distanceTo(target));
  const near =
    camera instanceof THREE.PerspectiveCamera
      ? range.near
      : CAMERA_CLIP_DEFAULTS.near;
  if (camera.near !== near || camera.far !== range.far) {
    camera.near = near;
    camera.far = range.far;
    camera.updateProjectionMatrix();
  }
  // 不让原来78处的远雾在扩大缩小范围后吞没整机；近景雾参数不变。
  if (fog instanceof THREE.Fog) {
    fog.near = range.fogNear;
    fog.far = range.fogFar;
  }
}
