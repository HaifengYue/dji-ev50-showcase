import assert from "node:assert/strict";
import * as T from "three";
import {
  rayDistances,
  windingClassification,
  componentSamples,
} from "./support-geometry.mts";
const { createWorldTriangles } = await import("./triangle-contact.mjs");
const sphere = new T.Mesh(new T.SphereGeometry(0.02, 16, 8));
sphere.updateMatrixWorld(true);
const snap = createWorldTriangles(sphere);
for (const p of [
  [0, 0, 0],
  [0.01, 0, 0],
])
  assert.equal(windingClassification(p, snap).state, "inside");
assert.equal(windingClassification([0.03, 0, 0], snap).state, "outside");
for (const t of snap.triangles)
  t.vertices = [t.vertices[0], t.vertices[2], t.vertices[1]];
assert.equal(
  windingClassification([0, 0, 0], snap).state,
  "inside",
  "Inward face order cannot turn real material into empty space",
);
const box = new T.Mesh(new T.BoxGeometry(2, 2, 2));
box.updateMatrixWorld(true);
const bs = createWorldTriangles(box);
for (const direction of [
  new T.Vector3(1, 0, 0),
  new T.Vector3(0, 1, 0),
  new T.Vector3(0, 0, 1),
  new T.Vector3(1, 1, 0).normalize(),
]) {
  const ds = rayDistances(bs, new T.Vector3(), direction);
  assert.equal(ds.length, 1);
  assert(
    Math.abs(
      ds[0] -
        (Math.abs(direction.x) === 1 ||
        Math.abs(direction.y) === 1 ||
        Math.abs(direction.z) === 1
          ? 1
          : Math.sqrt(2)),
    ) < 1e-10,
  );
}
assert.equal(componentSamples(bs).length, 1);
console.log(
  "Support geometry self-tests passed: winding/inverted orientation, shared-edge ray, connected component",
);

const inconsistent = createWorldTriangles(box);
const first = inconsistent.triangles[0];
first.vertices = [first.vertices[0], first.vertices[2], first.vertices[1]];
assert.equal(
  windingClassification([0, 0, 0], inconsistent).state,
  "unresolved-inconsistent-face-orientation",
);
console.log("Locally flipped face rejected by directed edge cancellation");
