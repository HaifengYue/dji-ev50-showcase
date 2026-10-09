import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  groundHeight,
  terrainNoise,
  forestCover,
  riverX,
  riverWidth,
  arterialX,
  lakeRadius,
  settlementDistance,
  SETTLEMENTS,
  LAKES,
  WATER_LEVEL,
  LANDSCAPE_EXTENT,
} from './terrain';

export type LandscapeQuality = 'Low' | 'Medium' | 'High';
export const LANDSCAPE_PROFILES = {
  Low: { rows: 64, sideColumns: 32, trees: 850, rocks: 60, grass: 180, houses: 110, blocks: 20 },
  Medium: {
    rows: 112,
    sideColumns: 56,
    trees: 2650,
    rocks: 150,
    grass: 600,
    houses: 240,
    blocks: 48,
  },
  High: {
    rows: 176,
    sideColumns: 88,
    trees: 4500,
    rocks: 320,
    grass: 1300,
    houses: 400,
    blocks: 100,
  },
} as const;
const rowZ = (index: number, rows: number) => {
  const t = (index / rows) * 2 - 1;
  return Math.sign(t) * LANDSCAPE_EXTENT * Math.abs(t) ** 1.3;
};

/** Landmarks retain their footprint even in Low: LOD only coarsens the spaces between them. */
function terrainRows(quality: LandscapeQuality) {
  const count = LANDSCAPE_PROFILES[quality].rows;
  const rows = new Set(Array.from({ length: count + 1 }, (_, i) => rowZ(i, count)));
  for (const z of [-28, -20, -12, -6, 0, 6, 12, 20, 28]) rows.add(z);
  for (const site of SETTLEMENTS)
    for (const offset of [-1, 0, 1]) rows.add(site.z + offset * (site.rows * 9 + 14));
  for (const lake of LAKES)
    for (const offset of [-1, -0.6, 0, 0.6, 1]) rows.add(lake.z + offset * lake.rz);
  return [...rows].sort((a, b) => a - b);
}

