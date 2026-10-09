/**
 * Independent, double-precision triangle-surface contact audit.
 *
 * No three-mesh-bvh narrow phase is used. The SAT tests both face normals,
 * all nine edge/edge cross products, and in-plane edge normals. The last
 * axes are essential for coplanar triangles. Touching is contact, within
 * epsilon (world units). This is NOT a solid-containment or clearance test.
 *
 * Quantized/normalized glTF positions are decoded with getX/getY/getZ before
 * applying matrixWorld. Never transform a normalized integer attribute in
 * place: doing so writes the float results back into quantized storage.
 *
 * After AnimationMixer.setTime(), create a fresh snapshot for moving meshes.
 * A snapshot intentionally owns immutable world coordinates from that pose;
 * it is never implicitly cached. Static-mesh snapshots can be reused.
 * Skinned, instanced and actively morphed meshes are rejected explicitly.
 */

const DEFAULT_EPSILON = 1e-9;
const DEFAULT_DEGENERATE_EPSILON = 64 * Number.EPSILON;
const SNAPSHOT = Symbol('world-triangle-snapshot');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a) => {
  const length = Math.hypot(...a);
  return length === 0 ? null : a.map((v) => v / length);
};
const emptyBounds = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const extendBounds = (bounds, point) => {
  for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
    bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
  }
};
const boundsOf = (points) => {
  const bounds = emptyBounds();
  for (const point of points) extendBounds(bounds, point);
  return bounds;
};

/** A necessary condition, including an explicit world-space gap tolerance. */
export function boundsOverlap(a, b, epsilon = DEFAULT_EPSILON) {
  for (let axis = 0; axis < 3; axis++) {
    if (a.max[axis] < b.min[axis] - epsilon || b.max[axis] < a.min[axis] - epsilon) return false;
  }
  return true;
}

function validateOptions(options) {
  const epsilon = options.epsilon ?? DEFAULT_EPSILON;
  const degenerateEpsilon = options.degenerateEpsilon ?? DEFAULT_DEGENERATE_EPSILON;
  if (!Number.isFinite(epsilon) || epsilon < 0) throw new RangeError('epsilon must be finite and nonnegative');
  if (!Number.isFinite(degenerateEpsilon) || degenerateEpsilon < 0) throw new RangeError('degenerateEpsilon must be finite and nonnegative');
  return { epsilon, degenerateEpsilon };
}

function prepareTriangle(vertices, degenerateEpsilon, triangleIndex = null, vertexIndices = null) {
  if (!Array.isArray(vertices) || vertices.length !== 3) throw new TypeError('A triangle requires three [x,y,z] vertices');
  const points = vertices.map((p) => {
    if (!p || p.length !== 3 || !Array.from(p).every(Number.isFinite)) throw new TypeError('Triangle vertices must be finite [x,y,z] coordinates');
    return Array.from(p);
  });
  const edges = [sub(points[1], points[0]), sub(points[2], points[1]), sub(points[0], points[2])];
  const longestEdge = Math.max(...edges.map((e) => Math.hypot(...e)));
  // Scale first so a small valid triangle is not mistaken for a degenerate
  // one, and a large triangle does not overflow the area calculation.
  const scaledEdges = longestEdge === 0 ? edges : edges.map((e) => e.map((v) => v / longestEdge));
  const rawNormal = cross(scaledEdges[0], scaledEdges[1]);
  const normalLength = Math.hypot(...rawNormal);
  const degenerate = longestEdge === 0 || normalLength <= degenerateEpsilon;
  return {
    vertices: points,
    triangleIndex,
    vertexIndices,
    bounds: boundsOf(points),
    edges: degenerate ? [] : edges.map(unit),
    normal: degenerate ? null : rawNormal.map((v) => v / normalLength),
    degenerate,
  };
}

