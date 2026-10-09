/** Deterministic, fictional landscape shared by rendering and clearance checks. Metres. */
export const LANDSCAPE_EXTENT = 4000;
export const WATER_LEVEL = -0.75;
export const MAX_TERRAIN_HEIGHT = 112;
const smooth = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export function terrainNoise(x: number, z: number) {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    fx = x - ix,
    fz = z - iz;
  const u = fx * fx * (3 - 2 * fx),
    v = fz * fz * (3 - 2 * fz);
  const hash = (a: number, b: number) => {
    const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return h - Math.floor(h);
  };
  return (
    (hash(ix, iz) * (1 - u) + hash(ix + 1, iz) * u) * (1 - v) +
    (hash(ix, iz + 1) * (1 - u) + hash(ix + 1, iz + 1) * u) * v
  );
}
export function riverX(z: number) {
  return -105 + 72 * Math.sin(z * 0.00135) + 28 * Math.sin(z * 0.0042);
}
export function riverWidth(z: number) {
  return 13 + 3 * Math.sin(z * 0.0031) + 2 * Math.sin(z * 0.008 + 1);
}
export const LAKES = [
  { id: 'Willow_Lake', x: riverX(-980) - 92, z: -980, rx: 150, rz: 215 },
  { id: 'Upper_Lake', x: riverX(1700) + 88, z: 1700, rx: 125, rz: 180 },
] as const;
export const SETTLEMENTS = [
  { id: 'North_Village', z: -2900, side: -1, rows: 5, town: false },
  { id: 'North_Town', z: -2150, side: 1, rows: 9, town: true },
  { id: 'Lakeside_Village', z: -1430, side: -1, rows: 5, town: false },
  { id: 'Market_Town', z: -520, side: 1, rows: 9, town: true },
  { id: 'Airfield_Village', z: 390, side: 1, rows: 5, town: false },
  { id: 'River_Town', z: 1070, side: -1, rows: 9, town: true },
  { id: 'Upper_Village', z: 2170, side: 1, rows: 5, town: false },
  { id: 'South_Town', z: 2920, side: -1, rows: 9, town: true },
].map((site) => ({ ...site, x: riverX(site.z) + site.side * 210, elevation: 2.8 }));

export function lakeRadius(x: number, z: number, lake: (typeof LAKES)[number]) {
  // A gently irregular outline avoids a perfect ellipse, with no random state.
  const dx = (x - lake.x) / lake.rx,
    dz = (z - lake.z) / lake.rz;
  const angle = Math.atan2(dz, dx);
  return Math.hypot(dx, dz) / (1 + 0.075 * Math.sin(angle * 3) + 0.045 * Math.sin(angle * 7 + 1));
}
export function settlementDistance(x: number, z: number, site: (typeof SETTLEMENTS)[number]) {
  return Math.max(Math.abs(x - site.x) / 80, Math.abs(z - site.z) / (site.rows * 9 + 14));
}
export function arterialX(z: number, side: number) {
  let offset = 210;
  for (const lake of LAKES) {
    if (Math.sign(lake.x - riverX(lake.z)) !== side) continue;
    offset += 145 * (1 - smooth(lake.rz * 0.9, lake.rz * 1.9, Math.abs(z - lake.z)));
  }
  let x = riverX(z) + side * offset;
  // Follow an existing street between the 18 m-spaced lots, not a row of houses.
  for (const site of SETTLEMENTS) {
    if (site.side !== side) continue;
    const halfLength = site.rows * 9 + 14,
      distance = Math.abs(z - site.z);
    if (distance < halfLength + 95)
      x = site.x + 9 + (x - site.x - 9) * smooth(halfLength + 4, halfLength + 95, distance);
  }
  return x;
}
export function groundHeight(x: number, z: number) {
  const r = Math.hypot(x, z);
  if (r <= 12) return 0;
  const distance = Math.abs(x - riverX(z));
  const lowland =
    1.8 +
    1.3 * Math.sin(x * 0.017) * Math.cos(z * 0.009) +
    0.65 * terrainNoise(x * 0.025, z * 0.025);
  const broad = terrainNoise(x * 0.0016 + 7, z * 0.0016 - 4);
  const ridge = 1 - Math.abs(2 * terrainNoise(x * 0.006, z * 0.006) - 1);
  const relief =
    (20 + 60 * broad + 39 * ridge ** 2 + 9 * terrainNoise(x * 0.025, z * 0.025)) *
    smooth(190, 370, r) *
    (1 - smooth(3550, 4250, r)) *
    smooth(145, 460, distance);
  let h = Math.min(MAX_TERRAIN_HEIGHT, lowland + relief);
  // A flat connected water datum, carved riverbed and gradual gravel banks.
  h = -2.8 + (h + 2.8) * smooth(riverWidth(z) * 0.72, riverWidth(z) * 1.85, distance);
  for (const lake of LAKES) {
    const radius = lakeRadius(x, z, lake);
    if (radius <= 0.94) h = -4.8 + (WATER_LEVEL - 0.04 + 4.8) * smooth(0.7, 0.94, radius);
    else if (radius < 1.25)
      h = WATER_LEVEL - 0.04 + (h - WATER_LEVEL + 0.04) * smooth(0.94, 1.25, radius);
  }
  // Districts have genuinely level foundations; terrain eases into their edges.
  for (const site of SETTLEMENTS) {
    const d = settlementDistance(x, z, site);
    if (d < 1.4) h = site.elevation + (h - site.elevation) * smooth(1, 1.4, d);
  }
  return h * smooth(12, 28, r);
}

/** Compatibility sampler for existing route validation; mountains now use the same heightfield. */
export function mountainHeight(a: number, r: number, _layer: number) {
  return groundHeight(Math.cos(a) * r, Math.sin(a) * r);
}
export const VISUAL_OBSTACLES = [
  { id: 'windsock', x: 10, z: -10, radius: 1.8, height: 4.9 },
  ...[-1, 1].flatMap((x) =>
    [-1, 1].map((z) => ({
      id: `cone-${x}-${z}`,
      x: x * 7.2,
      z: z * 7.2,
      radius: 0.25,
      height: 0.65,
    })),
  ),
];
/**
 * Conservative rendering envelope, including mesh chords and foliage. Terrain
 * is capped at 112 m; the tallest crown adds < 10 m, town roofs stay below 36 m.
 * This is visual clearance, not a surveyed terrain/obstacle database.
 */
export function obstacleCeiling(x: number, z: number) {
  const r = Math.hypot(x, z);
  let ceiling = r < 18 ? 0 : r >= 217 && r <= 4300 ? 127 : 18;
  for (const obstacle of VISUAL_OBSTACLES)
    if (Math.hypot(x - obstacle.x, z - obstacle.z) <= obstacle.radius)
      ceiling = Math.max(ceiling, obstacle.height);
  return ceiling;
}
/**
 * Frozen compatibility envelope for legacy FlightController manual commands.
 * New visual scenery must never silently raise a caller's historical pose.
 * This is deliberately not the new landscape's collision/clearance map.
 */
export function legacyControlCeiling(x: number, z: number) {
  const r = Math.hypot(x, z);
  let ceiling = r < 18 ? 0 : r >= 217 && r <= 1450 ? 127 : 10;
  for (const obstacle of VISUAL_OBSTACLES)
    if (Math.hypot(x - obstacle.x, z - obstacle.z) <= obstacle.radius)
      ceiling = Math.max(ceiling, obstacle.height);
  return ceiling;
}

export const CRUISE_ALTITUDE = 180;
export const AIRCRAFT_RADIUS = 4;
export const CLEARANCE = 30;
