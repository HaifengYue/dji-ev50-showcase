import * as T from 'three';
import { ROTOR_NAMES, Surfaces } from './telemetry';

export const CAMERA_MOUNTS = {
  fpv: {
    position: [0, 0.47, 1.86],
    quaternion: new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI).toArray(),
    verticalFov: 64,
  },
  down: {
    position: [0, 0.2, 0.3],
    quaternion: new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -Math.PI / 2).toArray(),
    verticalFov: 64,
  },
} as const;

/** Runtime additions preserve the source asset and its authored rest transforms. */
export function aircraftRig(aircraft: T.Group) {
  const surfaces: { pivot: T.Group; channel: keyof Surfaces; gain: number; axis: 'x' | 'y' }[] = [];
  aircraft.updateMatrixWorld(true);
  const objects = new Map<string, T.Object3D>();
  aircraft.traverse((o) => objects.set(o.name, o));
  const bind = (name: string, channel: keyof Surfaces, gain: number, axis: 'x' | 'y') => {
    const part = objects.get(name);
    if (!part) return;
    const bounds = new T.Box3().setFromObject(part),
      center = bounds.getCenter(new T.Vector3());
    center.z = bounds.max.z;
    const pivot = new T.Group();
    pivot.name = `${name}_VisualHinge`;
    pivot.position.copy(aircraft.worldToLocal(center));
    aircraft.add(pivot);
    pivot.updateMatrixWorld(true);
    pivot.attach(part);
    surfaces.push({ pivot, channel, gain, axis });
  };
  for (const side of ['Left', 'Right']) {
    bind(`${side}_Aileron`, 'aileron', side === 'Left' ? -0.35 : 0.35, 'x');
    bind(`${side}_Rudder`, 'rudder', -0.4, 'y');
  }
  const graphite = new T.MeshStandardMaterial({
    color: 0x36424a,
    roughness: 0.47,
    metalness: 0.25,
  });
  for (const sign of [-1, 1]) {
    const pivot = new T.Group();
    pivot.name = `Visual_Elevator_${sign < 0 ? 'Left' : 'Right'}`;
    pivot.position.set(sign * 0.36, 0.825, -1.57);
    pivot.rotation.z = sign * 0.1;
    const geometry = new T.BoxGeometry(0.47, 0.008, 0.045);
    const panel = new T.Mesh(geometry, graphite);
    panel.position.z = -0.0225;
    panel.castShadow = true;
    panel.receiveShadow = true;
    pivot.add(panel);
    aircraft.add(pivot);
    // The elevator strips are illustrative visual additions, not OEM geometry.
    const hinge = new T.Group();
    hinge.name = `${pivot.name}_Hinge`;
    pivot.add(hinge);
    hinge.attach(panel);
    surfaces.push({ pivot: hinge, channel: 'elevator', gain: 0.3, axis: 'x' });
  }
  const lampMaterials: T.MeshStandardMaterial[] = [];
  for (const [name, object] of objects)
    if (name.endsWith('_Navigation_Light') && object instanceof T.Mesh) {
      const material = (object.material as T.MeshStandardMaterial).clone();
      material.emissive.copy(material.color);
      material.emissiveIntensity = 0.8;
      object.material = material;
      lampMaterials.push(material);
    }
  const strobeMaterial = new T.MeshStandardMaterial({
    color: 0xf0f5ff,
    emissive: 0xe4efff,
    emissiveIntensity: 0,
  });
  const strobe = new T.Mesh(new T.SphereGeometry(0.022, 12, 8), strobeMaterial);
  strobe.name = 'Visual_AntiCollision_Lamp';
  strobe.position.set(0, 0.943, -0.05);
  aircraft.add(strobe);
  const bezel = new T.Mesh(new T.CylinderGeometry(0.026, 0.028, 0.01, 20), graphite);
  bezel.name = 'Visual_Nose_Lens_Bezel';
  bezel.rotation.x = Math.PI / 2;
  bezel.position.set(0, 0.44, 1.781);
  aircraft.add(bezel);
  const glass = new T.Mesh(
    new T.SphereGeometry(0.019, 16, 10),
    new T.MeshPhysicalMaterial({ color: 0x163749, metalness: 0.25, roughness: 0.12, clearcoat: 1 }),
  );
  glass.name = 'Visual_Nose_Lens';
  glass.scale.z = 0.3;
  glass.position.set(0, 0.44, 1.79);
  aircraft.add(glass);
  const debug = new T.Group();
  debug.name = 'Aircraft_Reference_Frames';
  debug.visible = false;
  aircraft.add(debug);
  debug.add(new T.AxesHelper(1.6));
  for (const [name, mount] of Object.entries(CAMERA_MOUNTS)) {
    const anchor = new T.Object3D();
    anchor.name = `SensorMount_${name}`;
    anchor.position.fromArray(mount.position);
    anchor.quaternion.fromArray(mount.quaternion);
    aircraft.add(anchor);
    const helper = new T.AxesHelper(0.22);
    helper.position.copy(anchor.position);
    helper.quaternion.copy(anchor.quaternion);
    debug.add(helper);
  }
  return {
    debug,
    update(values: Surfaces, seconds: number, active: boolean) {
      for (const surface of surfaces)
        surface.pivot.rotation[surface.axis] = values[surface.channel] * surface.gain;
      for (const material of lampMaterials) material.emissiveIntensity = active ? 1.8 : 0.5;
      const phase = seconds % 1.2;
      strobeMaterial.emissiveIntensity =
        active && (phase < 0.05 || (phase > 0.12 && phase < 0.17)) ? 5 : 0.05;
    },
    describe() {
      return {
        rotors: ROTOR_NAMES.map((name, index) => ({
          index,
          name,
          present: objects.has(name),
          spinSign: Number(objects.get(name)?.userData.spin_sign) || 1,
        })),
        surfaces: surfaces.map((s) => ({
          name: s.pivot.name,
          channel: s.channel,
          axis: s.axis,
          radiansAtOne: s.gain,
        })),
        sensorMounts: CAMERA_MOUNTS,
        modelAxes: { forward: '+Z', right: '-X', up: '+Y' },
        geometry: 'v09 plus runtime visual details',
      };
    },
  };
}

export function placeSensorCamera(
  mode: 'fpv' | 'down',
  aircraft: T.Object3D,
  camera: T.PerspectiveCamera,
) {
  const mount = CAMERA_MOUNTS[mode];
  aircraft.updateMatrixWorld(true);
  camera.position.fromArray(mount.position).applyMatrix4(aircraft.matrixWorld);
  aircraft.getWorldQuaternion(camera.quaternion);
  camera.quaternion.multiply(new T.Quaternion().fromArray(mount.quaternion));
  camera.updateMatrixWorld(true);
}

export function describeCamera(
  camera: T.PerspectiveCamera,
  canvas: HTMLCanvasElement,
  mode: string,
) {
  camera.updateMatrixWorld(true);
  const height = canvas.height,
    width = canvas.width;
  const fy = height / (2 * Math.tan(T.MathUtils.degToRad(camera.fov / 2))),
    fx = (fy * width) / (height * camera.aspect);
  return {
    mode,
    width,
    height,
    fx,
    fy,
    cx: width / 2,
    cy: height / 2,
    near: camera.near,
    far: camera.far,
    sceneFromCamera: camera.matrixWorld.toArray(),
    projection: camera.projectionMatrix.toArray(),
    matrixStorage: 'column-major',
    opticalAxes: 'Three.js camera: +X right, +Y up, -Z forward',
    model: 'ideal pinhole; no distortion, rolling shutter or OEM calibration',
  };
}
