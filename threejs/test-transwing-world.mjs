// Production adapter + real GLB Node checks. Not browser/GPU rendering evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const temporary = fs.mkdtempSync(path.resolve('.transwing-world-test-'));
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
let cases = 0;
const pass = (name) => {
  cases++;
  console.log(`PASS Transwing world: ${name}`);
};
const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const nearVector = (a, b) => assert.ok(a.distanceTo(b) < 1e-7, `${a.toArray()} != ${b.toArray()}`);
try {
  const {
    TranswingWorldFlight,
    WORLD_FLIGHT_DURATION,
    WORLD_FLIGHT_PHASES,
    worldToLegacyPosition,
    legacyToWorldPosition,
    bodyGroundOffset,
    TRANSWING_COORDINATES,
  } = await load('aircraft/transwing/worldFlight.ts');
  const { FlightController } = await load('flight.ts');
  const { obstacleCeiling, AIRCRAFT_RADIUS } = await load('terrain.ts');
  const frames = JSON.parse(fs.readFileSync('public/flight.json', 'utf8')).frames;
  const adapter = new TranswingWorldFlight(frames),
    reference = new FlightController(frames);
  reference.mode = 'flight';
  assert.equal(WORLD_FLIGHT_DURATION, reference.duration);
  assert.equal(WORLD_FLIGHT_DURATION, 180);
  for (const route of ['valley', 'plateau', 'ridge']) {
    adapter.setRoute(route);
    reference.setRoute(route);
    const cachedPath = adapter.path;
    let distance = 0,
      maxAltitude = 0,
      maxSpeed = 0;
    const previous = adapter.sample(0).position.clone(),
      previousQuaternion = adapter.sample(0).quaternion.clone();
    for (let time = 0; time <= WORLD_FLIGHT_DURATION; time += 0.1) {
      const sample = adapter.sample(time);
      reference.seek(time);
      nearVector(sample.position, reference.position);
      near(sample.quaternion.angleTo(reference.quaternion), 0);
      near(sample.speedMps, reference.speedMps);
      near(sample.quaternion.length(), 1);
      assert.ok(previousQuaternion.angleTo(sample.quaternion) < 0.2, 'continuous quaternion');
      distance += sample.position.distanceTo(previous);
      maxAltitude = Math.max(maxAltitude, sample.position.y);
      maxSpeed = Math.max(maxSpeed, sample.speedMps);
      if (Math.hypot(sample.position.x, sample.position.z) > 60)
        assert.ok(
          sample.position.y - obstacleCeiling(sample.position.x, sample.position.z) >
            AIRCRAFT_RADIUS,
          'terrain clearance',
        );
      previous.copy(sample.position);
      previousQuaternion.copy(sample.quaternion);
    }
    assert.ok(distance > 2500, `route travel ${distance}`);
    assert.ok(maxAltitude > 150, `altitude ${maxAltitude}`);
    assert.ok(maxSpeed > 15 && maxSpeed < 100, `visual speed ${maxSpeed}`);
    assert.equal(adapter.path, cachedPath, 'cache path between route changes');
    nearVector(adapter.sample(180).position, new T.Vector3());
    pass(
      `${route}: exact shared trajectory, kilometre travel, terrain clearance, continuous quaternion and cached path`,
    );
  }
  for (const phase of WORLD_FLIGHT_PHASES)
    assert.equal(adapter.sample(phase.start + 0.001).state, phase.state, phase.id);
  for (const [time, expected] of [
    [0, 0],
    [16, 0],
    [18, 0],
    [42, 1],
    [100, 1],
    [138, 1],
    [162, 0],
    [180, 0],
  ])
    near(adapter.sample(time).wingTilt, expected);
  for (const boundary of [18, 42, 138, 162])
    assert.ok(
      Math.abs(
        adapter.sample(boundary - 1e-4).wingTilt - adapter.sample(boundary + 1e-4).wingTilt,
      ) < 1e-5,
    );
  const cruise = adapter.sample(90);
  assert.equal(cruise.motors.L_Rear.enabled, false);
  assert.equal(cruise.motors.R_Rear.enabled, false);
  assert.equal(cruise.motors.L_Front.enabled, true);
  assert.ok(Object.values(adapter.sample(17).motors).every((motor) => motor.enabled));
  pass('wing/motor schedule follows shared route phases and continuous conversion endpoints');

  // Decode actual mesh data; texture decoding needs a browser and is outside these geometry checks.
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(() => ({
    name: 'NodeGeometryOnly',
    loadTexture: () => Promise.resolve(new T.Texture()),
  }));
  const parse = async (file) => {
    const bytes = fs.readFileSync(file);
    return (
      await loader.parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        '',
      )
    ).scene;
  };
  const transwing = await parse('public/transwing/models/xp4.glb'),
    ev50 = await parse('public/ev50.glb');
  const get = (scene, name) => {
    const object = scene.getObjectByName(name);
    assert.ok(object, name);
    return object.getWorldPosition(new T.Vector3());
  };
  assert.ok(get(transwing, 'Ventral_small_sensor').z > get(transwing, 'Tail_boom_join').z);
  assert.ok(get(ev50, 'Nose_Sensor').z > get(ev50, 'Cruise_Tail_Nacelle').z);
  assert.ok(get(transwing, 'BraceBody_L').x < get(transwing, 'BraceBody_R').x);
  assert.ok(get(ev50, 'Left_Front_Upper_Motor').x < get(ev50, 'Right_Front_Upper_Motor').x);
  assert.equal(TRANSWING_COORDINATES.scale, 1);
  const { createModelRig, measureModelRig, applyModelPose } = await load(
    'aircraft/transwing/core/rig.ts',
  );
  const rig = createModelRig(transwing),
    measurements = measureModelRig(rig);
  applyModelPose(rig, 0);
  const datum = new T.Group(),
    body = new T.Group();
  datum.add(body);
  body.add(transwing);
  body.position.y = bodyGroundOffset(measurements.groundOffset);
  datum.updateMatrixWorld(true);
  const grounded = new T.Box3().setFromObject(transwing);
  near(grounded.min.y, 0, 1e-5);
  assert.ok(grounded.getSize(new T.Vector3()).z > 4);
  near(datum.matrixWorld.determinant(), 1);
  near(body.matrixWorld.determinant(), 1);
  pass(
    'real GLBs verify +Z nose, +X right, identity alignment, metre scale and shared Y0 grounding',
  );
  const legacy = [42, 19, -73],
    attitude = new T.Quaternion().setFromEuler(new T.Euler(0.3, 1.2, -0.2));
  datum.position.copy(legacyToWorldPosition(legacy));
  datum.quaternion.copy(attitude);
  body.position
    .set(0, bodyGroundOffset(measurements.groundOffset), 0)
    .applyQuaternion(attitude.clone().invert());
  datum.updateMatrixWorld(true);
  nearVector(
    body.getWorldPosition(new T.Vector3()),
    new T.Vector3(legacy[0], legacy[1] + measurements.groundOffset, legacy[2]),
  );
  near(body.getWorldQuaternion(new T.Quaternion()).angleTo(attitude), 0);
  assert.deepEqual(worldToLegacyPosition(legacyToWorldPosition(legacy).toArray()), legacy);
  pass('banked/pitched pose conversion preserves exact historical rig origin/quaternion');
  const { trackingCameraPose } = await load('aircraft/transwing/flightCamera.ts');
  const anchor = new T.Vector3(300, 180, -400);
  for (const view of ['follow', 'wide', 'fpv', 'down']) {
    const pose = trackingCameraPose(view, anchor, attitude),
      translated = trackingCameraPose(view, anchor.clone().add(new T.Vector3(20, 3, 10)), attitude);
    nearVector(translated.position.clone().sub(pose.position), new T.Vector3(20, 3, 10));
    nearVector(translated.target.clone().sub(pose.target), new T.Vector3(20, 3, 10));
    near(pose.up.length(), 1);
    const camera = new T.PerspectiveCamera();
    camera.position.copy(pose.position);
    camera.up.copy(pose.up);
    camera.lookAt(pose.target);
    assert.ok(camera.quaternion.toArray().every(Number.isFinite));
  }
  const fpv = trackingCameraPose('fpv', new T.Vector3(), new T.Quaternion());
  assert.ok(fpv.position.z > 2.01 && fpv.target.z > fpv.position.z);
  const down = trackingCameraPose('down', new T.Vector3(), new T.Quaternion());
  assert.ok(down.target.y < down.position.y);
  pass(
    'native follow/wide/FPV/down mounts rotate and translate coherently without EV50 geometry assumptions',
  );

  const { SimulationRuntime } = await load('aircraft/transwing/core/simulation.ts');
  const { TranswingControlAdapter } = await load('aircraft/transwing/controlAdapter.ts');
  const runtime = new SimulationRuntime();
  runtime.setReady(true);
  runtime.setLocal({ positionM: worldToLegacyPosition([0, 0, 0]), time: { seconds: 45 } });
  const control = new TranswingControlAdapter(runtime);
  control.acquire({ controlMode: 'external', clock: 'external' });
  near(runtime.getSnapshot().state.time.seconds, 0);
  control.external({
    operation: 'aircraft.pose',
    payload: {
      positionM: [30, 160, -50],
      attitude: attitude.toArray(),
      timeSeconds: 3,
      velocityMps: [5, 2, -1],
    },
  });
  const accepted = structuredClone(runtime.getSnapshot());
  for (let i = 0; i < 180; i++) runtime.advancePresentation(1 / 60);
  assert.deepEqual(runtime.getSnapshot().state, accepted.state);
  assert.deepEqual(runtime.getSnapshot().actuators, accepted.actuators);
  assert.equal(runtime.setLocal({ wingTilt: 0.9 }), false);
  assert.equal(runtime.stepLocal(20), false);
  nearVector(
    legacyToWorldPosition(runtime.getSnapshot().state.positionM),
    new T.Vector3(30, 160, -50),
  );
  pass(
    'external acquisition resets clock0 and RAF never advances authoritative time, velocity or motors',
  );
  const beforeInvalid = structuredClone(runtime.getSnapshot()),
    beforeVelocity = [...control.velocity];
  assert.throws(() =>
    control.external({
      operation: 'aircraft.pose',
      payload: { positionM: [999, 999, 999], velocityMps: [NaN, 0, 0] },
    }),
  );
  assert.throws(() =>
    control.external({
      operation: 'transwing.mechanism',
      payload: { wingTilt: 0.8, hatchDeg: 60 },
    }),
  );
  assert.throws(
    () => control.external({ operation: 'aircraft.pose', payload: { timeSeconds: 2 } }),
    /backwards/,
  );
  assert.deepEqual(runtime.getSnapshot(), beforeInvalid);
  assert.deepEqual(control.velocity, beforeVelocity);
  pass('invalid pose/velocity/mechanism and time regression reject atomically');
  control.external({
    operation: 'transwing.motors',
    payload: { motors: { L_Front: { enabled: true, targetRpm: 1800 } } },
  });
  assert.throws(() => control.external({ operation: 'clock.step', payload: { dt: 1 } }), /Resume/);
  control.external({ operation: 'transport.play', payload: {} });
  control.external({ operation: 'clock.step', payload: { dt: 2 } });
  near(runtime.getSnapshot().state.time.seconds, 5);
  nearVector(
    legacyToWorldPosition(runtime.getSnapshot().state.positionM),
    new T.Vector3(40, 164, -52),
  );
  assert.ok(
    runtime.getSnapshot().actuators.L_Front.fold < 1 ||
      runtime.getSnapshot().actuators.L_Front.rpm > 0,
  );
  const events = [];
  runtime.onEvent((event) => events.push(event));
  control.external({ operation: 'transwing.mechanism', payload: { wingTilt: 0.5 } });
  assert.deepEqual(
    events.filter((event) => event.type !== 'state').map((event) => event.type),
    ['accepted'],
  );
  runtime.markApplied(runtime.getSnapshot().revision);
  assert.deepEqual(
    events.filter((event) => event.type !== 'state').map((event) => event.type),
    ['accepted', 'applied'],
  );
  control.release();
  assert.equal(runtime.getSnapshot().control, 'local');
  assert.ok(Object.values(runtime.getSnapshot().state.motors).every((motor) => !motor.enabled));
  pass('explicit step alone advances pose/motors/time, apply precedes ACK, release resets safely');
  runtime.replay(JSON.stringify({ protocol: 'transwing.sim.v1', commands: [] }));
  assert.throws(
    () => control.acquire({ controlMode: 'local', clock: 'host' }),
    /Release Python or JSON replay/,
  );
  runtime.dispose();
  pass('unified lease cannot seize legacy JSON replay ownership');
  // Exercise the production instance methods, with only DOM/render endpoints stubbed.
  const instanceSource = fs.readFileSync('src/aircraft/transwing/index.ts', 'utf8');
  const parsed = ts.createSourceFile('index.ts', instanceSource, ts.ScriptTarget.ES2022, true);
  const declaration = parsed.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === 'TranswingInstance',
  );
  const methodNames = [
    'local',
    'changeMode',
    'startFlightAt',
    'dispatch',
    'manual',
    'syncLocal',
    'playPause',
    'restart',
    'seek',
    'setSpeed',
    'setLoop',
    'snapshot',
    'setControlLease',
    'applyControl',
    'normalizedState',
    'worldState',
  ];
  const methods = methodNames.map((name) =>
    declaration.members
      .find((node) => ts.isMethodDeclaration(node) && node.name.getText(parsed) === name)
      .getText(parsed),
  );
  const { beginLocalControl } = await load('aircraft/transwing/core/uiControl.ts');
  const { experienceReducer, INITIAL_EXPERIENCE, displayedUnfold } = await load(
    'aircraft/transwing/core/experience.ts',
  );
  const { newMotorCommands } = await load('aircraft/transwing/core/motors.ts');
  const { detailSurfaces, NEUTRAL_DETAIL_POSE } = await load('aircraft/transwing/core/details.ts');
  const { prepareManualInput } = await load('aircraft/transwing/localControl.ts');
  const { buildTranswingSnapshot } = await load('aircraft/transwing/snapshot.ts');
  const { applyStatePatch } = await load('aircraft/transwing/core/simulation.ts');
  const dependencies = {
    beginLocalControl,
    experienceReducer,
    INITIAL_EXPERIENCE,
    displayedUnfold,
    WORLD_FLIGHT_DURATION,
    worldToLegacyPosition,
    legacyToWorldPosition,
    newMotorCommands,
    detailSurfaces,
    NEUTRAL_DETAIL_POSE,
    prepareManualInput,
    buildTranswingSnapshot,
    applyStatePatch,
    THREE: T,
  };
  const compiledClass = ts.transpileModule(`class InstanceMethods { ${methods.join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const Instance = new Function(
    ...Object.keys(dependencies),
    `${compiledClass}; return InstanceMethods;`,
  )(...Object.values(dependencies));
  const instance = new Instance(),
    localRuntime = new SimulationRuntime();
  localRuntime.setReady(true);
  let frameCalls = 0;
  Object.assign(instance, {
    runtime: localRuntime,
    unified: new TranswingControlAdapter(localRuntime),
    state: experienceReducer(structuredClone(INITIAL_EXPERIENCE), { type: 'enter-tilt' }),
    flight: new TranswingWorldFlight(frames),
    bridge: { close: () => Promise.resolve() },
    loader: { cancel() {}, loading: false },
    host: { setSceneMode() {}, clearTrail() {} },
    mode: 'product',
    rate: 1,
    loop: true,
    wireframe: false,
    disposed: false,
    manualPaused: false,
    applyingControl: false,
    internalDrive: false,
    frame: () => frameCalls++,
    loadConcept: () => Promise.resolve(),
  });
  instance.syncLocal();
  instance.setControlLease({ controlMode: 'local', clock: 'host' });
  instance.applyControl({
    operation: 'transwing.mechanism',
    payload: { wingTilt: 0.65, hatchDeg: 20, surfaces: { L_Inboard: 7 } },
  });
  instance.syncLocal();
  near(localRuntime.getSnapshot().state.wingTilt, 0.65);
  near(localRuntime.getSnapshot().state.hatchDeg, 20);
  near(localRuntime.getSnapshot().state.surfaces.L_Inboard, 7);
  instance.applyControl({
    operation: 'transwing.motors',
    payload: { motors: { R_Front: { targetRpm: 2400, enabled: true } } },
  });
  instance.syncLocal();
  assert.equal(localRuntime.getSnapshot().state.motors.R_Front.targetRpm, 2400);
  instance.applyControl({ operation: 'transport.pause', payload: {} });
  instance.syncLocal();
  assert.equal(localRuntime.getSnapshot().state.time.paused, true);
  instance.applyControl({ operation: 'transport.play', payload: {} });
  instance.syncLocal();
  assert.equal(localRuntime.getSnapshot().state.time.paused, false);
  instance.applyControl({ operation: 'transport.speed', payload: { speed: 1.5 } });
  assert.equal(instance.rate, 1.5);
  instance.applyControl({
    operation: 'transport.seek',
    payload: { position: 35, unit: 'percent' },
  });
  near(localRuntime.getSnapshot().state.wingTilt, 0.35);
  assert.equal(frameCalls, 0, 'mechanism, motor and transport commands never frame the camera');
  const beforeUi = structuredClone(localRuntime.getSnapshot());
  instance.manual({ wingTilt: 0.9 });
  instance.dispatch({ type: 'tilt', action: { type: 'scrub', progress: 0.9 } });
  instance.seek(95);
  instance.setSpeed(4);
  instance.setLoop(false);
  assert.deepEqual(localRuntime.getSnapshot(), beforeUi);
  assert.equal(instance.rate, 1.5);
  assert.equal(instance.loop, true);
  assert.throws(() =>
    instance.applyControl({
      operation: 'transwing.mechanism',
      payload: { wingTilt: 0.1, hatchDeg: 99 },
    }),
  );
  assert.deepEqual(localRuntime.getSnapshot(), beforeUi);
  assert.equal(instance.applyingControl, false);
  instance.setControlLease(null);
  instance.manual({ wingTilt: 0.7 });
  near(localRuntime.getSnapshot().state.wingTilt, 0.7);
  instance.dispatch({ type: 'set', key: 'autoRotate', value: true });
  assert.equal(instance.state.autoRotate, true, 'explicit auto-orbit checkbox enables rotation');
  instance.dispatch({ type: 'tilt', action: { type: 'scrub', progress: 0.25 } });
  assert.equal(instance.state.autoRotate, true, 'mechanism buttons preserve chosen camera orbit');
  instance.dispatch({ type: 'set', key: 'autoRotate', value: false });
  assert.equal(instance.state.autoRotate, false, 'explicit auto-orbit checkbox disables rotation');
  assert.equal(frameCalls, 0, 'camera orbit preferences never implicitly reframe the model');
  pass('explicit auto-orbit toggles remain effective while mechanism actions preserve them');
  localRuntime.dispose();
  pass(
    'production local-host API changes motors/mechanisms/transport while UI is locked, releases cleanly, and never changes camera',
  );

  const source = fs.readFileSync('src/aircraft/transwing/index.ts', 'utf8');
  assert.ok(
    !/new TranswingPresentation|toneMapping|PMREM|scene\.background|scene\.fog\s*=|scene\.environment\s*=|requestAnimationFrame/.test(
      source,
    ),
  );
  assert.ok(
    !/GridHelper|PlaneGeometry|DirectionalLight|PointLight|HemisphereLight|PMREM/.test(
      fs.readFileSync('src/aircraft/transwing/presentation.ts', 'utf8'),
    ),
  );
  pass('no private environment, floor, grid, light, PMREM, exposure or animation loop');
  console.log(`PASS Transwing world (${cases} cases; Node, not browser/GPU rendering)`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