/** One continuous, fictional heightfield. River vertices have explicit bank/bed columns. */
function makeTerrain(quality: LandscapeQuality) {
  const sides = LANDSCAPE_PROFILES[quality].sideColumns;
  const zs = terrainRows(quality),
    rows = zs.length - 1;
  const columns = sides * 2 + 9 + 17;
  const positions = new Float32Array((rows + 1) * columns * 3);
  const colors = new Float32Array(positions.length);
  const uv = new Float32Array((rows + 1) * columns * 2);
  const indices = new Uint32Array(rows * (columns - 1) * 6);
  const meadow = new T.Color(0x27592e),
    dry = new T.Color(0x56803b),
    rock = new T.Color(0x657064),
    woodland = new T.Color(0x173d25),
    bank = new T.Color(0xb8ab8c),
    color = new T.Color();
  const bankOffsets = [-1.8, -1.25, -1, -0.6, 0, 0.6, 1, 1.25, 1.8];
  for (let row = 0; row <= rows; row++) {
    const z = zs[row],
      center = riverX(z),
      width = riverWidth(z);
    const xs: number[] = [-28, -20, -12, -6, 0, 6, 12, 20, 28];
    const site = SETTLEMENTS.reduce((best, next) =>
      Math.abs(next.z - z) < Math.abs(best.z - z) ? next : best,
    );
    xs.push(site.x - 80, site.x - 65, site.x, site.x + 65, site.x + 80);
    const lake = LAKES.reduce((best, next) =>
      Math.abs(next.z - z) < Math.abs(best.z - z) ? next : best,
    );
    const lakeEdge = (side: number) => {
      if (lakeRadius(lake.x, z, lake) >= 0.9) return lake.x + side * lake.rx * 0.9;
      let inner = 0,
        outer = lake.rx * 1.2;
      for (let step = 0; step < 20; step++) {
        const mid = (inner + outer) / 2;
        if (lakeRadius(lake.x + side * mid, z, lake) > 0.9) outer = mid;
        else inner = mid;
      }
      return lake.x + side * inner;
    };
    xs.push(lakeEdge(-1), lake.x, lakeEdge(1));
    for (let column = 0; column < sides; column++)
      xs.push(
        center -
          width * 1.8 -
          (LANDSCAPE_EXTENT + center - width * 1.8) * ((sides - column) / sides) ** 1.65,
      );
    for (const offset of bankOffsets) xs.push(center + offset * width);
    for (let column = 1; column <= sides; column++)
      xs.push(
        center + width * 1.8 + (LANDSCAPE_EXTENT - center - width * 1.8) * (column / sides) ** 1.65,
      );
    xs.sort((a, b) => a - b);
    for (let column = 0; column < columns; column++) {
      const x = xs[column];
      const h = groundHeight(x, z),
        index = row * columns + column;
      positions.set([x, h - 0.035, z], index * 3);
      uv.set(
        [
          (x + LANDSCAPE_EXTENT) / (LANDSCAPE_EXTENT * 2),
          (z + LANDSCAPE_EXTENT) / (LANDSCAPE_EXTENT * 2),
        ],
        index * 2,
      );
      const slope =
        Math.hypot(
          groundHeight(x + 3, z) - groundHeight(x - 3, z),
          groundHeight(x, z + 3) - groundHeight(x, z - 3),
        ) / 6;
      color.copy(meadow).lerp(dry, 0.12 + terrainNoise(x * 0.009, z * 0.009) * 0.35);
      color.lerp(woodland, forestCover(x, z) * 0.78);
      // Green low mountains, with restrained rock only along the steeper ridges.
      color.lerp(rock, Math.min(0.48, slope * 0.3 + T.MathUtils.smoothstep(h, 75, 112) * 0.12));
      const riverDistance = Math.abs(x - center) / width;
      let shore = 1 - T.MathUtils.smoothstep(riverDistance, 1.25, 2.25);
      for (const lake of LAKES)
        shore = Math.max(shore, 1 - T.MathUtils.smoothstep(lakeRadius(x, z, lake), 0.96, 1.16));
      color.lerp(bank, shore * 0.72);
      color.multiplyScalar(0.92 + terrainNoise(x * 0.07, z * 0.07) * 0.14);
      color.toArray(colors, index * 3);
      if (row < rows && column < columns - 1) {
        const a = index,
          offset = (row * (columns - 1) + column) * 6;
        indices.set([a, a + columns, a + 1, a + 1, a + columns, a + columns + 1], offset);
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.userData = { rows, columns };
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
  geometry.setIndex(new T.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Barycentric height of the displayed LOD, used to seat scenery on its actual triangles. */
function terrainSurface(geometry: T.BufferGeometry, x: number, z: number) {
  const positions = geometry.getAttribute('position');
  const { rows, columns } = geometry.userData as { rows: number; columns: number };
  let first = 0,
    last = rows;
  while (last - first > 1) {
    const mid = Math.floor((first + last) / 2);
    if (positions.getZ(mid * columns) > z) last = mid;
    else first = mid;
  }
  const row = Math.min(rows - 1, first);
  const z0 = positions.getZ(row * columns),
    z1 = positions.getZ((row + 1) * columns),
    t = (z - z0) / (z1 - z0);
  let left = 0,
    right = columns - 1;
  while (right - left > 1) {
    const mid = Math.floor((left + right) / 2);
    const px =
      positions.getX(row * columns + mid) * (1 - t) + positions.getX((row + 1) * columns + mid) * t;
    if (px > x) right = mid;
    else left = mid;
  }
  const a = row * columns + left;
  for (let triangle = 0; triangle < 2; triangle++) {
    const i = triangle ? a + 1 : a,
      j = a + columns,
      k = triangle ? a + columns + 1 : a + 1;
    const ax = positions.getX(i),
      az = positions.getZ(i),
      bx = positions.getX(j),
      bz = positions.getZ(j),
      cx = positions.getX(k),
      cz = positions.getZ(k);
    const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator;
    const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator;
    if (u >= -0.0001 && v >= -0.0001 && u + v <= 1.0001)
      return u * positions.getY(i) + v * positions.getY(j) + (1 - u - v) * positions.getY(k);
  }
  return groundHeight(x, z) - 0.035;
}

function makeWater(quality: LandscapeQuality) {
  const positions: number[] = [],
    indices: number[] = [],
    zs = terrainRows(quality),
    rows = zs.length - 1;
  for (let row = 0; row <= rows; row++) {
    const z = zs[row],
      center = riverX(z),
      width = riverWidth(z);
    // Matches the terrain's river columns; no hovering ribbon over uncarved hills.
    positions.push(center - width * 1.04, WATER_LEVEL, z, center + width * 1.04, WATER_LEVEL, z);
    if (row < rows) {
      const a = row * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  for (const lake of LAKES) {
    const start = positions.length / 3;
    positions.push(lake.x, WATER_LEVEL, lake.z);
    for (let i = 0; i <= 80; i++) {
      const angle = (i / 80) * Math.PI * 2,
        radius = 0.94 * (1 + 0.075 * Math.sin(angle * 3) + 0.045 * Math.sin(angle * 7 + 1));
      positions.push(
        lake.x + Math.cos(angle) * lake.rx * radius,
        WATER_LEVEL,
        lake.z + Math.sin(angle) * lake.rz * radius,
      );
      if (i < 80) indices.push(start, start + i + 2, start + i + 1);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Discrete quality geometry is rebuilt only on a quality change; all placements use seed 50. */
export function environment(scene: T.Scene) {
  const group = new T.Group();
  group.name = 'Procedural_Valley_Landscape';
  scene.add(group);
  let seed = 50,
    quality: LandscapeQuality = 'Medium',
    disposed = false;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const mat = (color: number) => new T.MeshStandardMaterial({ color, roughness: 0.92 });
  const dummy = new T.Object3D(),
    tempColor = new T.Color();
  const box = new T.BoxGeometry(1, 1, 1);
  const put = (
    mesh: T.InstancedMesh,
    i: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    yaw = 0,
  ) => {
    dummy.position.set(x, y, z);
    dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(0, yaw, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  };
  const pixels = new Uint8Array(128 * 128 * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    const value = 216 + rand() * 35;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
    pixels[i + 3] = 255;
  }
  const detail = new T.DataTexture(pixels, 128, 128);
  detail.colorSpace = T.SRGBColorSpace;
  detail.wrapS = detail.wrapT = T.RepeatWrapping;
  detail.repeat.set(110, 110);
  detail.magFilter = T.LinearFilter;
  detail.minFilter = T.LinearMipmapLinearFilter;
  detail.generateMipmaps = true;
  detail.anisotropy = 2;
  detail.needsUpdate = true;
  const ground = new T.Mesh(
    makeTerrain(quality),
    new T.MeshStandardMaterial({
      map: detail,
      bumpMap: detail,
      bumpScale: 0.1,
      vertexColors: true,
      roughness: 1,
    }),
  );
  ground.name = 'Continuous_Mountains_And_Riverbed';
  ground.receiveShadow = true;
  const mountains = new T.Group();
  mountains.name = 'Mountain_Heightfield';
  mountains.add(ground);
  group.add(mountains);
  const water = new T.Mesh(
    makeWater(quality),
    new T.MeshStandardMaterial({
      color: 0x3d7a87,
      roughness: 0.23,
      metalness: 0.28,
      envMapIntensity: 0.75,
    }),
  );
  water.name = 'Connected_River_And_Two_Lakes';
  water.material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWaterPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWaterPosition = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWaterPosition;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nfloat ripple = sin(vWaterPosition.x * 1.4 + sin(vWaterPosition.z * 0.43)) * sin(vWaterPosition.z * 0.78); diffuseColor.rgb *= 0.96 + ripple * 0.035;',
      );
  };
  group.add(water);

  // Preserve the existing landing-pad footprint and ground origin.
  const pad = new T.Mesh(new T.CylinderGeometry(6, 6, 0.08, 48), mat(0x858d85));
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
  const paint = new T.Mesh(
    mergeGeometries(paintParts),
    new T.MeshBasicMaterial({ color: 0xe6dfbb }),
  );
  group.add(paint);
  paintParts.forEach((part) => part.dispose());
  const padLights = new T.InstancedMesh(
    new T.CylinderGeometry(0.07, 0.11, 0.14, 6),
    new T.MeshStandardMaterial({ color: 0xe6be6c, emissive: 0xeab35c, emissiveIntensity: 0.4 }),
    12,
  );
  for (let i = 0; i < 12; i++)
    put(
      padLights,
      i,
      Math.cos((i * Math.PI) / 6) * 5.65,
      0.07,
      Math.sin((i * Math.PI) / 6) * 5.65,
      1,
      1,
      1,
    );
  group.add(padLights);

  const valley = new T.Group();
  valley.name = 'Eight_Connected_Settlements';
  group.add(valley);
  const walls = new T.InstancedMesh(box, mat(0xd0c3a6), 400),
    blocks = new T.InstancedMesh(box, mat(0xadb7b5), 100);
  // Gable roofs, rather than pyramids: six triangles per roof, shared by every house.
  const roofGeometry = new T.BufferGeometry();
  roofGeometry.setAttribute(
    'position',
    new T.Float32BufferAttribute(
      [-0.56, 0, -0.56, 0.56, 0, -0.56, 0, 0.4, -0.56, -0.56, 0, 0.56, 0.56, 0, 0.56, 0, 0.4, 0.56],
      3,
    ),
  );
  roofGeometry.setIndex([0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 2, 5, 4, 2, 4, 1]);
  roofGeometry.computeVertexNormals();
  const roofs = new T.InstancedMesh(roofGeometry, mat(0x8c6756), 400);
  let houseCount = 0,
    blockCount = 0;
  // Interleaving districts keeps all towns represented at every quality setting.
  for (let slot = 0; slot < 63; slot++)
    for (const site of SETTLEMENTS) {
      if (slot >= site.rows * 7) continue;
      const col = (slot % 7) - 3,
        row = Math.floor(slot / 7) - (site.rows - 1) / 2;
      const x = site.x + col * 18,
        z = site.z + row * 18;
      const sx = 7 + rand() * 4,
        sz = 7 + rand() * 4;
      if (site.town && slot % 4 === 1 && blockCount < 100) {
        const sy = 7 + rand() * 19;
        put(blocks, blockCount, x, site.elevation + sy / 2, z, sx, sy, sz);
        blocks.setColorAt(
          blockCount++,
          tempColor.setHSL(0.12 + rand() * 0.05, 0.09, 0.64 + rand() * 0.13),
        );
      } else if (houseCount < 400) {
        const sy = 3.2 + rand() * 3;
        put(walls, houseCount, x, site.elevation + sy / 2, z, sx, sy, sz);
        walls.setColorAt(
          houseCount,
          tempColor.setHSL(0.08 + rand() * 0.06, 0.13, 0.69 + rand() * 0.15),
        );
        put(roofs, houseCount, x, site.elevation + sy, z, sx, 4, sz);
        roofs.setColorAt(
          houseCount++,
          tempColor.setHSL(0.025 + rand() * 0.04, 0.19, 0.51 + rand() * 0.18),
        );
      }
    }
  for (const mesh of [walls, roofs, blocks]) {
    mesh.receiveShadow = true;
    valley.add(mesh);
  }
  walls.name = 'Village_Houses';
  roofs.name = 'Gable_Roofs';
  blocks.name = 'Town_Centres';

  const roadPositions: number[] = [],
    shoulderPositions: number[] = [],
    linePositions: number[] = [];
  const roadStrip = (
    target: number[],
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    width: number,
    lift: number,
    minHeight = -Infinity,
  ) => {
    const length = Math.hypot(x2 - x1, z2 - z1),
      nx = ((-(z2 - z1) / length) * width) / 2,
      nz = (((x2 - x1) / length) * width) / 2;
    const a = [x1 + nx, Math.max(minHeight, groundHeight(x1 + nx, z1 + nz)) + lift, z1 + nz],
      b = [x1 - nx, Math.max(minHeight, groundHeight(x1 - nx, z1 - nz)) + lift, z1 - nz],
      c = [x2 + nx, Math.max(minHeight, groundHeight(x2 + nx, z2 + nz)) + lift, z2 + nz],
      d = [x2 - nx, Math.max(minHeight, groundHeight(x2 - nx, z2 - nz)) + lift, z2 - nz];
    target.push(...a, ...c, ...b, ...b, ...c, ...d);
  };
  const roadSegment = (
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    width: number,
    bridge = false,
  ) => {
    roadStrip(shoulderPositions, x1, z1, x2, z2, width + 2.1, 0.05, bridge ? 3.5 : -Infinity);
    roadStrip(roadPositions, x1, z1, x2, z2, width, 0.09, bridge ? 3.5 : -Infinity);
  };
  for (const side of [-1, 1])
    for (let z = -3500; z < 3500; z += 14) {
      const x1 = arterialX(z, side),
        x2 = arterialX(z + 14, side);
      roadSegment(x1, z, x2, z + 14, 5.4);
      if ((z + 3500) % 28 === 0) roadStrip(linePositions, x1, z, (x1 + x2) / 2, z + 7, 0.14, 0.105);
    }
  for (const site of SETTLEMENTS) {
    for (let col = -3.5; col <= 3.5; col++)
      for (let row = 0; row < site.rows; row++) {
        const x = site.x + col * 18,
          z = site.z + (row - site.rows / 2) * 18;
        roadSegment(x, z, x, z + 18, 3);
      }
    for (let row = 0; row <= site.rows; row++)
      for (let col = -3.5; col < 3.5; col++) {
        const x = site.x + col * 18,
          z = site.z + (row - site.rows / 2) * 18;
        roadSegment(x, z, x + 18, z, 3);
      }
  }
  const bridgePiers = new T.InstancedMesh(box, mat(0x999d91), 8);
  let pierCount = 0;
  for (const z of [-300, 760]) {
    for (let x = arterialX(z, -1); x < arterialX(z, 1); x += 8)
      roadSegment(x, z, Math.min(x + 8, arterialX(z, 1)), z, 5.4, true);
    for (const dx of [-15, 15])
      for (const dz of [-3.1, 3.1]) {
        const x = riverX(z) + dx,
          y = groundHeight(x, z),
          height = Math.max(0.5, 3.5 - y);
        put(bridgePiers, pierCount++, x, y + height / 2, z + dz, 1.1, height, 0.7);
      }
  }
  const surfaceMeshes: { mesh: T.Mesh; minimum: Float32Array; lift: number }[] = [];
  const makeRoad = (positions: number[], color: number, name: string) => {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const mesh = new T.Mesh(geometry, mat(color));
    mesh.name = name;
    mesh.receiveShadow = true;
    group.add(mesh);
    const attribute = geometry.getAttribute('position');
    const minimum = new Float32Array(attribute.count);
    for (let i = 0; i < minimum.length; i++) {
      const z = attribute.getZ(i),
        x = attribute.getX(i);
      const onBridge =
        (Math.abs(z + 300) < 4 || Math.abs(z - 760) < 4) &&
        x >= arterialX(z, -1) - 5 &&
        x <= arterialX(z, 1) + 5;
      minimum[i] = onBridge ? 3.6 : -Infinity;
    }
    surfaceMeshes.push({
      mesh,
      minimum,
      lift: name.includes('Centre') ? 0.17 : name.includes('Shoulders') ? 0.08 : 0.13,
    });
    return mesh;
  };
  makeRoad(shoulderPositions, 0xaaa28c, 'Road_Shoulders_And_Bridges');
  makeRoad(roadPositions, 0x606b69, 'Connected_Valley_Roads');
  makeRoad(linePositions, 0xd4caa3, 'Arterial_Centre_Markings');
  group.add(bridgePiers);

  // Orchard/meadow parcels add readable land use without textures or new draw calls per field.
  const fieldPositions: number[] = [],
    fieldColors: number[] = [];
  for (let i = 0; i < 80; i++) {
    const z = -3200 + i * 80,
      side = i % 2 ? 1 : -1,
      x = riverX(z) + side * (63 + rand() * 58);
    if (
      LAKES.some((lake) => lakeRadius(x, z, lake) < 1.35) ||
      SETTLEMENTS.some((site) => settlementDistance(x, z, site) < 1.5)
    )
      continue;
    const w = 17 + rand() * 15,
      h = 20 + rand() * 26,
      coordinates = [
        [x - w, z - h],
        [x - w, z + h],
        [x + w, z - h],
        [x + w, z - h],
        [x - w, z + h],
        [x + w, z + h],
      ];
    tempColor.setHSL(0.2 + rand() * 0.11, 0.36 + rand() * 0.16, 0.12 + rand() * 0.09);
    for (const [px, pz] of coordinates) {
      fieldPositions.push(px, groundHeight(px, pz) + 0.06, pz);
      tempColor.toArray(fieldColors, fieldColors.length);
    }
  }
  const fieldsGeometry = new T.BufferGeometry();
  fieldsGeometry.setAttribute('position', new T.Float32BufferAttribute(fieldPositions, 3));
  fieldsGeometry.setAttribute('color', new T.Float32BufferAttribute(fieldColors, 3));
  fieldsGeometry.computeVertexNormals();
  const fields = new T.Mesh(
    fieldsGeometry,
    new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: T.DoubleSide }),
  );
  fields.name = 'Valley_Field_Parcels';
  group.add(fields);
  surfaceMeshes.push({
    mesh: fields,
    minimum: new Float32Array(fieldsGeometry.getAttribute('position').count).fill(-Infinity),
    lift: 0.055,
  });

  const excluded = (x: number, z: number) =>
    Math.hypot(x, z) < 29 ||
    Math.abs(x - riverX(z)) < riverWidth(z) * 1.9 ||
    LAKES.some((lake) => lakeRadius(x, z, lake) < 1.24) ||
    SETTLEMENTS.some((site) => settlementDistance(x, z, site) < 1.42) ||
    [-1, 1].some((side) => Math.abs(x - arterialX(z, side)) < 5);
  const trunks = new T.InstancedMesh(
    new T.CylinderGeometry(0.16, 0.25, 4, 3, 1, true),
    mat(0x524a39),
    4500,
  );
  const crownParts = [
    new T.ConeGeometry(1.6, 3.5, 4, 1, true).translate(0, 0.1, 0),
    new T.ConeGeometry(1.1, 2.8, 4, 1, true).translate(0, 1.8, 0),
  ];
  const conifers = new T.InstancedMesh(mergeGeometries(crownParts), mat(0x386d32), 3375);
  crownParts.forEach((part) => part.dispose());
  const deciduous = new T.InstancedMesh(new T.OctahedronGeometry(1, 0), mat(0x4c7832), 1425);
  let coniferCount = 0,
    deciduousCount = 0,
    secondaryCrowns = 0;
  for (let i = 0; i < 4500; i++) {
    let x = 0,
      z = 0;
    for (let attempt = 0; attempt < 160; attempt++) {
      const near = i % 7 === 0,
        radius = near ? 35 + rand() * 240 : 240 + rand() * 1660,
        angle = rand() * Math.PI * 2;
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius;
      if (
        !excluded(x, z) &&
        rand() < 0.06 + 0.94 * forestCover(x, z) ** 2 &&
        Math.abs(groundHeight(x + 3, z) - groundHeight(x - 3, z)) < 6
      )
        break;
    }
    const y = groundHeight(x, z),
      nearPadLimit =
        Math.hypot(x, z) < 235
          ? Math.max(0.7, (18 - Math.max(y, terrainSurface(ground.geometry, x, z)) - 2) / 8)
          : 1.75,
      s = Math.min(1.1 + rand() * 0.65, nearPadLimit),
      yaw = rand() * Math.PI * 2;
    put(trunks, i, x, y + 2 * s, z, s, s, s, yaw);
    if (i % 4 === 0) {
      const spread = 1.5 + rand() * 0.5;
      put(
        deciduous,
        deciduousCount,
        x,
        y + 4.4 * s,
        z,
        2.1 * s * spread,
        2.4 * s,
        1.8 * s * spread,
        yaw,
      );
      deciduous.setColorAt(
        deciduousCount++,
        tempColor.setHSL(0.23 + rand() * 0.09, 0.3, 0.38 + rand() * 0.27),
      );
      if (secondaryCrowns < 300) {
        put(
          deciduous,
          1125 + secondaryCrowns,
          x + Math.cos(yaw) * 2.2,
          y + 3.6 * s,
          z + Math.sin(yaw) * 2.2,
          2.2 * s,
          2.0 * s,
          2.0 * s,
          yaw + 0.7,
        );
        deciduous.setColorAt(
          1125 + secondaryCrowns++,
          tempColor.setHSL(0.25 + rand() * 0.06, 0.32, 0.4 + rand() * 0.18),
        );
      }
    } else {
      const spread = 1.7 + rand() * 0.65;
      put(conifers, coniferCount, x, y + 3.3 * s, z, s * spread, s, s * spread, yaw);
      conifers.setColorAt(
        coniferCount++,
        tempColor.setHSL(0.27 + rand() * 0.07, 0.25, 0.38 + rand() * 0.28),
      );
    }
  }
  trunks.name = 'Forest_Trunks';
  conifers.name = 'Evergreen_Canopies';
  deciduous.name = 'River_Woodland';
  for (const mesh of [trunks, conifers, deciduous]) {
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const rocks = new T.InstancedMesh(new T.IcosahedronGeometry(1, 0), mat(0x9a9a88), 320);
  const grassGeometry = new T.BufferGeometry();
  grassGeometry.setAttribute(
    'position',
    new T.Float32BufferAttribute(
      [-0.12, 0, 0, 0.03, 0.5, 0, 0.12, 0, 0, 0, 0, -0.12, 0, 0.36, 0.05, 0, 0, 0.12],
      3,
    ),
  );
  grassGeometry.computeVertexNormals();
  const grass = new T.InstancedMesh(
    grassGeometry,
    new T.MeshStandardMaterial({ color: 0x83905c, roughness: 1, side: T.DoubleSide }),
    1300,
  );
  for (let i = 0; i < 1300; i++) {
    let x = 0,
      z = 0;
    for (let attempt = 0; attempt < 100; attempt++) {
      const angle = rand() * Math.PI * 2,
        radius = 8 + rand() * 205;
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius;
      if (!excluded(x, z)) break;
    }
    const y = groundHeight(x, z),
      s = 0.5 + rand() * 0.7;
    put(grass, i, x, y, z, s, s, s, rand() * Math.PI * 2);
    if (i < 320) put(rocks, i, x, y + s * 0.18, z, s * 0.8, s * 0.5, s, rand() * Math.PI * 2);
  }
  rocks.name = 'Valley_Rocks';
  grass.name = 'Near_Field_Grass';
  group.add(rocks, grass);

  const sky = new Sky();
  sky.name = 'Atmospheric_Sky';
  sky.scale.setScalar(9000);
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = 3.0;
  uniforms.rayleigh.value = 1.65;
  uniforms.mieCoefficient.value = 0.004;
  uniforms.mieDirectionalG.value = 0.82;
  uniforms.sunPosition.value.set(-0.42, 0.64, 0.34);
  group.add(sky);

  // Capture only resources created here. sceneDetails may later attach its own children.
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    instances: T.InstancedMesh[] = [];
  group.traverse((object) => {
    if (object instanceof T.Mesh) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        materials.add(material);
    }
    if (object instanceof T.InstancedMesh) {
      instances.push(object);
      object.computeBoundingSphere();
    }
  });
  const terrainInstances = [trunks, conifers, deciduous, rocks, grass].map((mesh) => {
    const offsets = new Float32Array(mesh.instanceMatrix.count);
    const matrix = mesh.instanceMatrix.array;
    for (let i = 0; i < offsets.length; i++)
      offsets[i] = matrix[i * 16 + 13] - groundHeight(matrix[i * 16 + 12], matrix[i * 16 + 14]);
    return { mesh, offsets };
  });
  const seatScenery = () => {
    for (const { mesh, minimum, lift } of surfaceMeshes) {
      const positions = mesh.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++)
        positions.setY(
          i,
          Math.max(
            minimum[i],
            terrainSurface(ground.geometry, positions.getX(i), positions.getZ(i)) + lift,
          ),
        );
      positions.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingSphere();
    }
    for (const { mesh, offsets } of terrainInstances) {
      const matrix = mesh.instanceMatrix.array;
      for (let i = 0; i < offsets.length; i++)
        matrix[i * 16 + 13] =
          terrainSurface(ground.geometry, matrix[i * 16 + 12], matrix[i * 16 + 14]) + offsets[i];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  };
  const setQuality = (next: string) => {
    if (disposed || !Object.hasOwn(LANDSCAPE_PROFILES, next)) return;
    const q = next as LandscapeQuality,
      profile = LANDSCAPE_PROFILES[q];
    if (q !== quality) {
      for (const [mesh, geometry] of [
        [ground, makeTerrain(q)],
        [water, makeWater(q)],
      ] as const) {
        const old = mesh.geometry;
        mesh.geometry = geometry;
        geometries.delete(old);
        old.dispose();
        geometries.add(geometry);
      }
      quality = q;
    }
    trunks.count = profile.trees;
    deciduous.count = Math.ceil(profile.trees / 4) + (q === 'High' ? secondaryCrowns : 0);
    conifers.count = profile.trees - Math.ceil(profile.trees / 4);
    walls.count = roofs.count = Math.min(profile.houses, houseCount);
    blocks.count = Math.min(profile.blocks, blockCount);
    rocks.count = profile.rocks;
    grass.count = profile.grass;
    // Distant instanced batches do not submit thousands of off-map shadow vertices.
    for (const mesh of [trunks, conifers, deciduous, walls, roofs, blocks]) mesh.castShadow = false;
    detail.anisotropy = q === 'High' ? 4 : 2;
    seatScenery();
  };
  setQuality(quality);
  return {
    group,
    mountains,
    ground,
    setSky(golden: boolean) {
      uniforms.sunPosition.value
        .set(...((golden ? [-65, 30, 25] : [-35, 65, 25]) as [number, number, number]))
        .normalize();
      uniforms.turbidity.value = golden ? 4.1 : 3.0;
      uniforms.rayleigh.value = golden ? 1.9 : 1.65;
    },
    setQuality,
    /** Conservative displayed surface for visual effects; never modifies a flight pose. */
    surfaceHeight(x: number, z: number) {
      const analytical = groundHeight(x, z);
      return Math.max(
        WATER_LEVEL,
        analytical,
        Math.abs(x) < LANDSCAPE_EXTENT && Math.abs(z) < LANDSCAPE_EXTENT
          ? terrainSurface(ground.geometry, x, z)
          : analytical,
      );
    },
    get diagnostics() {
      let drawCalls = 0,
        triangles = 0,
        bufferBytes = pixels.byteLength;
      for (const geometry of geometries) {
        for (const attribute of Object.values(geometry.attributes))
          bufferBytes += attribute.array.byteLength;
        if (geometry.index) bufferBytes += geometry.index.array.byteLength;
      }
      group.traverseVisible((object) => {
        if (!(object instanceof T.Mesh) || !geometries.has(object.geometry)) return;
        const count = object instanceof T.InstancedMesh ? object.count : 1;
        drawCalls += count ? 1 : 0;
        triangles +=
          (Math.min(
            object.geometry.drawRange.count,
            object.geometry.index?.count ?? object.geometry.attributes.position.count,
          ) /
            3) *
          count;
      });
      for (const mesh of instances) {
        bufferBytes += mesh.instanceMatrix.array.byteLength;
        if (mesh.instanceColor) bufferBytes += mesh.instanceColor.array.byteLength;
      }
      return {
        quality,
        seed: 50,
        fictional: true,
        drawCalls,
        triangles,
        geometries: geometries.size,
        materials: materials.size,
        textures: 1,
        bufferBytes,
        trees: trunks.count,
        houses: walls.count,
        blocks: blocks.count,
        settlements: SETTLEMENTS.length,
        lakes: LAKES.length,
        disposed,
      };
    },
    dispose() {
      if (disposed) return;
      group.removeFromParent();
      for (const instance of instances) instance.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      detail.dispose();
      disposed = true;
    },
  };
}
