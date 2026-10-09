// CPU geometry/resource/pose tests. These do not claim browser or GPU validation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import * as T from 'three';
const temporary = fs.mkdtempSync(path.resolve('.landscape-scenes-test-'));
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
const reports = [];
try {
  const { environment } = await load('environment.ts');
  const { islandSurface, ISLAND_PROFILES } = await load('island-landscape.ts');
  const { islandHeight, ISLANDS, WATER_LEVEL, obstacleCeiling } = await load('terrain.ts');
  const scene = new T.Scene(),
    world = environment(scene),
    stableRoot = world.group;
  const foreign = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
  world.group.add(foreign);
  let foreignDisposed = false;
  foreign.geometry.addEventListener('dispose', () => {
    foreignDisposed = true;
  });
  const sky = world.group.getObjectByName('Blue_Sky_And_Soft_White_Clouds');
  assert.equal(sky.material.depthWrite, false);
  assert.equal(sky.material.toneMapped, false);
  assert.equal(sky.material.fog, false);
  assert.equal(sky.frustumCulled, false);
  assert.ok(sky.renderOrder < 0);
  const cloud = sky.material.uniforms.uCloud.value;
  assert.equal(cloud.image.width, 256);
  assert.equal(cloud.image.height, 128);
  assert.ok(
    new Set(cloud.image.data).size > 100,
    'soft procedural cloud density has broad tonal range',
  );
  for (const camera of [
    new T.PerspectiveCamera(42, 1.44, 0.1, 9000),
    new T.OrthographicCamera(-200, 200, 150, -150, 0.1, 9000),
  ]) {
    camera.position.set(70, 180, 40);
    camera.lookAt(-100, 30, -600);
    camera.updateMatrixWorld();
    sky.onBeforeRender(null, scene, camera, null, null, null);
    assert.deepEqual(
      sky.material.uniforms.uInverseProjection.value.elements,
      camera.projectionMatrixInverse.elements,
    );
    assert.deepEqual(
      sky.material.uniforms.uCameraWorld.value.elements,
      camera.matrixWorld.elements,
    );
    assert.equal(sky.material.uniforms.uOrthographic.value, camera.isOrthographicCamera === true);
    const ray = new T.Vector3(0.3, 0.2, -1).transformDirection(camera.matrixWorld);
    camera.position.addScalar(10000);
    camera.updateMatrixWorld();
    assert.ok(
      ray.distanceTo(new T.Vector3(0.3, 0.2, -1).transformDirection(camera.matrixWorld)) < 1e-10,
    );
    camera.rotateY(0.4);
    camera.updateMatrixWorld();
    assert.ok(
      ray.distanceTo(new T.Vector3(0.3, 0.2, -1).transformDirection(camera.matrixWorld)) > 0.3,
    );
  }
  console.log(
    'PASS scenes: bounded world-direction cloud sky, perspective/orthographic matrices and translation invariance',
  );
  const disposed = new Map();
  const watch = () => {
    world.group.traverse((object) => {
      if (!(object instanceof T.Mesh) || object === foreign) return;
      const resources = [object.geometry, ...[object.material].flat()];
      for (const material of [object.material].flat()) {
        for (const value of Object.values(material))
          if (value instanceof T.Texture) resources.push(value);
        for (const uniform of Object.values(material.uniforms ?? {}))
          if (uniform.value instanceof T.Texture) resources.push(uniform.value);
      }
      for (const resource of resources)
        if (!disposed.has(resource)) {
          disposed.set(resource, 0);
          resource.addEventListener('dispose', () =>
            disposed.set(resource, disposed.get(resource) + 1),
          );
        }
    });
  };
  watch();
  world.setLandscape('islands');
  assert.equal(world.group, stableRoot);
  assert.equal(foreign.parent, stableRoot);
  assert.equal(world.group.getObjectByName('Blue_Sky_And_Soft_White_Clouds'), sky);
  assert.equal(world.diagnostics.profile, 'islands');
  assert.equal(world.diagnostics.islands, 11);
  const oldGround = world.ground;
  world.setLandscape('invalid');
  world.setLandscape('islands');
  assert.equal(world.ground, oldGround, 'same/invalid profile is a no-op');
  for (const q of ['Low', 'Medium', 'High']) {
    world.setQuality(q);
    watch();
    const report = world.diagnostics;
    reports.push(report);
    assert.equal(report.trees, ISLAND_PROFILES[q].trees);
    assert.ok(
      report.triangles <= { Low: 45000, Medium: 100000, High: 180000 }[q],
      JSON.stringify(report),
    );
    assert.ok(
      report.drawCalls <= 12 && report.geometries <= 12 && report.bufferBytes < 8000000,
      JSON.stringify(report),
    );
    assert.equal(report.textures, 1);
    const geometry = world.ground.geometry,
      vertices = geometry.attributes.position,
      indices = geometry.index;
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i),
        z = vertices.getZ(i);
      assert.ok(Math.abs(vertices.getY(i) - islandHeight(x, z) + 0.035) < 0.001);
      if (Math.hypot(x, z) >= 18) assert.ok(vertices.getY(i) <= obstacleCeiling(x, z));
    }
    let maxInterpolationError = 0;
    for (let i = 0; i < indices.count; i += 219) {
      const a = indices.getX(i),
        b = indices.getX(i + 1),
        c = indices.getX(i + 2);
      const x = vertices.getX(a) * 0.2 + vertices.getX(b) * 0.3 + vertices.getX(c) * 0.5;
      const z = vertices.getZ(a) * 0.2 + vertices.getZ(b) * 0.3 + vertices.getZ(c) * 0.5;
      const y = vertices.getY(a) * 0.2 + vertices.getY(b) * 0.3 + vertices.getY(c) * 0.5;
      const actual = islandSurface(geometry, x, z);
      assert.ok(actual >= y - 0.002, 'sampler includes the uppermost overlapping underwater apron');
      if (y > WATER_LEVEL)
        maxInterpolationError = Math.max(maxInterpolationError, Math.abs(actual - y));
    }
    assert.ok(
      maxInterpolationError < 0.002,
      q + ' displayed island triangle lookup ' + maxInterpolationError,
    );
    report.maxInterpolationError = maxInterpolationError;
    for (let x = -5; x <= 5; x++)
      for (let z = -5; z <= 5; z++) {
        assert.equal(islandHeight(x, z), 0);
        assert.ok(
          Math.abs(islandSurface(geometry, x, z) + 0.035) < 0.002,
          'unchanged flat landing pad',
        );
      }
    const sea = world.group.getObjectByName('Blue_Sea_And_Turquoise_Shallows').geometry.attributes
      .position;
    for (let i = 0; i < sea.count; i++) assert.ok(Math.abs(sea.getY(i) - WATER_LEVEL) < 0.00001);
    const trunks = world.group.getObjectByName('Island_Tree_Trunks'),
      crowns = world.group.getObjectByName('Island_Broadleaf_Canopies');
    const matrix = new T.Matrix4(),
      position = new T.Vector3(),
      scale = new T.Vector3(),
      rotation = new T.Quaternion();
    for (let i = 0; i < trunks.count; i++) {
      trunks.getMatrixAt(i, matrix);
      matrix.decompose(position, rotation, scale);
      assert.ok(Math.hypot(position.x, position.z) > 29);
      assert.ok(
        Math.abs(position.y - scale.y / 2 - islandSurface(geometry, position.x, position.z)) <
          0.0001,
        'tree sits on rendered surface',
      );
      assert.ok(islandHeight(position.x, position.z) > 3.2, 'trees avoid sandy/wet shore');
      crowns.getMatrixAt(i, matrix);
      matrix.decompose(position, rotation, scale);
      assert.ok(
        position.y + scale.y < obstacleCeiling(position.x, position.z),
        'crown stays below visual envelope',
      );
    }
  }
  console.log(
    'PASS scenes: three LOD budgets, actual shoreline triangle lookup, flat original pad, dry vegetation and sea datum',
  );
  for (const q of ['Low', 'High', 'Medium'])
    for (const profile of ['mountains', 'islands']) {
      world.setQuality(q);
      watch();
      world.setLandscape(profile);
      watch();
      assert.equal(world.diagnostics.profile, profile);
      assert.equal(world.diagnostics.quality, q);
      assert.equal(world.group, stableRoot);
      assert.equal(foreign.parent, stableRoot);
      assert.equal(
        world.group.children.length,
        3,
        'only one live scenery plus sky and host-owned child',
      );
      assert.ok([...disposed.values()].every((count) => count <= 1));
    }
  world.group.visible = false;
  assert.equal(world.diagnostics.drawCalls, 0);
  world.group.visible = true;
  world.dispose();
  world.dispose();
  world.setLandscape('mountains');
  world.setQuality('High');
  assert.ok(
    [...disposed.values()].every((count) => count === 1),
    'every owned geometry/material disposed once across switches',
  );
  assert.equal(foreignDisposed, false);
  assert.equal(world.diagnostics.disposed, true);
  foreign.geometry.dispose();
  foreign.material.dispose();
  console.log(
    'PASS scenes: repeated quality/profile switches recycle every owned resource once and preserve host children',
  );
  const { FlightController, routes } = await load('flight.ts');
  const { SkyTransWorldFlight, WORLD_FLIGHT_DURATION } = await load(
    'aircraft/skytrans/worldFlight.ts',
  );
  const frames = JSON.parse(fs.readFileSync('public/flight.json', 'utf8')).frames;
  const ev50 = new FlightController(frames);
  ev50.mode = 'flight';
  const skytrans = new SkyTransWorldFlight(frames),
    routeWorld = environment(scene);
  routeWorld.setLandscape('islands');
  for (const q of ['Low', 'Medium', 'High']) {
    routeWorld.setQuality(q);
    for (const route of Object.keys(routes)) {
      ev50.setRoute(route);
      skytrans.setRoute(route);
      for (const [duration, sample] of [
        [
          180,
          (time) => {
            ev50.seek(time);
            return ev50.position;
          },
        ],
        [WORLD_FLIGHT_DURATION, (time) => skytrans.sample(time).position],
      ]) {
        for (let i = 0; i <= Math.round(duration * 30); i++) {
          const position = sample(i / 30);
          if (Math.hypot(position.x, position.z) <= 18) continue;
          assert.ok(
            position.y - routeWorld.surfaceHeight(position.x, position.z) - 4 >= 30,
            q + '/' + route + '/' + i,
          );
          assert.ok(position.y - obstacleCeiling(position.x, position.z) - 4 >= 30);
        }
      }
    }
  }
  routeWorld.dispose();
  console.log(
    'PASS scenes: unchanged EV50/SkyTrans three routes clear actual island LODs and water at 30 Hz (outside 18 m pad radius)',
  );
  console.log(JSON.stringify({ cpuOnly: true, reports }, null, 2));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
