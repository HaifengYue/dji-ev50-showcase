import * as THREE from 'three';
import { getWingJoint, type ModelRig } from './core/rig';
import { OwnedResources } from './resources';

// Scene, terrain, lights, fog, exposure and environment maps belong exclusively to the host.

/** Native guide geometry reads the same contract axis as the wing rig. */
export function createJointGuide(rig: ModelRig, side: 'L' | 'R', canvas: HTMLCanvasElement) {
  const joint = getWingJoint(rig, side);
  if (!joint) return null;
  const resources = new OwnedResources();
  const group = new THREE.Group();
  group.name = `SkyTrans_JointGuide_${side}`;
  const { position, axis, direction, angle } = joint;
  const radial = new THREE.Vector3(0, 1, 0).cross(axis).normalize().multiplyScalar(0.66);
  const at = (fraction: number) =>
    radial
      .clone()
      .applyAxisAngle(axis, direction * angle * fraction)
      .add(position);
  const ends = [
    position.clone().addScaledVector(axis, -0.78),
    position.clone().addScaledVector(axis, 0.78),
  ];
  const line = (points: THREE.Vector3[], color: string, dashed = false) => {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 0.08, gapSize: 0.045, depthTest: false })
      : new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
    const value = new THREE.Line(geometry, material);
    value.renderOrder = 10;
    if (dashed) value.computeLineDistances();
    group.add(value);
    return value;
  };
  line(ends, '#f2bf70', true);
  line(
    Array.from({ length: 49 }, (_, i) => at(i / 48)),
    '#d7edb0',
  );
  const pointer = line([position, at(0)], '#edf6dd');
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 12, 12),
    new THREE.MeshBasicMaterial({ color: '#f5f7e9', depthTest: false }),
  );
  marker.renderOrder = 11;
  group.add(marker);
  resources.capture(group);
  const labels = [
    ['倾斜旋转轴', ends[1]],
    ['0°', at(0)],
    ['120°', at(1)],
  ] as const;
  const overlay = document.createElement('div');
  overlay.className = 'tw-joint-labels';
  overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
  const nodes = labels.map(([text]) => {
    const node = document.createElement('span');
    node.textContent = text;
    node.style.cssText =
      'position:absolute;white-space:nowrap;font:11px sans-serif;color:#453a22;background:#fff8dbe8;padding:2px 4px;border-radius:3px;transform:translate(-50%,-50%)';
    overlay.append(node);
    return node;
  });
  canvas.parentElement?.append(overlay);
  return {
    group,
    update(progress: number, camera: THREE.Camera, visible: boolean) {
      group.visible = visible;
      overlay.hidden = !visible;
      const point = at(progress);
      marker.position.copy(point);
      const points = pointer.geometry.getAttribute('position') as THREE.BufferAttribute;
      points.setXYZ(1, point.x, point.y, point.z);
      points.needsUpdate = true;
      pointer.geometry.computeBoundingSphere();
      if (!visible) return;
      group.updateMatrixWorld(true);
      labels.forEach(([, point], index) => {
        const projected = point.clone().applyMatrix4(group.matrixWorld).project(camera);
        nodes[index].hidden = projected.z > 1 || projected.z < -1;
        nodes[index].style.left = `${((projected.x + 1) * canvas.clientWidth) / 2}px`;
        nodes[index].style.top = `${((1 - projected.y) * canvas.clientHeight) / 2}px`;
      });
    },
    dispose() {
      group.removeFromParent();
      overlay.remove();
      resources.dispose();
    },
  };
}
