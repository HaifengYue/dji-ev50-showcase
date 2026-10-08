import * as THREE from 'three';
import type { DetailView } from './details';
import { CAMERA_CLIP_DEFAULTS } from './cameraNavigation';

export type CameraView = 'perspective' | 'front' | 'top' | 'side';

export const INSPECTION_VIEWS: ReadonlyArray<{
  id: CameraView;
  label: string;
  detail: string;
}> = [
  { id: 'perspective', label: '三分之四', detail: '观察机身、机翼与撑杆连接' },
  { id: 'front', label: '正视', detail: '核对左右对称与翼面高度' },
  { id: 'side', label: '侧视', detail: '核对机身比例与前后推进器间距' },
  {
    id: 'top',
    label: '俯视',
    detail: '正交俯视，机头朝上；保留当前整翼展开程度',
  },
];

// 检查视角固定于机体坐标，不受飞行航向与位移影响。
const DIRECTIONS: Record<CameraView, [number, number, number]> = {
  perspective: [1, 0.65, 1.2],
  front: [0, 0, 1],
  side: [1, 0, 0],
  top: [0, 1, 0],
};

export function createInspectionCamera() {
  // 自主管理正交视锥，避免画质或像素比变化将取景重置为屏幕像素单位。
  return Object.assign(
    new THREE.OrthographicCamera(-1, 1, 1, -1, CAMERA_CLIP_DEFAULTS.near, CAMERA_CLIP_DEFAULTS.far),
    { manual: true },
  );
}

export function boxCorners(bounds: THREE.Box3) {
  return [0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) =>
      new THREE.Vector3(
        i & 1 ? bounds.max.x : bounds.min.x,
        i & 2 ? bounds.max.y : bounds.min.y,
        i & 4 ? bounds.max.z : bounds.min.z,
      ),
  );
}

export function getInspectionFrame(bounds: THREE.Box3, view: CameraView, aspect: number) {
  // 俯视时机头朝上，避免与观察方向平行的上向量造成相机翻转。
  const up = new THREE.Vector3(...(view === 'top' ? [0, 0, 1] : [0, 1, 0]));
  return fitInspectionBounds(bounds, new THREE.Vector3(...DIRECTIONS[view]), up, aspect);
}

/** 按最终观察方向计算投影范围，左右特写也共享同一取景算法。 */
function fitInspectionBounds(
  bounds: THREE.Box3,
  direction: THREE.Vector3,
  up: THREE.Vector3,
  aspect: number,
) {
  const target = bounds.getCenter(new THREE.Vector3());
  const distance = Math.max(bounds.getSize(new THREE.Vector3()).length() * 2, 10);
  const position = direction.clone().normalize().multiplyScalar(distance).add(target);
  const camera = new THREE.OrthographicCamera();
  camera.position.copy(position);
  camera.up.copy(up);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  let halfWidth = 0,
    halfHeight = 0;
  for (const corner of boxCorners(bounds)) {
    corner.applyMatrix4(camera.matrixWorldInverse);
    halfWidth = Math.max(halfWidth, Math.abs(corner.x));
    halfHeight = Math.max(halfHeight, Math.abs(corner.y));
  }
  // 保留边缘空白，长翼在窄屏横向取景时也不会被截断。
  const height = Math.max(halfHeight, halfWidth / Math.max(aspect, 0.1)) * 2.65;
  return { position, target, up, height, distance };
}

/** 静态折叠展示与飞行全景使用不同包围盒，避免首屏机体缩成远景。 */
export function getPresentationFrame(bounds: THREE.Box3, aspect: number, flight = false) {
  const framing = bounds.clone();
  if (flight) {
    framing.max.add(new THREE.Vector3(4, 1.6, 2));
    framing.min.z -= 2;
  }
  const target = framing.getCenter(new THREE.Vector3());
  const direction = new THREE.Vector3(1.05, flight ? 0.58 : 0.82, 1.25).normalize();
  const camera = new THREE.PerspectiveCamera(39, Math.max(aspect, 0.1), 0.1, 180);
  camera.position.copy(target).add(direction);
  camera.lookAt(target);
  const inverseRotation = camera.quaternion.clone().invert();
  const tanVertical = Math.tan(THREE.MathUtils.degToRad(19.5));
  const tanHorizontal = tanVertical * Math.max(aspect, 0.1);
  let distance = 6;
  for (const point of boxCorners(framing)) {
    point.sub(target).applyQuaternion(inverseRotation);
    distance = Math.max(
      distance,
      point.z + (Math.abs(point.x) * 1.32) / tanHorizontal,
      point.z + (Math.abs(point.y) * 1.32) / tanVertical,
    );
  }
  return {
    target,
    position: target.clone().addScaledVector(direction, distance),
    up: new THREE.Vector3(0, 1, 0),
    distance,
    height: 2 * distance * tanVertical,
  };
}

export function getJointInspectionFrame(
  position: THREE.Vector3,
  side: 'L' | 'R',
  aspect: number,
  motionBounds?: THREE.Box3,
) {
  const radius = 0.9;
  const bounds = new THREE.Box3(
    position.clone().addScalar(-radius),
    position.clone().addScalar(radius),
  );
  // 固定取景容纳整段连杆运动，不随每帧姿态推拉镜头。
  if (motionBounds && !motionBounds.isEmpty()) bounds.union(motionBounds);
  return fitInspectionBounds(
    bounds,
    new THREE.Vector3(side === 'R' ? 1.3 : -1.3, 0.9, 1.5),
    new THREE.Vector3(0, 1, 0),
    aspect,
  );
}

/** 无动画与动画结束共用同一投影提交路径，保证减少动态效果时方向和缩放一致。 */
export function applyCameraFrame(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  frame: ReturnType<typeof getInspectionFrame>,
  aspect: number,
) {
  camera.position.copy(frame.position);
  camera.up.copy(frame.up);
  camera.lookAt(frame.target);
  camera.zoom = 1;
  if (camera instanceof THREE.OrthographicCamera) {
    camera.left = (-frame.height * aspect) / 2;
    camera.right = (frame.height * aspect) / 2;
    camera.top = frame.height / 2;
    camera.bottom = -frame.height / 2;
  } else {
    camera.aspect = aspect;
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

/** 固定细节机位，探头从左侧观察；包围盒含整个限定行程。 */
export function getDetailInspectionFrame(bounds: THREE.Box3, view: DetailView, aspect: number) {
  const directions: Record<DetailView, [number, number, number]> = {
    wing: [1, 1.4, 1.2],
    tail: [1.2, 0.9, -1.2],
    cargo: [1.2, 0.5, 1.4],
    sensors: [-1.3, 0.5, 0.8],
    motors: [1.1, 0.7, 1.4],
    systems: [1.1, 0.8, 1.4],
  };
  return fitInspectionBounds(
    bounds,
    new THREE.Vector3(...directions[view]),
    new THREE.Vector3(0, 1, 0),
    aspect,
  );
}

/** 视景外部位移平移镜头和观察目标，不改变方位、焦距、缩放或相对机体距离。 */
export function translateCameraFrame(
  camera: THREE.Camera,
  target: THREE.Vector3,
  delta: THREE.Vector3,
) {
  if (![delta.x, delta.y, delta.z].every(Number.isFinite))
    throw new Error('镜头平移必须为有限数值');
  camera.position.add(delta);
  target.add(delta);
  camera.updateMatrixWorld(true);
}
