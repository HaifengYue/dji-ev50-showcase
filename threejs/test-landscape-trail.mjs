// CPU geometry/resource/pose tests. These do not claim browser or GPU validation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import * as T from 'three';
const temporary = fs.mkdtempSync(path.resolve('.landscape-trail-test-'));
const root = path.resolve('src'),
  compiled = new Map();
function compile(relative) {
  const source = path.resolve(root, relative);
  if (compiled.has(source)) return compiled.get(source);
  const output = path.join(temporary, path.relative(root, source)).replace(/\.ts$/, '.mjs');
  compiled.set(source, output);
  const js = ts
    .transpileModule(fs.readFileSync(source, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    })
    .outputText.replace(
      /(from\s+|import\s*\()(['"])(\.[^'"]+)\2/g,
      (_match, prefix, quote, specifier) => {
        const dependency =
          path.resolve(path.dirname(source), specifier.replace(/\.js$/, '')) + '.ts';
        const target = compile(path.relative(root, dependency));
        const rewritten = path.relative(path.dirname(output), target).split(path.sep).join('/');
        return `${prefix}${quote}${rewritten.startsWith('.') ? rewritten : `./${rewritten}`}${quote}`;
      },
    );
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, js);
  return output;
}
const load = (relative) => import(pathToFileURL(compile(relative)).href);
const passed = [];
const pass = (name) => {
  passed.push(name);
  console.log('PASS landscape/trail:', name);
};
try {
  const { FlightTrail, TRAIL_PROFILES } = await load('flight-trail.ts');
  const { environment, LANDSCAPE_PROFILES } = await load('environment.ts');
  const {
    groundHeight,
    riverX,
    riverWidth,
    arterialX,
    WATER_LEVEL,
    LAKES,
    SETTLEMENTS,
    lakeRadius,
    settlementDistance,
    obstacleCeiling,
    legacyControlCeiling,
    MAX_TERRAIN_HEIGHT,
    AIRCRAFT_RADIUS,
    CLEARANCE,
  } = await load('terrain.ts');
  const parent = new T.Scene();
  const trail = new FlightTrail(parent, { quality: 'High', surfaceHeight: () => 0 });
  const frame = (time, x = time * 20, overrides = {}) => ({
    time,
    position: new T.Vector3(x, 100, 0),
    enabled: true,
    generation: 'ev50:1',
    ...overrides,
  });
  const identity = [
    trail.geometry,
    trail.geometry.getAttribute('position').array,
    trail.geometry.getAttribute('aTangent').array,
    trail.material,
  ];
  for (let i = 0; i <= 2000; i++) trail.update(frame(i / 60));
  assert.ok(trail.diagnostics.pointCount > 100 && trail.diagnostics.pointCount <= 384);
  assert.ok(trail.diagnostics.bufferBytes < 80000);
  assert.equal(trail.diagnostics.drawCalls, 1);
  assert.deepEqual(
    [
      trail.geometry,
      trail.geometry.getAttribute('position').array,
      trail.geometry.getAttribute('aTangent').array,
      trail.material,
    ],
    identity,
  );
  assert.ok([...trail.geometry.attributes.position.array].every(Number.isFinite));
  const stablePositions = trail.geometry.attributes.position.array.slice();
  const stableUniform = trail.material.uniforms.uTime.value;
  const stableCount = trail.diagnostics.pointCount;
  for (let i = 0; i < 120; i++) trail.update(frame(2000 / 60));
  assert.equal(trail.diagnostics.pointCount, stableCount);
  assert.equal(trail.material.uniforms.uTime.value, stableUniform);
  assert.deepEqual(trail.geometry.attributes.position.array, stablePositions);
  pass('fixed buffers, one draw call, simulation-time pause and external step(0) freeze');
  trail.update(frame(1));
  assert.equal(trail.diagnostics.resetReason, 'time-reversed');
  assert.equal(trail.diagnostics.pointCount, 1);
  trail.update(frame(1.1));
  trail.update(frame(8));
  assert.equal(trail.diagnostics.resetReason, 'time-jump');
  assert.equal(trail.diagnostics.pointCount, 1);
  trail.update(frame(8.1, 8000));
  assert.equal(trail.diagnostics.resetReason, 'teleport');
  assert.equal(trail.diagnostics.pointCount, 1);
  trail.update(frame(8.1, 8100));
  assert.equal(trail.diagnostics.resetReason, 'frozen-pose-change');
  assert.equal(trail.diagnostics.pointCount, 1);
  trail.update(frame(8.2, 8101, { generation: 'skytrans:2' }));
  assert.equal(trail.diagnostics.resetReason, 'generation');
  assert.equal(trail.diagnostics.pointCount, 1);
  trail.update(frame(8.25, 8102, { generation: 'skytrans:2', discontinuity: true }));
  assert.equal(trail.diagnostics.resetReason, 'discontinuity');
  assert.equal(trail.diagnostics.pointCount, 1);
  trail.reset('seek');
  assert.equal(trail.geometry.drawRange.count, 0);
  assert.equal(trail.diagnostics.lastTime, null);
  pass(
    'backward/loop/forward seek/teleport/source generation and explicit discontinuity never connect',
  );
  for (const q of ['High', 'Low', 'Medium', 'Low', 'High']) {
    trail.setQuality(q);
    trail.reset();
    for (let i = 0; i < 1600; i++) trail.update(frame(i / 60));
    assert.ok(trail.diagnostics.pointCount <= TRAIL_PROFILES[q].points);
    assert.equal(trail.geometry, identity[0]);
    assert.equal(trail.geometry.attributes.position.array, identity[1]);
  }
  trail.update(frame(27, 540, { enabled: false }));
  assert.equal(trail.diagnostics.pointCount, 0);
  assert.equal(trail.group.visible, false);
  trail.update(frame(27.1, 542));
  assert.equal(trail.diagnostics.pointCount, 1);
  trail.update(frame(27.2, 544, { position: new T.Vector3(544, 0.5, 0) }));
  assert.equal(trail.diagnostics.pointCount, 0);
  trail.update(frame(NaN));
  assert.equal(trail.diagnostics.resetReason, 'invalid-pose');
  pass('quality toggles stay bounded; product/disabled/ground contact/invalid pose clear the cue');
  let disposedGeometry = 0,
    disposedMaterial = 0;
  trail.geometry.addEventListener('dispose', () => disposedGeometry++);
  trail.material.addEventListener('dispose', () => disposedMaterial++);
  trail.dispose();
  trail.dispose();
  trail.update(frame(1));
  trail.setQuality('Low');
  assert.equal(disposedGeometry, 1);
  assert.equal(disposedMaterial, 1);
  assert.equal(trail.group.parent, null);
  assert.equal(trail.diagnostics.disposed, true);
  const ridgeTrail = new FlightTrail(parent, { surfaceHeight: (x) => (x > 4 && x < 6 ? 105 : 0) });
  ridgeTrail.update(frame(0, 0));
  ridgeTrail.update(frame(0.1, 10));
  assert.equal(ridgeTrail.diagnostics.resetReason, 'segment-clearance');
  assert.equal(ridgeTrail.diagnostics.pointCount, 1);
  ridgeTrail.dispose();
  pass('dispose is idempotent and short segments cannot cross a ridge');
  const smallTime = new FlightTrail(parent, { surfaceHeight: () => 0 });
  const largeTime = new FlightTrail(parent, { surfaceHeight: () => 0 });
  for (let i = 0; i <= 192; i++) {
    smallTime.update(frame(i / 16, i * 2));
    largeTime.update(frame(1e9 + i / 16, i * 2));
  }
  assert.equal(smallTime.diagnostics.pointCount, largeTime.diagnostics.pointCount);
  assert.deepEqual(
    smallTime.geometry.attributes.aBirth.array,
    largeTime.geometry.attributes.aBirth.array,
  );
  assert.equal(largeTime.material.uniforms.uTime.value, 0);
  assert.ok(
    largeTime.geometry.attributes.aBirth.array
      .slice(0, largeTime.diagnostics.pointCount * 2)
      .every((age) => age > -10 && age <= 0),
  );
  smallTime.dispose();
  largeTime.dispose();
  pass('large external timestamps retain identical Float32 fade ages through local rebasing');

  const { SimulationRuntime, defaultSimulationState, PROTOCOL } = await load(
    'aircraft/skytrans/core/simulation.ts',
  );
  const runtime = new SimulationRuntime();
  const eventTrail = new FlightTrail(parent, { surfaceHeight: () => 0 });
  let revision = 0;
  runtime.connect();
  const updateRuntimeTrail = () => {
    const state = runtime.getRenderSample().state;
    eventTrail.update({
      time: state.time.seconds,
      position: new T.Vector3(...state.positionM),
      generation: `skytrans:external:${runtime.getPresentationRevision()}`,
      enabled: true,
    });
  };
  const receive = (op, seconds, x, extra = {}) => {
    const state = defaultSimulationState();
    state.owner = 'external';
    state.positionM = [x, 100, 0];
    state.time = { ...state.time, seconds, paused: false };
    const event = {
      protocol: PROTOCOL,
      revision: revision++,
      op,
      state,
      ...(op === 'step' ? { dt: 0.1 } : {}),
      ...extra,
    };
    assert.equal(runtime.accept(event), true);
    updateRuntimeTrail();
    return event;
  };
  receive('snapshot', 10, 0);
  const initialRevision = runtime.getPresentationRevision();
  receive('step', 10.1, 1);
  assert.equal(runtime.getPresentationRevision(), initialRevision);
  assert.equal(eventTrail.diagnostics.pointCount, 2);
  receive('set', 10.2, 2);
  assert.equal(runtime.getPresentationRevision(), initialRevision);
  assert.equal(eventTrail.diagnostics.pointCount, 3);
  const beforeShortSeek = eventTrail.diagnostics.resetCount;
  const seekEvent = receive('seek', 10.3, 3);
  assert.ok(eventTrail.diagnostics.resetCount > beforeShortSeek);
  assert.equal(eventTrail.diagnostics.pointCount, 1);
  const afterSeekRevision = runtime.getPresentationRevision();
  assert.equal(runtime.accept(seekEvent), false);
  assert.equal(runtime.getPresentationRevision(), afterSeekRevision);
  receive('step', 10.4, 4);
  assert.equal(eventTrail.diagnostics.pointCount, 2);
  receive('set', 10.4, 4.5);
  assert.equal(eventTrail.diagnostics.pointCount, 1);
  assert.equal(eventTrail.diagnostics.resetReason, 'frozen-pose-change');
  for (const [op, extra] of [
    ['set', { resync: true }],
    ['snapshot', {}],
    ['interrupt', {}],
    ['reset', {}],
  ]) {
    const before = eventTrail.diagnostics.resetCount;
    receive(op, 10.5, 5, extra);
    assert.ok(eventTrail.diagnostics.resetCount > before, op);
    assert.equal(eventTrail.diagnostics.pointCount, 1, op);
  }
  assert.equal('presentationRevision' in runtime.getSnapshot(), false);
  assert.equal('presentationRevision' in runtime.getSnapshot().state, false);
  runtime.replay(
    JSON.stringify({
      protocol: PROTOCOL,
      commands: [
        { op: 'seek', payload: { seconds: 20, state: { positionM: [0, 100, 0] } } },
        { op: 'step', payload: { dt: 0.1 } },
        { op: 'seek', payload: { seconds: 20.2, state: { positionM: [1, 100, 0] } } },
        { op: 'step', payload: { dt: 0.1 } },
      ],
    }),
  );
  runtime.playReplay(true);
  runtime.advanceReplay(0);
  updateRuntimeTrail();
  const beforeRecordSeek = runtime.getPresentationRevision();
  const beforeRecordReset = eventTrail.diagnostics.resetCount;
  runtime.advanceReplay(0.1);
  updateRuntimeTrail();
  assert.ok(runtime.getPresentationRevision() > beforeRecordSeek);
  assert.ok(eventTrail.diagnostics.resetCount > beforeRecordReset);
  assert.equal(eventTrail.diagnostics.pointCount, 1);
  eventTrail.dispose();
  runtime.dispose();
  pass(
    'Python short forward seek/resync/snapshot/interrupt/reset and JSON internal seek clear the trail; normal step/set retain continuity',
  );

  for (let z = -3900; z <= 3900; z += 19) {
    assert.ok(groundHeight(riverX(z), z) < WATER_LEVEL, 'river has a carved bed');
    for (const side of [-1, 1])
      assert.ok(
        groundHeight(riverX(z) + side * riverWidth(z) * 1.04, z) < WATER_LEVEL,
        'water edge stays within banks',
      );
  }
  for (const lake of LAKES) {
    assert.ok(groundHeight(lake.x, lake.z) < WATER_LEVEL);
    for (let i = 0; i < 80; i++) {
      const angle = (i / 80) * Math.PI * 2,
        r = 0.94 * (1 + 0.075 * Math.sin(angle * 3) + 0.045 * Math.sin(angle * 7 + 1));
      assert.ok(
        groundHeight(
          lake.x + lake.rx * r * Math.cos(angle),
          lake.z + lake.rz * r * Math.sin(angle),
        ) < WATER_LEVEL,
        'lake is inside a basin',
      );
    }
  }
  for (const site of SETTLEMENTS)
    for (const dx of [-64, 0, 64])
      for (const dz of [-site.rows * 8, 0, site.rows * 8])
        assert.equal(groundHeight(site.x + dx, site.z + dz), site.elevation);
  for (let x = -4000; x <= 4000; x += 67)
    for (let z = -4000; z <= 4000; z += 71) {
      assert.ok(Number.isFinite(groundHeight(x, z)));
      assert.ok(groundHeight(x, z) <= MAX_TERRAIN_HEIGHT);
      assert.ok(groundHeight(x, z) <= obstacleCeiling(x, z));
    }
  for (const site of SETTLEMENTS)
    for (let row = 0; row < site.rows; row++)
      for (let col = -3; col <= 3; col++) {
        const x = site.x + col * 18,
          z = site.z + (row - (site.rows - 1) / 2) * 18;
        for (const dz of [-5.5, 0, 5.5])
          assert.ok(
            Math.abs(x - arterialX(z + dz, site.side)) >= 5.5 + 2.7,
            'arterial road and maximum house footprint do not overlap',
          );
      }
  assert.equal(groundHeight(0, 0), 0);
  assert.equal(groundHeight(6, 0), 0);
  pass(
    'one heightfield preserves landing origin, river/lake datum, town foundations and conservative ceiling',
  );
  assert.equal(legacyControlCeiling(2000, 0), 10);
  assert.equal(legacyControlCeiling(100, 0), 10);
  assert.equal(legacyControlCeiling(300, 0), 127);
  assert.equal(legacyControlCeiling(0, 0), 0);
  assert.equal(obstacleCeiling(2000, 0), 127);
  assert.equal(obstacleCeiling(100, 0), 18);
  for (const [radius, expected] of [
    [0, 0],
    [17.9, 0],
    [18.1, 10],
    [100, 10],
    [216.9, 10],
    [217.1, 127],
    [300, 127],
    [1449.9, 127],
    [1450.1, 10],
    [2000, 10],
    [4300, 10],
  ]) {
    for (let i = 0; i < 360; i++) {
      const angle = (i / 180) * Math.PI;
      assert.equal(
        legacyControlCeiling(Math.cos(angle) * radius, Math.sin(angle) * radius),
        expected,
      );
    }
  }
  assert.equal(legacyControlCeiling(10, -10), 4.9);
  assert.equal(legacyControlCeiling(7.2, 7.2), 0.65);
  pass('legacy manual-control guard remains separate from the new visual clearance envelope');

  const world = environment(parent),
    resourceReports = [];
  const ownedGeometries = new Set(),
    ownedMaterials = new Set(),
    disposedGeometries = new Set();
  const watch = () =>
    world.group.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      if (!ownedGeometries.has(object.geometry)) {
        ownedGeometries.add(object.geometry);
        object.geometry.addEventListener('dispose', () => disposedGeometries.add(object.geometry));
      }
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        ownedMaterials.add(material);
    });
  watch();
  for (const q of ['Low', 'Medium', 'High', 'Low', 'High', 'Medium']) {
    // Capture replaced geometry directly: object.geometry itself changes on quality swaps.
    const previous = world.ground.geometry;
    let replaced = false;
    previous.addEventListener('dispose', () => {
      replaced = true;
    });
    const oldQuality = world.diagnostics.quality;
    world.setQuality(q);
    watch();
    if (oldQuality !== q) assert.equal(replaced, true);
    const report = world.diagnostics;
    // Interpolate the actual LOD triangles, not only the analytical heightfield.
    const groundPositions = world.ground.geometry.attributes.position;
    const { rows, columns } = world.ground.geometry.userData;
    const renderedHeight = (x, z) => {
      let first = 0,
        last = rows;
      while (last - first > 1) {
        const mid = Math.floor((first + last) / 2);
        if (groundPositions.getZ(mid * columns) > z) last = mid;
        else first = mid;
      }
      const row = Math.min(rows - 1, first);
      const z0 = groundPositions.getZ(row * columns),
        z1 = groundPositions.getZ((row + 1) * columns);
      const t = (z - z0) / (z1 - z0);
      let left = 0,
        right = columns - 1;
      while (right - left > 1) {
        const mid = Math.floor((left + right) / 2);
        const px =
          groundPositions.getX(row * columns + mid) * (1 - t) +
          groundPositions.getX((row + 1) * columns + mid) * t;
        if (px > x) right = mid;
        else left = mid;
      }
      const a = row * columns + left;
      for (const tri of [
        [a, a + columns, a + 1],
        [a + 1, a + columns, a + columns + 1],
      ]) {
        const [i, j, k] = tri;
        const ax = groundPositions.getX(i),
          az = groundPositions.getZ(i),
          bx = groundPositions.getX(j),
          bz = groundPositions.getZ(j),
          cx = groundPositions.getX(k),
          cz = groundPositions.getZ(k);
        const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den;
        const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den;
        if (u >= -0.0001 && v >= -0.0001 && u + v <= 1.0001)
          return (
            u * groundPositions.getY(i) +
            v * groundPositions.getY(j) +
            (1 - u - v) * groundPositions.getY(k)
          );
      }
      throw new Error('No terrain triangle at ' + [q, x, z]);
    };
    let lakeSamples = 0,
      lakeVisible = 0,
      padMaxError = 0;
    for (const lake of LAKES)
      for (let dx = -0.8; dx <= 0.8; dx += 0.1)
        for (let dz = -0.8; dz <= 0.8; dz += 0.1) {
          if (dx * dx + dz * dz > 0.64) continue;
          lakeSamples++;
          if (renderedHeight(lake.x + dx * lake.rx, lake.z + dz * lake.rz) < WATER_LEVEL)
            lakeVisible++;
        }
    for (let x = -5; x <= 5; x++)
      for (let z = -5; z <= 5; z++)
        padMaxError = Math.max(padMaxError, Math.abs(renderedHeight(x, z) + 0.035));
    assert.ok(
      lakeVisible / lakeSamples > 0.9,
      `actual ${q} lake triangles are underwater: ${lakeVisible}/${lakeSamples}`,
    );
    assert.ok(padMaxError < 0.2, `pad terrain interpolation ${q}: ${padMaxError}`);
    let foundationMaxError = 0;
    for (const site of SETTLEMENTS)
      for (let dx = -60; dx <= 60; dx += 15)
        for (let dz = -(site.rows - 1) * 9 - 5; dz <= (site.rows - 1) * 9 + 5; dz += 12) {
          foundationMaxError = Math.max(
            foundationMaxError,
            Math.abs(renderedHeight(site.x + dx, site.z + dz) - site.elevation + 0.035),
          );
        }
    assert.ok(foundationMaxError < 0.02, `actual ${q} town foundation error ${foundationMaxError}`);
    const road = world.group.getObjectByName('Connected_Valley_Roads').geometry.attributes.position;
    let buriedRoadSamples = 0,
      roadSamples = 0;
    for (let i = 0; i < road.count; i += 13) {
      roadSamples++;
      if (road.getY(i) < renderedHeight(road.getX(i), road.getZ(i)) - 0.15) buriedRoadSamples++;
    }
    assert.equal(buriedRoadSamples, 0, `actual ${q} roads stay on terrain`);
    report.foundationMaxError = foundationMaxError;
    report.buriedRoadFraction = buriedRoadSamples / roadSamples;
    report.lakeVisibleFraction = lakeVisible / lakeSamples;
    report.padInterpolationError = padMaxError;
    resourceReports.push(report);
    assert.equal(report.quality, q);
    assert.ok(report.drawCalls <= 35, JSON.stringify(report));
    assert.ok(
      report.triangles <= (q === 'High' ? 180000 : q === 'Medium' ? 100000 : 45000),
      JSON.stringify(report),
    );
    assert.ok(report.bufferBytes < 8000000, JSON.stringify(report));
    assert.ok(report.geometries <= 20);
    assert.equal(report.textures, 1);
    assert.equal(report.lakes, 2);
    assert.equal(report.settlements, 8);
    assert.equal(report.trees, LANDSCAPE_PROFILES[q].trees);
    const water = world.group.getObjectByName('Connected_River_And_Two_Lakes').geometry.attributes
      .position;
    for (let i = 0; i < water.count; i++) assert.equal(water.getY(i), WATER_LEVEL);
    const vertices = world.ground.geometry.attributes.position;
    for (let i = 0; i < vertices.count; i++)
      assert.ok(
        Math.abs(vertices.getY(i) - groundHeight(vertices.getX(i), vertices.getZ(i)) + 0.035) <
          0.0004,
        'all LODs sample the same terrain',
      );
  }
  pass(
    'Low/Medium/High resource budgets, stable water datum, common terrain semantics and recycled geometry',
  );
  const instance = world.group.getObjectByName('Forest_Trunks'),
    matrix = new T.Matrix4(),
    p = new T.Vector3(),
    scale = new T.Vector3(),
    rotation = new T.Quaternion();
  for (let i = 0; i < instance.instanceMatrix.count; i++) {
    instance.getMatrixAt(i, matrix);
    matrix.decompose(p, rotation, scale);
    assert.ok(Math.hypot(p.x, p.z) >= 29);
    assert.ok(Math.abs(p.x - riverX(p.z)) >= riverWidth(p.z) * 1.8);
    assert.ok(LAKES.every((lake) => lakeRadius(p.x, p.z, lake) >= 1.23));
    assert.ok(SETTLEMENTS.every((site) => settlementDistance(p.x, p.z, site) >= 1.4));
    assert.ok(
      p.y + 6 * scale.y < obstacleCeiling(p.x, p.z),
      'vegetation inside clearance envelope',
    );
  }
  const another = environment(parent);
  assert.deepEqual(
    another.group.getObjectByName('Forest_Trunks').instanceMatrix.array,
    instance.instanceMatrix.array,
  );
  assert.deepEqual(
    another.ground.geometry.attributes.position.array,
    world.ground.geometry.attributes.position.array,
  );
  another.dispose();
  world.group.visible = false;
  assert.equal(world.diagnostics.drawCalls, 0);
  world.group.visible = true;
  const liveGeometry = new Set(),
    liveMaterials = new Set();
  world.group.traverse((object) => {
    if (object instanceof T.Mesh) {
      liveGeometry.add(object.geometry);
      for (const m of Array.isArray(object.material) ? object.material : [object.material])
        liveMaterials.add(m);
    }
  });
  let geometryDisposals = 0,
    materialDisposals = 0,
    textureDisposals = 0;
  for (const g of liveGeometry) g.addEventListener('dispose', () => geometryDisposals++);
  for (const m of liveMaterials) m.addEventListener('dispose', () => materialDisposals++);
  world.ground.material.map.addEventListener('dispose', () => textureDisposals++);
  world.dispose();
  world.dispose();
  world.setQuality('High');
  assert.equal(geometryDisposals, liveGeometry.size);
  assert.equal(materialDisposals, liveMaterials.size);
  assert.equal(textureDisposals, 1);
  assert.equal(world.group.parent, null);
  pass(
    'seeded placement avoids water/towns/pad; scene hide and dispose release owned resources exactly once',
  );

  const { FlightController, routes } = await load('flight.ts');
  const { SkyTransWorldFlight, WORLD_FLIGHT_DURATION } = await load(
    'aircraft/skytrans/worldFlight.ts',
  );
  const frames = JSON.parse(fs.readFileSync('public/flight.json', 'utf8')).frames;
  const ev50 = new FlightController(frames);
  ev50.mode = 'flight';
  const skytrans = new SkyTransWorldFlight(frames);
  const clearanceReports = [];
  for (const route of Object.keys(routes)) {
    ev50.setRoute(route);
    skytrans.setRoute(route);
    for (const [aircraft, duration, sample] of [
      [
        'EV50',
        180,
        (time) => {
          ev50.seek(time);
          return ev50.position;
        },
      ],
      ['SkyTrans', WORLD_FLIGHT_DURATION, (time) => skytrans.sample(time).position],
    ]) {
      const sampledTrail = new FlightTrail(parent);
      let minGround = Infinity,
        minCeiling = Infinity;
      for (let i = 0; i <= Math.round(duration * 30); i++) {
        const time = i / 30,
          position = sample(time);
        if (Math.hypot(position.x, position.z) > 18) {
          const ceiling = obstacleCeiling(position.x, position.z),
            gap = position.y - ceiling - AIRCRAFT_RADIUS;
          assert.ok(gap >= CLEARANCE, `${aircraft} ${route} time=${time} gap=${gap}`);
          minGround = Math.min(
            minGround,
            position.y -
              Math.max(WATER_LEVEL, groundHeight(position.x, position.z)) -
              AIRCRAFT_RADIUS,
          );
          minCeiling = Math.min(minCeiling, gap);
        }
        sampledTrail.update({ time, position, generation: `${aircraft}:${route}`, enabled: true });
        const vertices = sampledTrail.geometry.attributes.position;
        for (let point = 0; point < sampledTrail.diagnostics.pointCount; point++)
          assert.ok(
            vertices.getY(point * 2) >
              groundHeight(vertices.getX(point * 2), vertices.getZ(point * 2)) + 1.9,
          );
      }
      sampledTrail.dispose();
      clearanceReports.push({
        aircraft,
        route,
        samplingHz: 30,
        clearanceRange: 'radial distance > 18m; aircraft radius 4m already deducted',
        minGround,
        minCeiling,
      });
    }
  }
  pass(
    'all EV50 and SkyTrans routes sampled at 30 Hz: terrain/water/obstacle and trail clearance with unchanged mission clocks',
  );
  console.log(
    JSON.stringify(
      {
        cpuOnly: true,
        resourceReports: resourceReports.slice(0, 3),
        clearanceReports,
        cases: passed.length,
      },
      null,
      2,
    ),
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
