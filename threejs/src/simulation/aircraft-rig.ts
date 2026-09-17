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
  const graphite = new T.MeshStandardMaterial({
    color: 0x36424a,
    roughness: 0.47,
    metalness: 0.25,
  });
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
    // v13 supplies an authored trailing elevator. Keep the tailplane fallback
    // for archived assets without fabricating a detached rear-edge panel.
    bind(
      objects.has(`${side}_Elevator`) ? `${side}_Elevator` : `${side}_Tailplane`,
      'elevator',
      0.3,
      'x',
    );
  }
  // Only animate control surfaces authored by the source asset. In particular,
  // do not add standalone hinge rods or speculative elevator strips: the
  // reference aircraft has continuous wing and tail surfaces, and unconnected
  // runtime geometry reads as debris when viewed from a distance.
  const wheelMaterial = new T.MeshStandardMaterial({
    color: 0x151b1f,
    roughness: 0.78,
    metalness: 0.05,
  });
  const hubMaterial = new T.MeshStandardMaterial({
    color: 0x7d8b92,
    roughness: 0.32,
    metalness: 0.82,
  });
  const brakeMaterial = new T.MeshStandardMaterial({
    color: 0xbb8f50,
    roughness: 0.48,
    metalness: 0.56,
  });
  const landingGear: { name: string; radius: number; position: [number, number, number] }[] = [];
  const authoredWheels = ['Gear_Main_Left', 'Gear_Main_Right', 'Gear_Tail'].map((name) =>
    objects.get(name),
  );
  if (authoredWheels.every((wheel) => wheel?.userData.part === 'landing_wheel')) {
    // The current asset contains the complete struts, forks and three wheels in the source asset.
    for (const wheel of authoredWheels) {
      const center = aircraft.worldToLocal(wheel!.getWorldPosition(new T.Vector3()));
      landingGear.push({
        name: wheel!.name,
        radius: Number(wheel!.userData.radius_m),
        position: center.toArray() as [number, number, number],
      });
    }
  } else {
    // The authored GLB has paired shoe placeholders. The reference aircraft
    // uses a conventional tailwheel layout: two forward mains plus one tail wheel.
    for (const shoeName of [
      'Gear_Front_Left_Shoe',
      'Gear_Front_Right_Shoe',
      'Gear_Rear_Left_Shoe',
      'Gear_Rear_Right_Shoe',
    ]) {
      const shoe = objects.get(shoeName);
      if (shoe) shoe.visible = false;
    }
    for (const { name, position, radius } of [
      {
        name: 'Gear_Main_Left',
        position: [-0.63, 0.065, 1.05] as [number, number, number],
        radius: 0.13,
      },
      {
        name: 'Gear_Main_Right',
        position: [0.63, 0.065, 1.05] as [number, number, number],
        radius: 0.13,
      },
      { name: 'Gear_Tail', position: [0, 0.065, -0.63] as [number, number, number], radius: 0.09 },
    ]) {
      const wheel = new T.Group();
      wheel.name = `${name}_VisualWheel`;
      wheel.position.fromArray(position);
      const tyre = new T.Mesh(new T.TorusGeometry(radius, radius * 0.27, 10, 20), wheelMaterial);
      tyre.rotation.y = Math.PI / 2;
      tyre.castShadow = tyre.receiveShadow = true;
      wheel.add(tyre);
      const hub = new T.Mesh(
        new T.CylinderGeometry(radius * 0.42, radius * 0.42, radius * 0.28, 16),
        hubMaterial,
      );
      hub.rotation.z = Math.PI / 2;
      hub.castShadow = hub.receiveShadow = true;
      wheel.add(hub);
      const brake = new T.Mesh(
        new T.CylinderGeometry(radius * 0.28, radius * 0.28, 0.012, 16),
        brakeMaterial,
      );
      brake.rotation.z = Math.PI / 2;
      brake.position.x = radius * 0.155;
      wheel.add(brake);
      aircraft.add(wheel);
      landingGear.push({ name, radius, position });
    }
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
    update(values: Surfaces, _seconds: number, active: boolean) {
      for (const surface of surfaces)
        surface.pivot.rotation[surface.axis] = values[surface.channel] * surface.gain;
      for (const material of lampMaterials) material.emissiveIntensity = active ? 1.8 : 0.5;
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
        landingGear,
        sensorMounts: CAMERA_MOUNTS,
        modelAxes: { forward: '+Z', right: '-X', up: '+Y' },
        geometry: authoredWheels.every((wheel) => wheel?.userData.part === 'landing_wheel')
          ? 'authored three-point taildragger with source control surfaces and runtime lighting'
          : 'legacy asset with runtime tailwheel and lighting details',
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
