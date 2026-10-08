import * as T from 'three';

/** For uncached, exclusively-owned GLTF instances. Shared resources are deduplicated. */
export function disposeObjectTree(root: T.Object3D, extraMaterials: Iterable<T.Material> = []) {
  const geometries = new Set<T.BufferGeometry>();
  const materials = new Set<T.Material>(extraMaterials);
  const textures = new Set<T.Texture>();
  root.traverse((object) => {
    if (!(object instanceof T.Mesh || object instanceof T.Line || object instanceof T.Points))
      return;
    if (object.geometry) geometries.add(object.geometry);
    const values = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of values) {
      materials.add(material);
    }
  });
  for (const material of materials) {
    for (const value of Object.values(material))
      if (value instanceof T.Texture) textures.add(value);
  }
  geometries.forEach((geometry) => geometry.dispose());
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  root.removeFromParent();
  root.clear();
}
