import * as T from 'three';
import { groundHeight, obstacleCeiling, VISUAL_OBSTACLES } from '../terrain';

export const SCENE_ANCHORS = [
  { id: 'home', kind: 'landing-pad', position: [0, 0, 0], radius: 6 },
  {
    id: 'checker-east',
    kind: 'checkerboard',
    position: [12, 0.026, 0],
    squareSize: 0.4,
    squares: 6,
  },
  { id: 'windsock', kind: 'wind-indicator', position: [10, 0, -10], height: 4.6 },
] as const;
export type SceneSettings = {
  visibility: number;
  windSpeed: number;
  windFromDegrees: number;
  references: boolean;
  trail: boolean;
};

/** Deterministic, lightweight references shared by the scene and metadata API. */
export function sceneDetails(parent: T.Group) {
  const group = new T.Group();
  group.name = 'Simulation_Site';
  parent.add(group);
  let settings: SceneSettings = {
    visibility: 7200,
    windSpeed: 4,
    windFromDegrees: 30,
    references: false,
    trail: true,
  };
  const material = (color: number) => new T.MeshStandardMaterial({ color, roughness: 0.8 });
  const ivory = material(0xf0eee0),
    graphite = material(0x263038),
    orange = material(0xd67736);
  const darkSquare = new T.PlaneGeometry(0.4, 0.4);
  const checker = new T.Group();
  checker.name = 'Reference_Checker_East';
  checker.position.set(12, 0.026, 0);
  group.add(checker);
  const board = new T.Mesh(new T.BoxGeometry(2.65, 0.02, 2.65), ivory);
  board.position.y = -0.012;
  board.receiveShadow = true;
  checker.add(board);
  for (let x = 0; x < 6; x++)
    for (let z = 0; z < 6; z++)
      if ((x + z) % 2 === 0) {
        const square = new T.Mesh(darkSquare, graphite);
        square.rotation.x = -Math.PI / 2;
        square.position.set((x - 2.5) * 0.4, 0.002, (z - 2.5) * 0.4);
        checker.add(square);
      }
  for (const obstacle of VISUAL_OBSTACLES.filter((o) => o.id.startsWith('cone'))) {
    const cone = new T.Mesh(new T.ConeGeometry(0.18, 0.6, 12), orange);
    cone.position.set(obstacle.x, 0.3, obstacle.z);
    cone.castShadow = true;
    group.add(cone);
    const band = new T.Mesh(new T.CylinderGeometry(0.095, 0.125, 0.1, 12), ivory);
    band.position.set(obstacle.x, 0.26, obstacle.z);
    group.add(band);
  }
  const mast = new T.Mesh(new T.CylinderGeometry(0.035, 0.05, 4.6, 12), graphite);
  mast.position.set(10, 2.3, -10);
  mast.castShadow = true;
  group.add(mast);
  const foot = new T.Mesh(new T.CylinderGeometry(0.32, 0.36, 0.16, 12), material(0x8e9289));
  foot.position.set(10, 0.08, -10);
  group.add(foot);
  const sock = new T.Group();
  sock.name = 'Visual_Windsock';
  sock.position.set(10, 4.6, -10);
  group.add(sock);
  for (let i = 0; i < 6; i++) {
    const sleeve = new T.Mesh(
      new T.CylinderGeometry(0.21 - i * 0.023, 0.21 - (i + 1) * 0.023, 0.23, 16, 1, true),
      i % 2 ? ivory : orange,
    );
    sleeve.material.side = T.DoubleSide;
    sleeve.rotation.x = Math.PI / 2;
    sleeve.position.z = (i + 0.5) * 0.23;
    sock.add(sleeve);
  }
  const references = new T.Group();
  references.name = 'Scene_Reference_Frames';
  references.visible = false;
  group.add(references);
  const grid = new T.GridHelper(40, 20, 0x85bccc, 0x506f76);
  grid.position.y = 0.035;
  references.add(grid);
  references.add(new T.AxesHelper(8));
  for (const [label, position, color] of [
    ['N', [0, 0.3, -9], 0xd4fa79],
    ['E', [9, 0.3, 0], 0xa8d6e8],
    ['HOME', [0, 0.3, 7], 0xe9e6d8],
  ] as const) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#14232e';
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = `#${color.toString(16)}`;
    ctx.font = 'bold 52px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, 50);
    const map = new T.CanvasTexture(canvas);
    map.colorSpace = T.SRGBColorSpace;
    const sprite = new T.Sprite(new T.SpriteMaterial({ map, depthTest: false }));
    sprite.position.fromArray(position);
    sprite.scale.set(2, 0.75, 1);
    references.add(sprite);
  }
  const positions = new Float32Array(1500 * 3),
    geometry = new T.BufferGeometry();
  geometry.setAttribute(
    'position',
    new T.BufferAttribute(positions, 3).setUsage(T.DynamicDrawUsage),
  );
  geometry.setDrawRange(0, 0);
  const trail = new T.Line(
    geometry,
    new T.LineBasicMaterial({ color: 0xd4fa79, transparent: true, opacity: 0.7 }),
  );
  trail.name = 'Visual_Telemetry_Trail';
  trail.frustumCulled = false;
  group.add(trail);
  let count = 0,
    elapsed = 0;
  return {
    clearTrail() {
      count = 0;
      elapsed = 0;
      geometry.setDrawRange(0, 0);
    },
    update(dt: number, seconds: number, position: T.Vector3, enabled: boolean, fog: T.Fog | null) {
      references.visible = settings.references;
      trail.visible = settings.trail && enabled;
      sock.rotation.set(
        Math.max(0.08, Math.PI / 2 - settings.windSpeed * 0.16) + Math.sin(seconds * 3) * 0.035,
        -T.MathUtils.degToRad(settings.windFromDegrees),
        0,
        'YXZ',
      );
      if (fog) {
        fog.near = Math.min(1800, settings.visibility * 0.3);
        fog.far = settings.visibility;
      }
      elapsed += dt;
      if (enabled && settings.trail && elapsed >= 0.1) {
        elapsed = 0;
        const index = Math.max(0, count - 1) * 3;
        if (
          count &&
          Math.hypot(
            positions[index] - position.x,
            positions[index + 1] - position.y,
            positions[index + 2] - position.z,
          ) < 0.15
        )
          return;
        if (count === 1500) {
          positions.copyWithin(0, 3);
          count--;
        }
        positions.set(position.toArray(), count++ * 3);
        geometry.setDrawRange(0, count);
        geometry.attributes.position.needsUpdate = true;
      }
    },
    configure(input: unknown) {
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new Error('Scene settings must be an object');
      const next = { ...settings },
        update = input as Record<string, unknown>;
      for (const [key, value] of Object.entries(update)) {
        if (!Object.hasOwn(next, key)) throw new Error(`Unknown scene setting: ${key}`);
        if (key === 'references' || key === 'trail') {
          if (typeof value !== 'boolean') throw new Error(`${key} must be boolean`);
          next[key] = value;
        } else {
          const k = key as 'visibility' | 'windSpeed' | 'windFromDegrees';
          const [min, max] =
            k === 'visibility' ? [150, 7500] : k === 'windSpeed' ? [0, 15] : [0, 360];
          if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
            throw new Error(`${key} must be within [${min}, ${max}]`);
          next[k] = value;
        }
      }
      settings = next;
      return { ...settings };
    },
    getSettings: () => ({ ...settings }),
    describe: () => ({
      frame: 'SCENE',
      units: 'metres',
      axes: { x: 'East', y: 'Up', z: 'South' },
      origin: 'home pad datum; no geodetic binding',
      anchors: structuredClone(SCENE_ANCHORS),
      obstacles: structuredClone(VISUAL_OBSTACLES),
      extent: { x: [-3000, 3000], z: [-3000, 3000] },
      windModel: 'visual windsock only; does not apply forces',
      settings: { ...settings },
    }),
    query(input: unknown) {
      const p = input as { x?: unknown; z?: unknown };
      if (
        !p ||
        typeof p.x !== 'number' ||
        typeof p.z !== 'number' ||
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.z) ||
        Math.abs(p.x) > 3000 ||
        Math.abs(p.z) > 3000
      )
        throw new Error('Query x/z must be finite and inside [-3000, 3000] m');
      return {
        x: p.x,
        z: p.z,
        nominalGroundHeight: groundHeight(p.x, p.z),
        obstacleCeiling: obstacleCeiling(p.x, p.z),
        semantics:
          'procedural ground function and conservative obstacle bound; not a rendered depth/collision query',
      };
    },
  };
}
