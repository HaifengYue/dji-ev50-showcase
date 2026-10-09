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
  const { DEMO_TIMES, TRANSWING_DEMO_PROFILE, sharedDemoTime, demoVertical, DemoMotorTimeline } =
    await load('aircraft/transwing/demoProfile.ts');
  const { obstacleCeiling, AIRCRAFT_RADIUS } = await load('terrain.ts');
  const frames = JSON.parse(fs.readFileSync('public/flight.json', 'utf8')).frames;
  const adapter = new TranswingWorldFlight(frames),
    reference = new FlightController(frames);
  reference.mode = 'flight';
  assert.equal(reference.duration, 180, 'EV50 clock is unchanged');
  assert.equal(WORLD_FLIGHT_DURATION, 316);
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
      reference.seek(sharedDemoTime(time).time);
      near(sample.position.x, reference.position.x);
      near(sample.position.z, reference.position.z);
      near(sample.position.y, demoVertical(time).altitude);
      near(sample.quaternion.angleTo(reference.quaternion), 0);
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
    nearVector(adapter.sample(WORLD_FLIGHT_DURATION).position, new T.Vector3());
    pass(
      `${route}: retimed shared horizontal trajectory, kilometre travel, terrain clearance, continuous quaternion and cached path`,
    );
  }
  for (const phase of WORLD_FLIGHT_PHASES)
    assert.equal(adapter.sample(phase.start + 0.001).state, phase.state, phase.id);
  for (const [time, expected] of [
    [0, 0],
    [DEMO_TIMES.hover, 0],
    [DEMO_TIMES.transition, 0],
    [DEMO_TIMES.cruise, 1],
    [DEMO_TIMES.return, 1],
    [DEMO_TIMES.hoverReturn, 0],
    [WORLD_FLIGHT_DURATION, 0],
  ])
    near(adapter.sample(time).wingTilt, expected);
  for (const boundary of [
    DEMO_TIMES.transition,
    DEMO_TIMES.cruise,
    DEMO_TIMES.return,
    DEMO_TIMES.hoverReturn,
  ])
    assert.ok(
      Math.abs(
        adapter.sample(boundary - 1e-4).wingTilt - adapter.sample(boundary + 1e-4).wingTilt,
      ) < 1e-5,
    );
  const cruise = adapter.sample(DEMO_TIMES.cruise + 10);
  assert.equal(cruise.motors.L_Rear.enabled, false);
  assert.equal(cruise.motors.R_Rear.enabled, false);
  assert.equal(cruise.motors.L_Front.enabled, true);
  assert.ok(Object.values(adapter.sample(17).motors).every((motor) => motor.enabled));
  pass('wing/motor schedule follows shared route phases and continuous conversion endpoints');

  let climbPeak = 0,
    descentPeak = 0,
    accelerationPeak = 0;
  for (let t = 0.01; t < WORLD_FLIGHT_DURATION; t += 0.01) {
    const current = demoVertical(t),
      before = demoVertical(t - 1e-4),
      after = demoVertical(t + 1e-4);
    near((after.altitude - before.altitude) / 2e-4, current.velocity, 1e-7);
    near((after.velocity - before.velocity) / 2e-4, current.acceleration, 3e-5);
    climbPeak = Math.max(climbPeak, current.velocity);
    descentPeak = Math.max(descentPeak, -current.velocity);
    accelerationPeak = Math.max(accelerationPeak, Math.abs(current.acceleration));
  }
  near(climbPeak, 3);
  near(descentPeak, 2);
  near(accelerationPeak, 1.125, 1e-5);
  for (const boundary of [0, ...Object.values(DEMO_TIMES), WORLD_FLIGHT_DURATION]) {
    const before = demoVertical(boundary - 1e-5),
      after = demoVertical(boundary + 1e-5);
    assert.ok(Math.abs(before.altitude - after.altitude) < 0.0001);
    assert.ok(Math.abs(before.velocity - after.velocity) < 0.0001);
    assert.ok(Math.abs(before.acceleration - after.acceleration) < 0.0001);
  }
  // Sample the real adapter around each point, not only a standalone profile/display formula.
  for (const t of [6, 8, 34, 66, 68, 70, 100.123, 140.321, 216, 220, 265, 308, 310]) {
    const a = adapter.sample(t - 1e-5).position.clone(),
      b = adapter.sample(t + 1e-5).position.clone(),
      sampled = adapter.sample(t);
    near((b.y - a.y) / 2e-5, sampled.verticalSpeedMps, 1e-6);
    near(b.distanceTo(a) / 2e-5, sampled.speedMps, 0.02);
  }
  pass(
    'actual route dy/dt matches HUD data; climb 3m/s, descent 2m/s, acceleration and seams bounded',
  );
  const motorTimeline = new DemoMotorTimeline();
  const { MOTOR_IDS, stepMotor, newMotorState } = await load('aircraft/transwing/core/motors.ts');
  for (const t of [
    4,
    34.123,
    DEMO_TIMES.cruise,
    DEMO_TIMES.return,
    DEMO_TIMES.shutdown,
    WORLD_FLIGHT_DURATION,
  ]) {
    const direct = new DemoMotorTimeline().sample(t);
    assert.deepEqual(motorTimeline.sample(t), direct, 'seek is identical to cached progression');
  }
  const parked = motorTimeline.sample(WORLD_FLIGHT_DURATION);
  for (const id of MOTOR_IDS) assert.deepEqual(parked[id], newMotorState());
  for (const id of ['L_Rear', 'R_Rear']) {
    assert.equal(motorTimeline.sample(DEMO_TIMES.cruise)[id].fold, 1);
    assert.equal(motorTimeline.sample(DEMO_TIMES.return)[id].rpm, TRANSWING_DEMO_PROFILE.hoverRpm);
    assert.equal(motorTimeline.sample(DEMO_TIMES.return)[id].fold, 0);
  }
  for (let t = 0; t <= WORLD_FLIGHT_DURATION; t += 0.1) {
    for (const motor of Object.values(motorTimeline.sample(t))) {
      if (motor.fold > 0) {
        near(motor.rpm, 0);
        near(motor.phase, 0);
      }
    }
  }
  const phaseA = motorTimeline.sample(30).L_Front.phase,
    phaseB = motorTimeline.sample(30 + 1 / 120).L_Front.phase;
  near(
    (phaseB - phaseA + Math.PI * 2) % (Math.PI * 2),
    ((TRANSWING_DEMO_PROFILE.takeoffRpm / 60) * Math.PI * 2) / 120,
    1e-6,
  );
  assert.equal(motorTimeline.exposure(30, 0.1), null);
  assert.equal(motorTimeline.exposure(30, 1).samples.length, 16);
  assert.equal(motorTimeline.exposure(WORLD_FLIGHT_DURATION, 4), null);
  pass(
    'RPM phase is exact, seeking is deterministic, slow playback is crisp, rear and final stop/fold order is complete',
  );

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
    'update',
    'setMode',
    'setView',
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
    newMotorStates: () => Object.fromEntries(MOTOR_IDS.map((id) => [id, newMotorState()])),
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
  let frameCalls = 0,
    followCalls = 0;
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
    lastControl: 'local',
    panel: null,
    paint() {},
    root: new T.Group(),
    body: new T.Group(),
    camera: {
      view: 'free',
      setAutoRotate() {},
      setInternal() {},
      update() {},
      setFlightView(view) {
        this.view = view;
        followCalls++;
      },
    },
    frame: () => {
      frameCalls++;
      instance.camera.view = instance.state.inspection ? 'inspection' : 'free';
    },
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
  pass(
    'production local-host API changes motors/mechanisms/transport while UI is locked, releases cleanly, and never changes camera',
  );

  instance.setMode('flight');
  assert.equal(instance.mode, 'flight');
  assert.equal(instance.state.playing, true);
  assert.equal(instance.state.time, 0);
  assert.equal(instance.state.tiltMode, false);
  assert.equal(instance.camera.view, 'follow');
  assert.equal(followCalls, 1);
  assert.equal(frameCalls, 0);
  assert.equal(localRuntime.getSnapshot().state.time.paused, false);
  pass('explicit product-to-flight entry starts the mission and initializes follow once');

  instance.state = { ...instance.state, time: 37.25 };
  instance.syncLocal();
  const runningSnapshot = localRuntime.getSnapshot();
  instance.setMode('flight');
  instance.setMode('flight');
  assert.equal(
    localRuntime.getSnapshot(),
    runningSnapshot,
    'repeated Flight clicks are fully inert',
  );
  assert.equal(instance.state.time, 37.25);
  assert.equal(instance.state.playing, true);
  assert.equal(followCalls, 1);
  instance.camera.view = 'wide'; // An observer-selected view must survive pause/resume.
  instance.playPause();
  assert.equal(instance.state.playing, false);
  assert.equal(instance.camera.view, 'wide');
  instance.setMode('flight');
  assert.equal(instance.state.time, 37.25);
  assert.equal(instance.state.playing, true);
  assert.equal(instance.camera.view, 'wide');
  assert.equal(followCalls, 1);
  assert.equal(frameCalls, 0);
  pass(
    'repeated Flight clicks do not reset time and paused Flight resumes without changing the chosen camera',
  );

  // Exercise production RAF update, with rendering endpoints stubbed only.
  instance.seek(30);
  instance.setSpeed(1);
  instance.state = { ...instance.state, playing: true };
  instance.syncLocal();
  const runningMotors = structuredClone(localRuntime.getSnapshot().actuators);
  instance.playPause();
  assert.deepEqual(
    localRuntime.getSnapshot().actuators,
    runningMotors,
    'pause never parks running rotors',
  );
  instance.update(0.1, 0);
  assert.deepEqual(localRuntime.getSnapshot().actuators, runningMotors);
  instance.playPause();
  assert.deepEqual(localRuntime.getSnapshot().actuators, runningMotors, 'resume preserves phase');
  for (const rate of [0.1, 0.25, 0.5, 1, 2, 4]) {
    instance.seek(30);
    instance.setSpeed(rate);
    instance.state = { ...instance.state, playing: true };
    for (let i = 0; i < 10; i++) instance.update(0.025, 0);
    near(localRuntime.getSnapshot().state.time.seconds, 30 + rate * 0.25);
    const expected = motorTimeline.sample(instance.state.time);
    assert.deepEqual(localRuntime.getSnapshot().actuators, expected);
    assert.equal(!!localRuntime.getRenderSample().exposure, rate >= 0.5);
  }
  instance.setSpeed(1);
  instance.setLoop(false);
  instance.seek(WORLD_FLIGHT_DURATION - 0.05);
  instance.update(0.1, 0);
  assert.equal(instance.state.playing, false);
  near(localRuntime.getSnapshot().state.time.seconds, WORLD_FLIGHT_DURATION);
  assert.deepEqual(localRuntime.getSnapshot().actuators, parked);
  instance.setLoop(true);
  instance.seek(WORLD_FLIGHT_DURATION - 0.05);
  instance.state = { ...instance.state, playing: true };
  instance.update(0.1, 0);
  near(instance.state.time, 0.05);
  assert.deepEqual(localRuntime.getSnapshot().actuators, motorTimeline.sample(0));
  pass(
    'production pause/resume, all playback rates, final clamped update and loop seam preserve authoritative motors',
  );

  instance.seek(30);
  assert.ok(localRuntime.getSnapshot().actuators.L_Front.rpm > 0);
  instance.setMode('product');
  assert.ok(
    Object.values(localRuntime.getSnapshot().actuators).every(
      (motor) => motor.rpm === 0 && motor.fold === 1,
    ),
  );
  assert.equal(instance.mode, 'product');
  assert.equal(instance.state.playing, false);
  assert.equal(instance.state.tiltMode, true);
  assert.equal(instance.state.inspection, false);
  assert.equal(instance.camera.view, 'free');
  assert.equal(frameCalls, 1);
  nearVector(instance.worldState().position, new T.Vector3());
  instance.setMode('flight');
  assert.equal(instance.state.time, 0, 'a fresh scene entry starts a new mission');
  assert.equal(followCalls, 2);
  instance.setMode('product');
  pass('returning to product restores free observation and the shared ground datum');

  for (const lease of [
    { controlMode: 'local', clock: 'host' },
    { controlMode: 'external', clock: 'external' },
  ]) {
    instance.setControlLease(lease);
    const before = localRuntime.getSnapshot(),
      mode = instance.mode,
      view = instance.camera.view;
    instance.setMode(mode === 'product' ? 'flight' : 'product');
    assert.equal(localRuntime.getSnapshot(), before, 'mode buttons cannot mutate a unified lease');
    assert.equal(instance.mode, mode);
    assert.equal(instance.camera.view, view);
    instance.setControlLease(null);
  }
  localRuntime.connect();
  let ownedSnapshot = localRuntime.getSnapshot();
  instance.setMode('flight');
  assert.equal(
    localRuntime.getSnapshot(),
    ownedSnapshot,
    'mode buttons cannot seize Python ownership',
  );
  assert.equal(instance.mode, 'product');
  localRuntime.resetLocal();
  localRuntime.replay(JSON.stringify({ protocol: 'transwing.sim.v1', commands: [] }));
  ownedSnapshot = localRuntime.getSnapshot();
  instance.setMode('flight');
  assert.equal(
    localRuntime.getSnapshot(),
    ownedSnapshot,
    'mode buttons cannot seize JSON replay ownership',
  );
  assert.equal(instance.mode, 'product');
  localRuntime.dispose();
  pass('explicit mode changes respect local-host, external-clock, Python and JSON ownership locks');

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
