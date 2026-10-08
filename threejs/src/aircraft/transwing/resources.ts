import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/** Per-instance ownership. A late GLTF can be released without touching another aircraft. */
export class OwnedResources {
  private geometries = new Set<THREE.BufferGeometry>();
  private materials = new Set<THREE.Material>();
  private textures = new Set<THREE.Texture>();
  private disposed = false;
  capture(root: THREE.Object3D) {
    if (this.disposed) throw new Error('Resource owner already disposed');
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) this.geometries.add(mesh.geometry);
      if (!mesh.material) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        this.materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) this.textures.add(value);
      }
    });
  }
  describe() {
    return {
      disposed: this.disposed,
      geometries: this.geometries.size,
      materials: this.materials.size,
      textures: this.textures.size,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
  }
}

/** fetch is abortable; GLTF parse isn't, so discard and release every late parse. */
export async function loadOwnedGLTF(url: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Transwing 模型加载失败 (${response.status})`);
  const bytes = await response.arrayBuffer();
  signal.throwIfAborted();
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(bytes, new URL('.', new URL(url, location.href)).href);
  const resources = new OwnedResources();
  for (const scene of gltf.scenes) resources.capture(scene);
  if (signal.aborted) {
    resources.dispose();
    signal.throwIfAborted();
  }
  return { scene: gltf.scene, resources };
}