function project(vertices, axis, origin) {
  let min = Infinity;
  let max = -Infinity;
  for (const vertex of vertices) {
    const value = dot(sub(vertex, origin), axis);
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

function satContact(a, b, epsilon) {
  if (a.degenerate || b.degenerate || !boundsOverlap(a.bounds, b.bounds, epsilon)) return null;
  const origin = a.vertices[0];
  let maxSeparatingGap = -Infinity;
  let testedAxes = 0;
  const separated = (candidate) => {
    const axis = unit(candidate);
    // An exactly parallel edge pair supplies no separating direction.
    if (!axis) return false;
    testedAxes++;
    const pa = project(a.vertices, axis, origin);
    const pb = project(b.vertices, axis, origin);
    const gap = Math.max(pb.min - pa.max, pa.min - pb.max);
    maxSeparatingGap = Math.max(maxSeparatingGap, gap);
    return gap > epsilon;
  };
  if (separated(a.normal) || separated(b.normal)) return null;
  for (const ea of a.edges) for (const eb of b.edges) if (separated(cross(ea, eb))) return null;
  // Required coplanar case: normal/normal and edge/edge axes alone cannot
  // separate two disjoint triangles lying in the same plane.
  for (const edge of a.edges) if (separated(cross(a.normal, edge))) return null;
  for (const edge of b.edges) if (separated(cross(b.normal, edge))) return null;
  const parallel = Math.hypot(...cross(a.normal, b.normal)) <= DEFAULT_DEGENERATE_EPSILON;
  const coplanar = parallel && b.vertices.every((v) => Math.abs(dot(sub(v, origin), a.normal)) <= epsilon);
  return { coplanar, epsilon, maxSeparatingGap, toleranceOnly: maxSeparatingGap > 0, testedAxes };
}

/**
 * Return SAT details for a contact, or null for disjoint/degenerate triangles.
 * Arguments are three-element arrays of [x,y,z], with no Three dependency.
 * epsilon=0 requests literal double-precision contact without a gap allowance.
 */
export function triangleTriangleContact(verticesA, verticesB, options = {}) {
  const { epsilon, degenerateEpsilon } = validateOptions(options);
  return satContact(prepareTriangle(verticesA, degenerateEpsilon), prepareTriangle(verticesB, degenerateEpsilon), epsilon);
}

function buildBVH(triangles, indices, leafSize) {
  const bounds = emptyBounds();
  for (const i of indices) {
    extendBounds(bounds, triangles[i].bounds.min);
    extendBounds(bounds, triangles[i].bounds.max);
  }
  if (indices.length <= leafSize) return { bounds, indices };
  const extents = bounds.max.map((v, i) => v - bounds.min[i]);
  const axis = extents.indexOf(Math.max(...extents));
  indices.sort((i, j) => (triangles[i].bounds.min[axis] + triangles[i].bounds.max[axis]) - (triangles[j].bounds.min[axis] + triangles[j].bounds.max[axis]));
  const middle = Math.floor(indices.length / 2);
  return {
    bounds,
    left: buildBVH(triangles, indices.slice(0, middle), leafSize),
    right: buildBVH(triangles, indices.slice(middle), leafSize),
  };
}

/**
 * Decode a rigid Three Mesh into a fresh world-space triangle snapshot.
 * Call once per moving mesh per sampled pose, then reuse it across pairs.
 * Full geometry is audited, including beyond drawRange/material visibility.
 * Invalid positions/indices throw; zero-area triangles are counted and skipped.
 */
export function createWorldTriangles(mesh, options = {}) {
  const { degenerateEpsilon } = validateOptions(options);
  const leafSize = options.leafSize ?? 8;
  if (!Number.isInteger(leafSize) || leafSize < 1) throw new RangeError('leafSize must be a positive integer');
  if (!mesh?.isMesh || !mesh.geometry?.attributes?.position) throw new TypeError('Expected a Three Mesh with position geometry');
  if (mesh.isSkinnedMesh || mesh.isInstancedMesh || mesh.morphTargetInfluences?.some((v) => v !== 0)) {
    throw new TypeError('Only rigid, noninstanced, unmorphed meshes are supported; bake deformations before auditing');
  }
  mesh.updateWorldMatrix(true, false);
  const matrix = mesh.matrixWorld.elements;
  if (!matrix || matrix.length !== 16 || !Array.from(matrix).every(Number.isFinite)) throw new TypeError('Invalid matrixWorld');
  const position = mesh.geometry.attributes.position;
  if (position.itemSize < 3) throw new TypeError('Position attribute must contain x, y and z');
  const worldVertices = Array.from({ length: position.count }, (_, i) => {
    // BufferAttribute and InterleavedBufferAttribute accessors explicitly decode
    // normalized Int16/Uint16 data to floats before the affine transform.
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    if (!Number.isFinite(w) || w === 0) throw new TypeError('Invalid homogeneous vertex coordinate');
    const point = [
      (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
      (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
      (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w,
    ];
    if (!point.every(Number.isFinite)) throw new TypeError(`Nonfinite vertex ${i}`);
    return point;
  });
  const index = mesh.geometry.index;
  const count = index ? index.count : position.count;
  if (count % 3 !== 0) throw new TypeError('Triangle geometry index/vertex count must be divisible by three');
  const triangles = [];
  let skippedDegenerate = 0;
  for (let offset = 0; offset < count; offset += 3) {
    const ids = [0, 1, 2].map((d) => index ? index.getX(offset + d) : offset + d);
    if (ids.some((i) => !Number.isInteger(i) || i < 0 || i >= worldVertices.length)) throw new TypeError(`Invalid vertex index at triangle ${offset / 3}`);
    const triangle = prepareTriangle(ids.map((i) => worldVertices[i]), degenerateEpsilon, offset / 3, ids);
    if (triangle.degenerate) skippedDegenerate++;
    else triangles.push(triangle);
  }
  const bvh = triangles.length ? buildBVH(triangles, triangles.map((_, i) => i), leafSize) : null;
  return {
    [SNAPSHOT]: true,
    name: mesh.name || mesh.uuid || '(unnamed mesh)',
    uuid: mesh.uuid ?? null,
    triangles,
    bounds: bvh?.bounds ?? emptyBounds(),
    bvh,
    sourceTriangleCount: count / 3,
    skippedDegenerate,
    matrixWorld: Array.from(matrix),
  };
}

function witnessTriangle(triangle) {
  return {
    triangleIndex: triangle.triangleIndex,
    vertexIndices: [...triangle.vertexIndices],
    vertices: triangle.vertices.map((v) => [...v]),
    bounds: { min: [...triangle.bounds.min], max: [...triangle.bounds.max] },
  };
}

/**
 * Return { intersects, witnesses, stats, exhausted } for meshes or snapshots.
 * Every witness contains concrete world-space triangles, source indices and
 * SAT details. maxWitnesses defaults to 1; Infinity enumerates every contact.
 * exhausted=false means traversal stopped on reaching the requested cap.
 */
export function intersectMeshTriangles(meshOrSnapshotA, meshOrSnapshotB, options = {}) {
  const { epsilon } = validateOptions(options);
  const maxWitnesses = options.maxWitnesses ?? 1;
  if (maxWitnesses !== Infinity && (!Number.isInteger(maxWitnesses) || maxWitnesses < 1)) throw new RangeError('maxWitnesses must be a positive integer or Infinity');
  const a = meshOrSnapshotA?.[SNAPSHOT] ? meshOrSnapshotA : createWorldTriangles(meshOrSnapshotA, options);
  const b = meshOrSnapshotB?.[SNAPSHOT] ? meshOrSnapshotB : createWorldTriangles(meshOrSnapshotB, options);
  const witnesses = [];
  const stats = {
    nodePairs: 0,
    triangleBoundsTests: 0,
    triangleSATTests: 0,
    sourceTrianglesA: a.sourceTriangleCount,
    sourceTrianglesB: b.sourceTriangleCount,
    skippedDegenerateA: a.skippedDegenerate,
    skippedDegenerateB: b.skippedDegenerate,
  };
  const stack = a.bvh && b.bvh ? [[a.bvh, b.bvh]] : [];
  let exhausted = true;
  search: while (stack.length) {
    const [na, nb] = stack.pop();
    stats.nodePairs++;
    if (!boundsOverlap(na.bounds, nb.bounds, epsilon)) continue;
    if (na.indices && nb.indices) {
      for (const ia of na.indices) for (const ib of nb.indices) {
        const ta = a.triangles[ia], tb = b.triangles[ib];
        stats.triangleBoundsTests++;
        if (!boundsOverlap(ta.bounds, tb.bounds, epsilon)) continue;
        stats.triangleSATTests++;
        const contact = satContact(ta, tb, epsilon);
        if (!contact) continue;
        witnesses.push({ meshA: a.name, meshB: b.name, triangleA: witnessTriangle(ta), triangleB: witnessTriangle(tb), ...contact });
        if (witnesses.length >= maxWitnesses) {
          exhausted = false;
          break search;
        }
      }
    } else if (na.indices) {
      stack.push([na, nb.left], [na, nb.right]);
    } else if (nb.indices) {
      stack.push([na.left, nb], [na.right, nb]);
    } else {
      // Split only the node with the wider box, avoiding four children at once.
      const extentA = Math.max(...na.bounds.max.map((v, i) => v - na.bounds.min[i]));
      const extentB = Math.max(...nb.bounds.max.map((v, i) => v - nb.bounds.min[i]));
      if (extentA >= extentB) stack.push([na.left, nb], [na.right, nb]);
      else stack.push([na, nb.left], [na, nb.right]);
    }
  }
  return { intersects: witnesses.length > 0, witnesses, stats, exhausted, epsilon, meshA: a.name, meshB: b.name };
}
