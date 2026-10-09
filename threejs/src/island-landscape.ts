import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  ISLANDS,
  islandHeight,
  islandRadius,
  terrainNoise,
  forestCover,
  WATER_LEVEL,
} from './terrain';
import type { LandscapeQuality } from './environment';

export const ISLAND_PROFILES = {
  Low: { rings: 12, sectors: 48, water: 48, trees: 850 },
  Medium: { rings: 20, sectors: 64, water: 64, trees: 2650 },
  High: { rings: 28, sectors: 80, water: 96, trees: 4500 },
} as const;
const radii = (rings: number) =>
  [
    ...new Set([
      0,
      0.025,
      0.04,
      0.065,
      0.09,
      ...Array.from({ length: rings }, (_, i) => ((i + 1) / rings) * 0.86),
      0.93,
      1,
      1.08,
      1.18,
      1.3,
    ]),
  ].sort((a, b) => a - b);

function islandGeometry(quality: LandscapeQuality) {
  const profile = ISLAND_PROFILES[quality],
    rs = radii(profile.rings),
    sectors = profile.sectors;
  const positions: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  const forest = new T.Color(0x235c35),
    meadow = new T.Color(0x528440),
    sand = new T.Color(0xe1cf9b),
    rock = new T.Color(0x7b8375),
    color = new T.Color();
  for (const island of ISLANDS) {
    const start = positions.length / 3;
    for (let ring = 0; ring < rs.length; ring++)
      for (let sector = 0; sector <= sectors; sector++) {
        const angle = (sector / sectors) * Math.PI * 2;
        const edge = 1 + 0.09 * Math.sin(angle * 3 + island.phase) + 0.045 * Math.cos(angle * 5);
        const x = island.x + Math.cos(angle) * island.rx * rs[ring] * edge;
        const z = island.z + Math.sin(angle) * island.rz * rs[ring] * edge;
        const y = islandHeight(x, z);
        positions.push(x, y - 0.035, z);
        color.copy(meadow).lerp(forest, forestCover(x, z) * 0.8);
        color.lerp(rock, T.MathUtils.smoothstep(y, 48, 78) * 0.3);
        color.lerp(sand, 1 - T.MathUtils.smoothstep(y, 2.5, 9));
        color.multiplyScalar(0.92 + terrainNoise(x * 0.06, z * 0.06) * 0.12);
        color.toArray(colors, colors.length);
        if (ring < rs.length - 1 && sector < sectors) {
          const a = start + ring * (sectors + 1) + sector,
            b = a + sectors + 1;
          if (ring > 0) indices.push(a, a + 1, b);
          indices.push(a + 1, b + 1, b);
        }
      }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.userData = { radii: rs, sectors };
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Actual radial LOD triangle interpolation, used by tree bases and trail guards. */
export function islandSurface(geometry: T.BufferGeometry, x: number, z: number) {
  const vertices = geometry.attributes.position;
  const { radii: rs, sectors } = geometry.userData as { radii: number[]; sectors: number };
  let surface = -16.035;
  for (let islandIndex = 0; islandIndex < ISLANDS.length; islandIndex++) {
    const island = ISLANDS[islandIndex],
      radius = islandRadius(x, z, island);
    if (radius > 1.32) continue;
    const angle =
      (Math.atan2((z - island.z) / island.rz, (x - island.x) / island.rx) + Math.PI * 2) %
      (Math.PI * 2);
    const sector = Math.floor((angle / (Math.PI * 2)) * sectors);
    const ring = Math.max(0, rs.findIndex((r) => r > radius) - 1);
    const start = islandIndex * rs.length * (sectors + 1);
    for (let r = Math.max(0, ring - 1); r <= Math.min(rs.length - 2, ring + 1); r++) {
      for (let ds = -1; ds <= 1; ds++) {
        const s = (sector + ds + sectors) % sectors,
          a = start + r * (sectors + 1) + s,
          b = a + sectors + 1;
        for (const [i, j, k] of [
          [a, a + 1, b],
          [a + 1, b + 1, b],
        ]) {
          const ax = vertices.getX(i),
            az = vertices.getZ(i),
            bx = vertices.getX(j),
            bz = vertices.getZ(j),
            cx = vertices.getX(k),
            cz = vertices.getZ(k);
          const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
          if (Math.abs(denominator) < 1e-10) continue;
          const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator;
          const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator;
          if (u >= -0.00001 && v >= -0.00001 && u + v <= 1.00001)
            surface = Math.max(
              surface,
              u * vertices.getY(i) + v * vertices.getY(j) + (1 - u - v) * vertices.getY(k),
            );
        }
      }
    }
  }
  return surface;
}

function seaGeometry(quality: LandscapeQuality) {
  const n = ISLAND_PROFILES[quality].water;
  const geometry = new T.PlaneGeometry(10000, 10000, n, n)
    .rotateX(-Math.PI / 2)
    .translate(0, WATER_LEVEL, 0);
  const positions = geometry.attributes.position,
    colors = new Float32Array(positions.count * 3);
  const deep = new T.Color(0x145b98),
    shallow = new T.Color(0x43bdb6),
    color = new T.Color();
  for (let i = 0; i < positions.count; i++) {
    // Keep coastal sampling dense while carrying the ocean beyond the camera far plane.
    const extend = (value: number) =>
      Math.abs(value) <= 3500
        ? value
        : Math.sign(value) * (3500 + ((Math.abs(value) - 3500) * 13) / 3);
    const x = extend(positions.getX(i)),
      z = extend(positions.getZ(i));
    positions.setXYZ(i, x, WATER_LEVEL, z);
    let coast = 0;
    for (const island of ISLANDS)
      coast = Math.max(coast, 1 - T.MathUtils.smoothstep(islandRadius(x, z, island), 0.9, 1.7));
    color
      .copy(deep)
      .lerp(shallow, coast * 0.85)
      .toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

export function islandLandscape(parent: T.Group) {
  const group = new T.Group();
  group.name = 'Island_Archipelago';
  parent.add(group);
  let quality: LandscapeQuality = 'Medium',
    disposed = false,
    seed = 507;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const material = (color: number) => new T.MeshStandardMaterial({ color, roughness: 0.95 });
  const ground = new T.Mesh(
    islandGeometry(quality),
    new T.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
  );
  ground.name = 'Eleven_Islands_And_Sandy_Shores';
  ground.receiveShadow = true;
  const mountains = new T.Group();
  mountains.name = 'Island_Heightfield';
  mountains.add(ground);
  group.add(mountains);
  const water = new T.Mesh(
    seaGeometry(quality),
    new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.12 }),
  );
  water.name = 'Blue_Sea_And_Turquoise_Shallows';
  water.material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSea;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSea = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSea;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nfloat ripple = sin(vSea.x * 0.9 + sin(vSea.z * 0.37)) * sin(vSea.z * 0.71); diffuseColor.rgb *= 0.97 + ripple * 0.035;',
      );
  };
  group.add(water);
  const pad = new T.Mesh(new T.CylinderGeometry(6, 6, 0.08, 48), material(0x858d85));
  pad.position.y = -0.025;
  pad.receiveShadow = true;
  group.add(pad);
  const paintParts: T.BufferGeometry[] = [
    new T.RingGeometry(4.75, 4.86, 64).rotateX(-Math.PI / 2).translate(0, 0.017, 0),
  ];
  for (const [x, z, w, h] of [
    [-1, 0, 0.18, 2.3],
    [1, 0, 0.18, 2.3],
    [0, 0, 2, 0.18],
  ])
    paintParts.push(new T.PlaneGeometry(w, h).rotateX(-Math.PI / 2).translate(x, 0.019, z));
  group.add(new T.Mesh(mergeGeometries(paintParts), new T.MeshBasicMaterial({ color: 0xe6dfbb })));
  paintParts.forEach((g) => g.dispose());
  const trunks = new T.InstancedMesh(
    new T.CylinderGeometry(0.22, 0.32, 1, 3, 1, true),
    material(0x66533b),
    4500,
  );
  const crowns = new T.InstancedMesh(new T.OctahedronGeometry(1), material(0x39824b), 4500);
  trunks.name = 'Island_Tree_Trunks';
  crowns.name = 'Island_Broadleaf_Canopies';
  const bases = new Float32Array(4500 * 3),
    dummy = new T.Object3D(),
    color = new T.Color();
  for (let i = 0; i < 4500; i++) {
    const island = ISLANDS[i % ISLANDS.length];
    let x = 0,
      z = 0;
    for (let attempt = 0; attempt < 80; attempt++) {
      const angle = rand() * Math.PI * 2,
        radius = Math.sqrt(rand()) * 0.8;
      x = island.x + Math.cos(angle) * island.rx * radius;
      z = island.z + Math.sin(angle) * island.rz * radius;
      if (
        Math.hypot(x, z) > 29 &&
        islandHeight(x, z) > 3.2 &&
        rand() < 0.18 + forestCover(x, z) * 0.82
      )
        break;
    }
    // Deterministic valid fallback, never accept a failed candidate on a beach or pad.
    if (Math.hypot(x, z) <= 29 || islandHeight(x, z) <= 3.2) {
      x = island.x + island.rx * 0.22;
      z = island.z;
    }
    const near = Math.hypot(x, z) < 235;
    const height = Math.min(5 + rand() * 5, near ? Math.max(2, 16.5 - islandHeight(x, z)) : 10);
    bases.set([x, z, height], i * 3);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.position.set(x, 0, z);
    dummy.scale.set(1, height * 0.55, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.scale.set(height * (0.34 + rand() * 0.12), height * 0.38, height * (0.3 + rand() * 0.12));
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
    crowns.setColorAt(
      i,
      color.setHSL(0.25 + rand() * 0.1, 0.32 + rand() * 0.18, 0.38 + rand() * 0.19),
    );
  }
  group.add(trunks, crowns);
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>();
  group.traverse((object) => {
    if (object instanceof T.Mesh) {
      geometries.add(object.geometry);
      materials.add(object.material as T.Material);
    }
  });
  const seatTrees = () => {
    for (let i = 0; i < 4500; i++) {
      const [x, z, height] = bases.subarray(i * 3, i * 3 + 3),
        y = islandSurface(ground.geometry, x, z);
      trunks.instanceMatrix.array[i * 16 + 13] = y + height * 0.275;
      crowns.instanceMatrix.array[i * 16 + 13] = y + height * 0.62;
    }
    for (const mesh of [trunks, crowns]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  };
  const setQuality = (next: string) => {
    if (disposed || !Object.hasOwn(ISLAND_PROFILES, next)) return;
    const q = next as LandscapeQuality;
    if (q !== quality) {
      for (const [mesh, geometry] of [
        [ground, islandGeometry(q)],
        [water, seaGeometry(q)],
      ] as const) {
        const old = mesh.geometry;
        mesh.geometry = geometry;
        geometries.delete(old);
        old.dispose();
        geometries.add(geometry);
      }
      quality = q;
    }
    trunks.count = crowns.count = ISLAND_PROFILES[q].trees;
    seatTrees();
  };
  setQuality(quality);
  return {
    group,
    ground,
    mountains,
    setQuality,
    surfaceHeight(x: number, z: number) {
      return Math.max(WATER_LEVEL, islandHeight(x, z), islandSurface(ground.geometry, x, z));
    },
    get diagnostics() {
      let triangles = 0,
        drawCalls = 0,
        bufferBytes = bases.byteLength;
      for (const geometry of geometries) {
        for (const a of Object.values(geometry.attributes)) bufferBytes += a.array.byteLength;
        if (geometry.index) bufferBytes += geometry.index.array.byteLength;
      }
      for (const mesh of [trunks, crowns]) {
        bufferBytes += mesh.instanceMatrix.array.byteLength;
        if (mesh.instanceColor) bufferBytes += mesh.instanceColor.array.byteLength;
      }
      group.traverseVisible((object) => {
        if (!(object instanceof T.Mesh)) return;
        const count = object instanceof T.InstancedMesh ? object.count : 1;
        drawCalls += count ? 1 : 0;
        triangles +=
          ((object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3) * count;
      });
      return {
        quality,
        seed: 507,
        fictional: true,
        drawCalls,
        triangles,
        geometries: geometries.size,
        materials: materials.size,
        textures: 0,
        bufferBytes,
        trees: trunks.count,
        houses: 0,
        blocks: 0,
        settlements: 0,
        lakes: 0,
        islands: ISLANDS.length,
        disposed,
      };
    },
    dispose() {
      if (disposed) return;
      group.removeFromParent();
      trunks.dispose();
      crowns.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      disposed = true;
    },
  };
}
