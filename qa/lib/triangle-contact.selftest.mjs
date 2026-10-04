import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { boundsOverlap, triangleTriangleContact, createWorldTriangles, intersectMeshTriangles } from './triangle-contact.mjs';

const A = [[0, 0, 0], [2, 0, 0], [0, 2, 0]];
const hit = (a, b, options = { epsilon: 0 }) => triangleTriangleContact(a, b, options) !== null;
const translate = (triangle, delta) => triangle.map((p) => p.map((v, i) => v + delta[i]));
const permutations = (a) => [a, [a[0], a[2], a[1]], [a[1], a[0], a[2]], [a[1], a[2], a[0]], [a[2], a[0], a[1]], [a[2], a[1], a[0]]];
const mesh = (triangles, name = '') => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float64Array(triangles.flat(2)), 3));
  const m = new THREE.Mesh(geometry);
  m.name = name;
  return m;
};

test('coplanar overlap, containment, separation with overlapping AABBs, edge/vertex contact', () => {
  const cases = [
    [A, true],
    [[[0.1, 0.1, 0], [0.4, 0.1, 0], [0.1, 0.4, 0]], true],
    [[[1.1, 1.1, 0], [3, 1.1, 0], [1.1, 3, 0]], false],
    [[[0, 0, 0], [2, 0, 0], [1, -1, 0]], true],
    [[[2, 0, 0], [3, 0, 0], [2, 1, 0]], true],
    [[[3, 0, 0], [4, 0, 0], [3, 1, 0]], false],
  ];
  for (const [b, expected] of cases) for (const pa of permutations(A)) for (const pb of permutations(b)) {
    assert.equal(hit(pa, pb), expected);
    assert.equal(hit(pb, pa), expected);
    if (expected) assert.equal(triangleTriangleContact(pa, pb, { epsilon: 0 }).coplanar, true);
  }
});

test('noncoplanar crossing, disjoint with overlapping AABBs, vertex and edge touching', () => {
  const cases = [
    [[[0.5, 0.5, -1], [0.5, 0.5, 1], [1.5, 0.5, 0]], true],
    [[[1.5, 1.5, -1], [2, 1.5, 1], [1.5, 2, 1]], false],
    [[[2, 0, 0], [3, 0, 1], [2, -1, 1]], true],
    [[[0, 0, 0], [2, 0, 0], [1, -1, 1]], true],
  ];
  for (const [b, expected] of cases) for (const pa of permutations(A)) for (const pb of permutations(b)) {
    assert.equal(hit(pa, pb), expected);
    assert.equal(hit(pb, pa), expected);
  }
});

test('parallel planes, specified tolerance and oblique coplanar separation', () => {
  assert.equal(hit(A, translate(A, [0, 0, 0.001])), false);
  assert.equal(hit(A, translate(A, [0, 0, 1e-10])), false);
  const near = triangleTriangleContact(A, translate(A, [0, 0, 1e-10]));
  assert.equal(near.toleranceOnly, true);
  assert.ok(Math.abs(near.maxSeparatingGap - 1e-10) < 1e-15);
  const rotate = (t) => t.map(([x, y, z]) => [x, y, x + 2 * y + z]);
  assert.equal(hit(rotate(A), rotate([[1.1, 1.1, 0], [3, 1.1, 0], [1.1, 3, 0]])), false);
  assert.equal(hit(rotate(A), rotate([[0.1, 0.1, 0], [0.4, 0.1, 0], [0.1, 0.4, 0]])), true);
});

test('zero-area triangles are excluded but very small valid triangles survive', () => {
  assert.equal(hit(A, [[0, 0, 0], [0, 0, 0], [0, 0, 0]]), false);
  assert.equal(hit(A, [[0, 0, 0], [1, 1, 0], [2, 2, 0]]), false);
  const tiny = A.map((p) => p.map((x) => x * 1e-12));
  assert.equal(hit(tiny, tiny), true);
  const result = createWorldTriangles(mesh([A, [[0, 0, 0], [1, 1, 0], [2, 2, 0]]]));
  assert.equal(result.sourceTriangleCount, 2);
  assert.equal(result.triangles.length, 1);
  assert.equal(result.skippedDegenerate, 1);
});

