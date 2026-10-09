// V12 independent physical metrics in motor and hinge frames, not render pixels.
import * as T from "three";
import {
  createWorldTriangles,
  intersectMeshTriangles,
} from "./triangle-contact.mjs";
import {
  solidTopology,
  containedComponents,
  pointInSolid,
} from "./solid-contact.mjs";
const geometryCache = new WeakMap();
function cached(mesh) {
  let row = geometryCache.get(mesh);
  if (!row || !row.matrix.every((v, i) => v === mesh.matrixWorld.elements[i])) {
    const snapshot = createWorldTriangles(mesh);
    row = {
      snapshot,
      topology: row?.topology ?? solidTopology(snapshot),
      matrix: [...mesh.matrixWorld.elements],
    };
    geometryCache.set(mesh, row);
  }
  return row;
}
export function contact(a, b) {
  const ca = cached(a),
    cb = cached(b),
    x = ca.snapshot,
    y = cb.snapshot,
    tx = ca.topology,
    ty = cb.topology;
  if (
    x.bounds.min.some((v, i) => v > y.bounds.max[i] + 1e-9) ||
    y.bounds.min.some((v, i) => v > x.bounds.max[i] + 1e-9)
  )
    return {
      closed: tx.closed && ty.closed,
      intersects: false,
      surface: false,
      contained: 0,
      unresolved: [],
      triangleSATTests: 0,
      witness: null,
    };
  const surface = intersectMeshTriangles(x, y, {
    maxWitnesses: 1,
    epsilon: 1e-9,
  });
  const contained = surface.intersects ? [] : containedComponents(x, y, tx, ty),
    unresolved = contained.unresolved ?? [];
  return {
    closed: tx.closed && ty.closed,
    intersects: surface.intersects || contained.length > 0,
    surface: surface.intersects,
    contained: contained.length,
    unresolved,
    triangleSATTests: surface.stats.triangleSATTests,
    witness: surface.witnesses[0] ?? contained[0] ?? null,
  };
}
export function hingeHole(blade, fold) {
  const snap = createWorldTriangles(blade),
    topology = solidTopology(snap),
    euler = topology.vertexCount - topology.edgeCount + snap.triangles.length;
  const probes = [];
  for (const z of [-0.024, 0, 0.024])
    for (let i = 0; i < 8; i++) {
      const t = (i * Math.PI) / 4;
      for (const [radius, expected] of [
        [0.004, "outside"],
        [0.014, "inside"],
      ]) {
        const p = fold.localToWorld(
          new T.Vector3(radius * Math.cos(t), radius * Math.sin(t), z),
        );
        const result = pointInSolid(p.toArray(), snap, topology);
        probes.push({ radius, z, angle: t, expected, ...result });
      }
    }
  return {
    name: blade.name,
    closed: topology.closed,
    eulerCharacteristic: euler,
    connectedComponents: topology.componentCount,
    passed:
      topology.closed &&
      topology.componentCount === 1 &&
      euler === 0 &&
      probes.every((p) => p.state === p.expected),
    probes,
  };
}
export function motorMetrics(scene, suffix) {
  const prop = scene.getObjectByName(`Prop_${suffix}`),
    center = prop.getWorldPosition(new T.Vector3());
  const axis = scene
    .getObjectByName(`MotorAxisEnd_${suffix}`)
    .getWorldPosition(new T.Vector3())
    .sub(
      scene
        .getObjectByName(`MotorAxisStart_${suffix}`)
        .getWorldPosition(new T.Vector3()),
    )
    .normalize();
  const points = (m) =>
    createWorldTriangles(m)
      .triangles.flatMap((t) => t.vertices)
      .map((p) => new T.Vector3(...p));
  const radial = (v) => {
    const d = v.clone().sub(center);
    return d.addScaledVector(axis, -d.dot(axis)).length();
  };
  const extents = (prefix) => {
    const names =
      prefix === "Blade"
        ? ["A", "B"].map((l) => `Blade_${suffix}_${l}`)
        : [`${prefix}_${suffix}`];
    const pts = names.flatMap((n) => points(scene.getObjectByName(n))),
      rs = pts.map(radial),
      hs = pts.map((p) => p.sub(center).dot(axis));
    return {
      radialMaximum: Math.max(...rs),
      radialMinimum: Math.min(...rs),
      axialMinimum: Math.min(...hs),
      axialMaximum: Math.max(...hs),
    };
  };
  return {
    suffix,
    hingeRadii: ["A", "B"].map((l) =>
      radial(
        scene
          .getObjectByName(`BladeFold_${suffix}_${l}`)
          .getWorldPosition(new T.Vector3()),
      ),
    ),
    blade: extents("Blade"),
    spinner: extents("Spinner"),
    cowl: extents("Motor_cowl"),
    nacelle: extents("Nacelle"),
  };
}
export function expectedFixedAttachment(a, b) {
  const names = [a.name, b.name];
  const has = (re) => names.find((n) => re.test(n));
  const arm = has(/^Blade_hinge_arm_/),
    pin = has(/^Blade_hinge_pin_/),
    spinner = has(/^Spinner_/),
    cowl = has(/^Motor_cowl_/),
    nacelle = has(/^Nacelle_/);
  if (a.parent !== b.parent) return null;
  if (arm && pin && arm.slice(16) === pin.slice(16))
    return "pin bonded to fork sides";
  if (arm && spinner && arm.slice(16, -2) === spinner.slice(8))
    return "fork bonded to spinner root";
  if (cowl && nacelle && cowl.slice(11) === nacelle.slice(8))
    return "cowl mating ring bonded to nacelle";
  return null;
}
export function forkHoles(arm, fold) {
  const snap = createWorldTriangles(arm),
    topology = solidTopology(snap),
    euler = topology.vertexCount - topology.edgeCount + snap.triangles.length,
    probes = [];
  for (const z of [-0.043, 0.043])
    for (let i = 0; i < 8; i++)
      for (const [radius, expected] of [
        [0.004, "outside"],
        [0.0095, "inside"],
      ]) {
        const p = fold.localToWorld(
          new T.Vector3(
            radius * Math.cos((i * Math.PI) / 4),
            radius * Math.sin((i * Math.PI) / 4),
            z,
          ),
        );
        probes.push({
          z,
          radius,
          angle: (i * Math.PI) / 4,
          expected,
          ...pointInSolid(p.toArray(), snap, topology),
        });
      }
  return {
    name: arm.name,
    passed:
      topology.closed &&
      topology.componentCount === 1 &&
      euler === -2 &&
      probes.every((p) => p.state === p.expected),
    closed: topology.closed,
    eulerCharacteristic: euler,
    components: topology.componentCount,
    probes,
  };
}
