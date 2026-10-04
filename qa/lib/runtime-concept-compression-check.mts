/** Load the optional asset exactly as the UI does, and compare its lossless decoded geometry. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const digest = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
async function load(path: string | URL) {
  const bytes = readFileSync(path);
  const json = JSON.parse(
    bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"),
  );
  const gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    );
  gltf.scene.updateMatrixWorld(true);
  return { bytes, json, gltf };
}
function meshMap(root: THREE.Object3D) {
  const meshes = new Map<string, THREE.Mesh>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    assert.equal(
      meshes.has(object.name),
      false,
      `duplicate mesh name ${object.name}`,
    );
    meshes.set(object.name, object);
  });
  return meshes;
}
/** Canonical triangle tokens permit a lossless vertex/index reorder while preserving winding and all attributes. */
function triangles(mesh: THREE.Mesh) {
  const geometry = mesh.geometry;
  const attributes = Object.entries(geometry.attributes).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  assert.ok(
    geometry.getAttribute("position").array instanceof Float32Array,
    `${mesh.name} must retain Float32 positions`,
  );
  const vertex = (index: number) =>
    attributes
      .map(
        ([name, attribute]) =>
          `${name}:${Array.from({ length: attribute.itemSize }, (_, component) => attribute.getComponent(index, component)).join(",")}`,
      )
      .join(";");
  const tokens = [];
  const count =
    geometry.index?.count ?? geometry.getAttribute("position").count;
  assert.equal(count % 3, 0);
  for (let i = 0; i < count; i += 3) {
    const a = vertex(geometry.index?.getX(i) ?? i);
    const b = vertex(geometry.index?.getX(i + 1) ?? i + 1);
    const c = vertex(geometry.index?.getX(i + 2) ?? i + 2);
    tokens.push(
      [`${a}|${b}|${c}`, `${b}|${c}|${a}`, `${c}|${a}|${b}`].sort()[0],
    );
  }
  return { count: tokens.length, digest: digest(tokens.sort().join("\n")) };
}
function materialSignature(material: THREE.Material | THREE.Material[]) {
  return (Array.isArray(material) ? material : [material]).map((m) => {
    const standard = m as THREE.MeshStandardMaterial;
    return {
      name: m.name,
      type: m.type,
      side: m.side,
      opacity: m.opacity,
      transparent: m.transparent,
      color: standard.color?.toArray(),
      emissive: standard.emissive?.toArray(),
      emissiveIntensity: standard.emissiveIntensity,
      roughness: standard.roughness,
      metalness: standard.metalness,
    };
  });
}
export async function checkConceptCompression(
  sourcePath: string | URL,
  runtimePath: string | URL = new URL(
    "../../public/models/nacelle-system-concept.glb",
    import.meta.url,
  ),
) {
  const [source, runtime] = await Promise.all([
    load(sourcePath),
    load(runtimePath),
  ]);
  assert.ok(runtime.json.extensionsUsed?.includes("EXT_meshopt_compression"));
  assert.ok(
    runtime.json.extensionsRequired?.includes("EXT_meshopt_compression"),
  );
  assert.ok(
    runtime.json.bufferViews.some(
      (view: { extensions?: { EXT_meshopt_compression?: unknown } }) =>
        view.extensions?.EXT_meshopt_compression,
    ),
  );
  assert.equal(
    runtime.json.extensionsUsed?.includes("KHR_mesh_quantization") ?? false,
    false,
  );
  assert.equal(runtime.gltf.animations.length, source.gltf.animations.length);
  const before = meshMap(source.gltf.scene),
    after = meshMap(runtime.gltf.scene);
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort());
  const comparisons = [];
  for (const [name, mesh] of before) {
    const compressed = after.get(name)!;
    assert.deepEqual(
      compressed.matrixWorld.elements,
      mesh.matrixWorld.elements,
      `${name} world transform`,
    );
    const original = triangles(mesh),
      decoded = triangles(compressed);
    assert.deepEqual(
      decoded,
      original,
      `${name} exact triangle positions/normals/all attributes`,
    );
    assert.deepEqual(
      materialSignature(compressed.material),
      materialSignature(mesh.material),
      `${name} materials`,
    );
    comparisons.push({
      name,
      triangles: decoded.count,
      semanticGeometrySha256: decoded.digest,
      unchanged: true,
    });
  }
  const bounds = new THREE.Box3().setFromObject(runtime.gltf.scene);
  const expectedBounds = new THREE.Box3().setFromObject(source.gltf.scene);
  assert.deepEqual(bounds.min.toArray(), expectedBounds.min.toArray());
  assert.deepEqual(bounds.max.toArray(), expectedBounds.max.toArray());
  return {
    passed: true,
    evidenceType:
      "Three.js GLTFLoader + explicit MeshoptDecoder, exact decoded triangle/attribute/winding/transform/material comparison; no browser claim",
    sourceSha256: digest(source.bytes),
    runtimeSha256: digest(runtime.bytes),
    sourceBytes: source.bytes.byteLength,
    runtimeBytes: runtime.bytes.byteLength,
    meshCount: after.size,
    triangles: comparisons.reduce((sum, row) => sum + row.triangles, 0),
    meshopt: true,
    float32Positions: true,
    quantized: false,
    lazyLoaderUsesExplicitMeshoptDecoder: true,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    comparisons,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const report = await checkConceptCompression(
    process.argv[2] ?? "assets/blender/nacelle-system-concept-source.glb",
  );
  if (process.argv[3])
    writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