test('Int16 normalized attributes decode before world transforms and remain unchanged', () => {
  const raw = new Int16Array([-32768, 0, 0, 32767, 0, 0, 0, 32767, 0]);
  const original = Array.from(raw);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(raw, 3, true));
  geometry.setIndex([0, 1, 2]);
  const m = new THREE.Mesh(geometry);
  m.position.set(10, -4, 2);
  m.scale.set(2, 3, 4);
  const parent = new THREE.Group();
  parent.position.set(-3, 8, 5);
  parent.add(m);
  const snapshot = createWorldTriangles(m);
  assert.deepEqual(snapshot.triangles[0].vertices, [[5, 4, 7], [9, 4, 7], [7, 7, 7]]);
  assert.deepEqual(Array.from(raw), original);
  assert.deepEqual(snapshot.triangles[0].vertexIndices, [0, 1, 2]);
  assert.equal(snapshot.triangles[0].triangleIndex, 0);
  // Updates must propagate from ancestors. Old snapshots stay pose-specific.
  parent.position.x += 100;
  const moved = createWorldTriangles(m);
  assert.equal(moved.bounds.min[0], 105);
  assert.equal(snapshot.bounds.min[0], 5);
  assert.equal(intersectMeshTriangles(snapshot, moved).intersects, false);
});

test('interleaved normalized attributes, rotations and reflected scales are decoded', () => {
  const geometry = new THREE.BufferGeometry();
  const data = new THREE.InterleavedBuffer(new Int16Array([123, 0, 0, 0, 123, 32767, 0, 0, 123, 0, 32767, 0]), 4);
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(data, 3, 1, true));
  const m = new THREE.Mesh(geometry);
  m.rotation.z = Math.PI / 2;
  m.scale.set(-2, 3, 1);
  const actual = createWorldTriangles(m).triangles[0].vertices;
  const expected = [[0, 0, 0], [0, -2, 0], [-3, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.ok(Math.abs(actual[i][j] - expected[i][j]) < 1e-14);
});

test('world AABB guard rejects impossible witnesses and witness data verifies independently', () => {
  const a = mesh([A], 'rod');
  const b = mesh([A], 'distant-cover');
  b.position.set(100, 0, 0);
  const miss = intersectMeshTriangles(a, b);
  assert.equal(miss.intersects, false);
  assert.equal(miss.stats.triangleSATTests, 0);
  b.position.set(0.5, 0.5, 0);
  const result = intersectMeshTriangles(a, b);
  assert.equal(result.intersects, true);
  assert.equal(result.witnesses.length, 1);
  const witness = result.witnesses[0];
  assert.equal(witness.meshA, 'rod');
  assert.equal(witness.meshB, 'distant-cover');
  assert.ok(boundsOverlap(witness.triangleA.bounds, witness.triangleB.bounds, 0));
  assert.ok(hit(witness.triangleA.vertices, witness.triangleB.vertices));
});

test('reject unsupported deformations and invalid options rather than silently auditing wrong geometry', () => {
  const m = mesh([A]);
  m.morphTargetInfluences = [0.2];
  assert.throws(() => createWorldTriangles(m), /Only rigid/);
  assert.throws(() => triangleTriangleContact(A, A, { epsilon: -1 }), /epsilon/);
  assert.throws(() => intersectMeshTriangles(mesh([A]), mesh([A]), { maxWitnesses: 0 }), /maxWitnesses/);
  assert.throws(() => triangleTriangleContact(A, [[NaN, 0, 0], [0, 1, 0], [1, 0, 0]]), /finite/);
});

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// Independent reference: segment/triangle intersection via determinant and
// barycentric coordinates, not SAT or the candidate production BVH.
function segmentHitsTriangle(p, q, t) {
  const direction = sub(q, p), e1 = sub(t[1], t[0]), e2 = sub(t[2], t[0]);
  const h = cross(direction, e2), determinant = dot(e1, h);
  if (Math.abs(determinant) < 1e-12) return false;
  const s = sub(p, t[0]), u = dot(s, h) / determinant;
  if (u < 0 || u > 1) return false;
  const r = cross(s, e1), v = dot(direction, r) / determinant;
  if (v < 0 || u + v > 1) return false;
  const along = dot(e2, r) / determinant;
  return along >= 0 && along <= 1;
}
function edgeOracle(a, b) {
  for (let i = 0; i < 3; i++) if (segmentHitsTriangle(a[i], a[(i + 1) % 3], b) || segmentHitsTriangle(b[i], b[(i + 1) % 3], a)) return true;
  return false;
}
function randomGenerator(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

test('10,000 seeded noncoplanar triangle pairs agree with independent segment/barycentric oracle', () => {
  const random = randomGenerator(0x719cc023);
  const randomTriangle = () => Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => 2 * random() - 1));
  let contacts = 0;
  for (let i = 0; i < 10000; i++) {
    const a = randomTriangle(), b = randomTriangle();
    const expected = edgeOracle(a, b);
    if (expected) contacts++;
    assert.equal(hit(a, b), expected, `random pair ${i}: ${JSON.stringify({ a, b })}`);
    assert.equal(hit(b, a), expected, `reverse random pair ${i}`);
  }
  assert.ok(contacts > 1000 && contacts < 5000);
});

