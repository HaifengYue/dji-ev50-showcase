import * as T from 'three';
import { groundHeight, mountainHeight, terrainNoise } from './terrain';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Sky } from 'three/addons/objects/Sky.js';
export function environment(scene: T.Scene) {
  const group = new T.Group();
  scene.add(group);
  let seed = 50;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const mat = (color: number) => new T.MeshStandardMaterial({ color, roughness: 0.94 });
  const height = groundHeight;
  // A single valley spine anchors every district so the scene reads as one
  // continuous landscape instead of a collection of isolated set pieces.
  const streamX = (z: number) => -42 + 38 * Math.sin(z * 0.0032) + 13 * Math.sin(z * 0.012);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!,
    pixels = ctx.createImageData(512, 512);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const n = rand() * 36;
    pixels.data[i] = 95 + n;
    pixels.data[i + 1] = 105 + n;
    pixels.data[i + 2] = 77 + n;
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  const detail = new T.CanvasTexture(canvas);
  detail.colorSpace = T.SRGBColorSpace;
  detail.wrapS = detail.wrapT = T.RepeatWrapping;
  detail.repeat.set(90, 90);
  detail.anisotropy = 8;
  const geo = new T.PlaneGeometry(8000, 8000, 320, 320);
  geo.rotateX(-Math.PI / 2);
  const gp = geo.attributes.position,
    colors = [];
  for (let i = 0; i < gp.count; i++) {
    const gx = gp.getX(i),
      gz = gp.getZ(i),
      x = Math.sign(gx) * 4000 * (Math.abs(gx) / 4000) ** 2,
      z = Math.sign(gz) * 4000 * (Math.abs(gz) / 4000) ** 2;
    gp.setX(i, x);
    gp.setZ(i, z);
    gp.setY(i, height(x, z) - 0.07);
    const c = new T.Color(0x87906a);
    c.lerp(
      new T.Color(0xb5a885),
      0.15 + 0.65 * terrainNoise(x * 0.013, z * 0.013) + 0.2 * terrainNoise(x * 0.06, z * 0.06),
    );
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new T.Mesh(
    geo,
    new T.MeshStandardMaterial({
      map: detail,
      bumpMap: detail,
      bumpScale: 0.09,
      vertexColors: true,
      roughness: 1,
    }),
  );
  ground.receiveShadow = true;
  group.add(ground);
  const pad = new T.Mesh(new T.CylinderGeometry(6, 6, 0.08, 96), mat(0x858b85));
  pad.position.y = -0.025;
  pad.receiveShadow = true;
  group.add(pad);
  const mark = new T.MeshBasicMaterial({ color: 0xe6dfbb }),
    ring = new T.Mesh(new T.RingGeometry(4.75, 4.86, 96), mark);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.017;
  group.add(ring);
  for (const [x, z, w, h] of [
    [-1, 0, 0.18, 2.3],
    [1, 0, 0.18, 2.3],
    [0, 0, 2, 0.18],
  ]) {
    const m = new T.Mesh(new T.PlaneGeometry(w, h), mark);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.019, z);
    group.add(m);
  }
  for (const z of [-3, 3]) {
    const seam = new T.Mesh(new T.BoxGeometry(9, 0.002, 0.018), mat(0x606b65));
    seam.position.set(0, 0.017, z);
    group.add(seam);
  }
  const lm = new T.MeshStandardMaterial({
    color: 0xe6be6c,
    emissive: 0xeab35c,
    emissiveIntensity: 0.4,
    roughness: 0.4,
  });
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6,
      m = new T.Mesh(new T.CylinderGeometry(0.07, 0.11, 0.14, 8), lm);
    m.position.set(Math.cos(a) * 5.65, 0.07, Math.sin(a) * 5.65);
    group.add(m);
  }
  const mountains = new T.Group();
  group.add(mountains);
  for (let k = 0; k < 5; k++) {
    const positions: number[] = [],
      cols: number[] = [],
      indices: number[] = [],
      N = 240,
      M = 72;
    for (let j = 0; j <= M; j++)
      for (let i = 0; i <= N; i++) {
        const a = (i * 2 * Math.PI) / N,
          r = 235 + k * 185 + j * 4.4,
          h = mountainHeight(a, r, k) + 2;
        positions.push(r * Math.cos(a), h - 2, r * Math.sin(a));
        const c = new T.Color(k === 0 ? 0x535c49 : k === 1 ? 0x62695d : 0x7d8b88);
        c.lerp(new T.Color(0xaaa99d), T.MathUtils.smoothstep(h, 55, 105) * 0.45);
        c.lerp(
          new T.Color(0xe6e8e2),
          T.MathUtils.smoothstep(h + 4 * Math.sin(a * 27), 106, 127) * 0.5,
        );
        c.multiplyScalar(0.88 + 0.12 * Math.sin(r * 0.13 + a * 22));
        cols.push(c.r, c.g, c.b);
      }
    for (let j = 0; j < M; j++)
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i;
        indices.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2);
      }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    const rock = new T.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      side: T.DoubleSide,
    });
    rock.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRock;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRock=position;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vRock;\nfloat hashRock(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}\nfloat rockNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(hashRock(i),hashRock(i+vec3(1,0,0)),f.x),mix(hashRock(i+vec3(0,1,0)),hashRock(i+vec3(1,1,0)),f.x),f.y),mix(mix(hashRock(i+vec3(0,0,1)),hashRock(i+vec3(1,0,1)),f.x),mix(hashRock(i+vec3(0,1,1)),hashRock(i+vec3(1,1,1)),f.x),f.y),f.z);}',
        )
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\nfloat strata=rockNoise(vRock*.08)*.5+rockNoise(vRock*.27)*.3+rockNoise(vRock*.8)*.2;diffuseColor.rgb*=.72+.42*strata;',
        );
    };
    mountains.add(new T.Mesh(g, rock));
  }
  for (const [width, color, water] of [
    [13, 0xb3a889, false],
    [8.4, 0x356f86, true],
  ] as const) {
    const v: number[] = [],
      ix: number[] = [];
    for (let i = 0; i <= 760; i++) {
      const z = -3420 + i * 9,
        x = streamX(z);
      for (const side of [-1, 1]) v.push(x + side * width, height(x + side * width, z) + 0.025, z);
      if (i < 760) {
        const a = i * 2;
        ix.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(v, 3));
    g.setIndex(ix);
    g.computeVertexNormals();
    group.add(
      new T.Mesh(
        g,
        new T.MeshStandardMaterial({
          color,
          roughness: water ? 0.16 : 1,
          metalness: water ? 0.42 : 0,
          emissive: water ? 0x071b25 : 0,
          emissiveIntensity: water ? 0.12 : 0,
          side: T.DoubleSide,
        }),
      ),
    );
  }
  const dummy = new T.Object3D();
  const valley = new T.Group();
  valley.name = 'Valley_Settlements';
  group.add(valley);
  const houseWalls = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), mat(0xb7a488), 540);
  const houseRoofs = new T.InstancedMesh(new T.ConeGeometry(0.92, 0.72, 4), mat(0x6d4f42), 540);
  const townBlocks = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), mat(0x8b9191), 160);
  const roads = new T.InstancedMesh(new T.BoxGeometry(1, 0.025, 1), mat(0x6d675c), 210);
  const settlements = [
    [-1, -2680, 40, 'village'],
    [1, -1840, 70, 'town'],
    [-1, -980, 48, 'village'],
    [1, -330, 88, 'town'],
    [-1, 470, 54, 'village'],
    [1, 1250, 104, 'town'],
    [-1, 2180, 58, 'village'],
    [1, 2940, 78, 'town'],
  ] as const;
  let houses = 0,
    blocks = 0,
    roadsUsed = 0;
  for (const [side, z0, count, kind] of settlements) {
    const x0 = streamX(z0) + side * (kind === 'town' ? 106 : 74);
    const district = new T.Group();
    district.name = `${kind === 'town' ? 'Town' : 'Village'}_${Math.abs(z0)}`;
    valley.add(district);
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / 9),
        col = (i % 9) - 4;
      const x = x0 + col * 12 + (rand() - 0.5) * 4;
      const z = z0 + (row - Math.floor(count / 18)) * 16 + (rand() - 0.5) * 5;
      const y = height(x, z);
      if (kind === 'town' && i % 3 === 0 && blocks < 160) {
        const sx = 7 + rand() * 7,
          sz = 7 + rand() * 8,
          sy = 5 + rand() * 18;
        dummy.position.set(x, y + sy / 2, z);
        dummy.scale.set(sx, sy, sz);
        dummy.rotation.set(0, (rand() - 0.5) * 0.16, 0);
        dummy.updateMatrix();
        townBlocks.setMatrixAt(blocks++, dummy.matrix);
      } else if (houses < 540) {
        const sx = 4 + rand() * 3,
          sz = 4 + rand() * 3,
          sy = 2.6 + rand() * 2.6;
        dummy.position.set(x, y + sy / 2, z);
        dummy.scale.set(sx, sy, sz);
        dummy.rotation.set(0, (rand() - 0.5) * 0.22, 0);
        dummy.updateMatrix();
        houseWalls.setMatrixAt(houses, dummy.matrix);
        dummy.position.y = y + sy + 0.36;
        dummy.scale.set(sx * 0.86, 1, sz * 0.86);
        dummy.updateMatrix();
        houseRoofs.setMatrixAt(houses++, dummy.matrix);
      }
    }
    for (let i = 0; i < 20 && roadsUsed < 210; i++) {
      const z = z0 + (i - 10) * 15,
        x = x0 + (rand() - 0.5) * 48;
      dummy.position.set(x, height(x, z) + 0.012, z);
      dummy.scale.set(18, 1, 2.1);
      dummy.rotation.set(0, (rand() - 0.5) * 0.12, 0);
      dummy.updateMatrix();
      roads.setMatrixAt(roadsUsed++, dummy.matrix);
    }
  }
  houseWalls.count = houseRoofs.count = houses;
  townBlocks.count = blocks;
  roads.count = roadsUsed;
  for (const object of [houseWalls, houseRoofs, townBlocks, roads]) {
    object.castShadow = object !== roads;
    object.receiveShadow = true;
    valley.add(object);
  }
  const rocks = new T.InstancedMesh(new T.IcosahedronGeometry(1, 1), mat(0x85847a), 900);
  for (let i = 0; i < 900; i++) {
    const a = rand() * Math.PI * 2,
      r = 8 + rand() * 200,
      x = Math.cos(a) * r,
      z = Math.sin(a) * r,
      s = 0.08 + rand() * 0.7;
    dummy.position.set(x, height(x, z), z);
    dummy.scale.set(s, s * 0.55, s * 0.8);
    dummy.rotation.set(rand(), rand() * 6.28, rand());
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }
  rocks.receiveShadow = rocks.castShadow = true;
  group.add(rocks);
  const grass = new T.InstancedMesh(new T.ConeGeometry(0.1, 0.55, 3), mat(0x778056), 6500);
  for (let i = 0; i < 6500; i++) {
    const a = rand() * 6.28,
      r = 7 + rand() * 125,
      x = r * Math.cos(a),
      z = r * Math.sin(a);
    dummy.position.set(x, height(x, z) + 0.08, z);
    dummy.scale.setScalar(0.4 + rand());
    dummy.rotation.set(0, rand() * 6.28, 0.12);
    dummy.updateMatrix();
    grass.setMatrixAt(i, dummy.matrix);
  }
  group.add(grass);
  const tiers = [
    new T.ConeGeometry(1.35, 2.9, 9),
    new T.ConeGeometry(1.05, 2.7, 9).translate(0, 1.3, 0),
    new T.ConeGeometry(0.65, 2.1, 9).translate(0, 2.45, 0),
  ];
  const foliage = mergeGeometries(tiers);
  tiers.forEach((g) => g.dispose());
  const trunks = new T.InstancedMesh(new T.CylinderGeometry(0.11, 0.18, 4, 5), mat(0x655749), 1000),
    crowns = new T.InstancedMesh(foliage, mat(0x344b3a), 1000);
  for (let i = 0; i < 1000; i++) {
    let x: number, z: number;
    do {
      x = -200 + rand() * 420;
      z = -220 + rand() * 440;
    } while (Math.hypot(x, z) < 28 || Math.abs(x - streamX(z)) < 9);
    if (i >= 480) {
      const a = rand() * Math.PI * 2,
        r = 980 + rand() * 1350;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
    }
    const s = 0.55 + rand() * 0.6,
      y = height(x, z);
    dummy.rotation.set(0, rand() * 6.28, 0);
    dummy.scale.setScalar(s);
    dummy.position.set(x, y + 2 * s, z);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.y = y + 2.4 * s;
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
    crowns.setColorAt(
      i,
      new T.Color().setHSL(0.28 + rand() * 0.05, 0.18 + rand() * 0.18, 0.18 + rand() * 0.1),
    );
  }
  trunks.castShadow = crowns.castShadow = true;
  trunks.receiveShadow = crowns.receiveShadow = true;
  group.add(trunks, crowns);
  const sky = new Sky();
  sky.scale.setScalar(9000);
  const u = sky.material.uniforms;
  u.turbidity.value = 3.2;
  u.rayleigh.value = 1.4;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.set(-0.42, 0.64, 0.34);
  group.add(sky);
  return {
    group,
    mountains,
    ground,
    setSky(golden: boolean) {
      u.sunPosition.value
        .set(...((golden ? [-65, 30, 25] : [-35, 65, 25]) as [number, number, number]))
        .normalize();
      u.turbidity.value = golden ? 4.2 : 3.2;
      u.rayleigh.value = golden ? 1.8 : 1.4;
    },
    setQuality(q: string) {
      grass.count = q === 'Low' ? 500 : q === 'Medium' ? 2600 : 6500;
      rocks.count = q === 'Low' ? 150 : q === 'Medium' ? 450 : 900;
      trunks.count = crowns.count = q === 'Low' ? 150 : q === 'Medium' ? 480 : 1000;
      mountains.children.slice(2).forEach((mountain) => (mountain.visible = q !== 'Low'));
      houseWalls.count = houseRoofs.count =
        q === 'Low' ? Math.min(110, houses) : q === 'Medium' ? Math.min(280, houses) : houses;
      townBlocks.count =
        q === 'Low' ? Math.min(25, blocks) : q === 'Medium' ? Math.min(78, blocks) : blocks;
      roads.count =
        q === 'Low'
          ? Math.min(45, roadsUsed)
          : q === 'Medium'
            ? Math.min(120, roadsUsed)
            : roadsUsed;
      detail.anisotropy = q === 'High' ? 8 : 2;
    },
  };
}
