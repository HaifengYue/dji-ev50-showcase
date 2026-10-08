import * as THREE from 'three';
import type { AircraftHost, AircraftQuality } from '../types';
import {
  SCENE_LIGHTING,
  SCENE_TONE_MAPPING_EXPOSURE,
  type SceneEnvironment,
} from './core/sceneLighting';
import { aircraftShadowRadius, updateAircraftShadow } from './core/sceneShadows';
import { shadowMapSizeForLimit, syncShadowAllocation } from './core/renderQuality';
import { getWingJoint, type ModelRig, type measureModelRig } from './core/rig';
import { OwnedResources } from './resources';

type Measurements = ReturnType<typeof measureModelRig>;
export class TranswingPresentation {
  readonly group = new THREE.Group();
  readonly sun = new THREE.DirectionalLight();
  private ambient = new THREE.AmbientLight();
  private hemisphere = new THREE.HemisphereLight();
  private cool = new THREE.PointLight();
  private warm = new THREE.PointLight();
  private floorMaterial = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.12 });
  private resources = new OwnedResources();
  private environment: THREE.WebGLRenderTarget | null = null;
  private sceneEnvironment: SceneEnvironment = 'hangar';
  private quality: AircraftQuality = 'High';
  private disposed = false;
  private radius: number;
  private columns = new THREE.Group();
  constructor(
    private host: AircraftHost,
    measurements: Measurements,
  ) {
    try {
      this.group.name = 'Transwing_Presentation';
      const bounds = measurements.bounds.clone();
      for (const detail of Object.values(measurements.detailBounds)) bounds.union(detail);
      this.radius = aircraftShadowRadius(bounds, measurements.groundOffset);
      this.group.add(
        this.ambient,
        this.hemisphere,
        this.sun,
        this.sun.target,
        this.cool,
        this.warm,
      );
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), this.floorMaterial);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.63;
      ground.receiveShadow = true;
      this.group.add(ground);
      const grid = new THREE.GridHelper(100, 50, '#5d819f', '#879eb3');
      grid.position.y = -0.615;
      for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) {
        material.transparent = true;
        material.opacity = 0.35;
      }
      this.group.add(grid);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(5.7, 5.75, 96),
        new THREE.MeshBasicMaterial({ color: '#567f9f', transparent: true, opacity: 0.42 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.6;
      this.group.add(ring);
      const beamMaterial = new THREE.MeshStandardMaterial({ color: '#98adbf', roughness: 0.8 });
      const columnGeometry = new THREE.BoxGeometry(0.5, 13, 0.5);
      const beamGeometry = new THREE.BoxGeometry(34, 0.4, 0.4);
      const stripGeometry = new THREE.BoxGeometry(12, 0.05, 0.1);
      const stripMaterial = new THREE.MeshBasicMaterial({ color: '#eef7ff' });
      for (let i = 0; i < 7; i++) {
        for (const side of [-1, 1]) {
          const column = new THREE.Mesh(columnGeometry, beamMaterial);
          column.position.set(side * 17, 6, -10 - i * 7);
          this.columns.add(column);
        }
        const beam = new THREE.Mesh(beamGeometry, beamMaterial);
        beam.position.set(0, 12, -10 - i * 7);
        this.columns.add(beam);
        const strip = new THREE.Mesh(stripGeometry, stripMaterial);
        strip.position.set(0, 11.7, -10 - i * 7);
        this.columns.add(strip);
      }
      this.group.add(this.columns);
      this.resources.capture(this.group);
      host.scene.add(this.group);
      host.scene.environmentIntensity = 1;
      host.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      host.renderer.toneMappingExposure = SCENE_TONE_MAPPING_EXPOSURE;
      this.setEnvironment('hangar');
      this.setQuality('High');
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  private buildEnvironment() {
    const lighting = SCENE_LIGHTING[this.sceneEnvironment];
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#000000');
    const panel = (
      color: string,
      intensity: number,
      position: [number, number, number],
      rotation: [number, number, number],
      scale: [number, number, number],
    ) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(color).multiplyScalar(intensity),
          side: THREE.DoubleSide,
        }),
      );
      mesh.position.set(...position);
      mesh.rotation.set(...rotation);
      mesh.scale.set(...scale);
      scene.add(mesh);
    };
    panel('#ffffff', lighting.topReflection, [0, 10, 0], [Math.PI / 2, 0, 0], [15, 10, 1]);
    panel('#cfe7ff', lighting.sideReflection, [-10, 4, 0], [0, Math.PI / 2, 0], [8, 12, 1]);
    const resources = new OwnedResources();
    resources.capture(scene);
    let generator: THREE.PMREMGenerator | null = null;
    try {
      generator = new THREE.PMREMGenerator(this.host.renderer);
      const next = generator.fromScene(scene, 0.03, 0.1, 100);
      this.host.scene.environment = next.texture;
      this.environment?.dispose();
      this.environment = next;
    } finally {
      generator?.dispose();
      resources.dispose();
    }
  }
  setEnvironment(value: SceneEnvironment) {
    if (this.disposed) return;
    this.sceneEnvironment = value;
    const lighting = SCENE_LIGHTING[value];
    this.host.scene.background = new THREE.Color(lighting.background);
    this.host.scene.fog = new THREE.Fog(lighting.background, 30, 78);
    this.ambient.intensity = lighting.ambient;
    this.hemisphere.color.set(lighting.hemisphere.color);
    this.hemisphere.groundColor.set(lighting.hemisphere.groundColor);
    this.hemisphere.intensity = lighting.hemisphere.intensity;
    this.sun.intensity = lighting.sun.intensity;
    this.cool.position.set(...lighting.coolFill.position);
    this.cool.color.set(lighting.coolFill.color);
    this.cool.intensity = lighting.coolFill.intensity;
    this.warm.position.set(...lighting.warmFill.position);
    this.warm.color.set(lighting.warmFill.color);
    this.warm.intensity = lighting.warmFill.intensity;
    this.floorMaterial.color.set(value === 'sky' ? '#aabfcb' : '#a4b5c6');
    this.columns.visible = value === 'hangar';
    this.buildEnvironment();
  }
  setQuality(quality: AircraftQuality) {
    this.quality = quality;
    this.sun.castShadow = quality !== 'Low';
    const size = shadowMapSizeForLimit(
      this.host.renderer.capabilities.maxTextureSize,
      this.host.canvas.clientWidth,
    );
    syncShadowAllocation(
      this.sun.shadow,
      quality === 'Medium' ? Math.min(size, 2048) : size,
      this.sun.castShadow,
    );
    this.host.renderer.shadowMap.enabled = this.sun.castShadow;
    this.host.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  resize() {
    this.setQuality(this.quality);
  }
  update(anchor: THREE.Vector3, exploded: boolean) {
    updateAircraftShadow(
      this.sun,
      SCENE_LIGHTING[this.sceneEnvironment].sun.position,
      anchor,
      this.radius,
      exploded,
    );
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.resources.dispose();
    this.sun.shadow.dispose();
    if (this.host.scene.environment === this.environment?.texture)
      this.host.scene.environment = null;
    this.environment?.dispose();
    this.environment = null;
  }
}

/** Native guide geometry reads the same contract axis as the wing rig. */
export function createJointGuide(rig: ModelRig, side: 'L' | 'R', canvas: HTMLCanvasElement) {
  const joint = getWingJoint(rig, side);
  if (!joint) return null;
  const resources = new OwnedResources();
  const group = new THREE.Group();
  group.name = `Transwing_JointGuide_${side}`;
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