test('BVH enumerates exactly the brute-force contact pair set and honors witness limits', () => {
  const random = randomGenerator(0xcab005e);
  const triangles = () => Array.from({ length: 60 }, () => {
    const center = [random() * 8, random() * 8, random() * 8];
    return Array.from({ length: 3 }, () => center.map((v) => v + random() * 2 - 1));
  });
  const ta = triangles(), tb = triangles();
  // Include a known noncoplanar intersection, plus a degenerate face to test
  // original triangle indices after degeneracy exclusion.
  ta.unshift([[0, 0, 0], [0, 0, 0], [0, 0, 0]], A);
  tb.unshift([[0.5, 0.5, -1], [0.5, 0.5, 1], [1.5, 0.5, 0]]);
  const brute = [];
  for (let i = 0; i < ta.length; i++) for (let j = 0; j < tb.length; j++) if (hit(ta[i], tb[j])) brute.push(`${i}:${j}`);
  const a = createWorldTriangles(mesh(ta), { leafSize: 3 });
  const b = createWorldTriangles(mesh(tb), { leafSize: 4 });
  const all = intersectMeshTriangles(a, b, { epsilon: 0, maxWitnesses: Infinity });
  assert.equal(all.exhausted, true);
  assert.equal(all.stats.skippedDegenerateA, 1);
  assert.deepEqual(all.witnesses.map((w) => `${w.triangleA.triangleIndex}:${w.triangleB.triangleIndex}`).sort(), brute.sort());
  assert.ok(all.stats.triangleSATTests < ta.length * tb.length / 4);
  const one = intersectMeshTriangles(a, b, { epsilon: 0 });
  assert.equal(one.intersects, true);
  assert.equal(one.witnesses.length, 1);
  assert.equal(one.exhausted, false);
});

test('AnimationMixer sampled matrixWorld changes affect rigid-mesh contacts', () => {
  const moving = mesh([A], 'moving');
  const fixed = mesh([A], 'fixed');
  const scene = new THREE.Group();
  scene.add(moving, fixed);
  const track = new THREE.VectorKeyframeTrack('moving.position', [0, 1], [0, 0, 0, 10, 0, 0]);
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(new THREE.AnimationClip('motion', 1, [track]));
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.setTime(0);
  assert.equal(intersectMeshTriangles(moving, fixed).intersects, true);
  mixer.setTime(0.9);
  const apart = intersectMeshTriangles(moving, fixed);
  assert.equal(apart.intersects, false);
  assert.equal(apart.stats.triangleSATTests, 0);
});
