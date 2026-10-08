// Pure HUD contract checks: real runtime defaults, no DOM or rendering doubles.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export async function testHangarSnapshot({ load, passed }) {
  const { buildTranswingSnapshot } = await load('aircraft/transwing/snapshot.ts');
  const { SimulationRuntime } = await load('aircraft/transwing/core/simulation.ts');
  const { INITIAL_EXPERIENCE, experienceReducer } = await load(
    'aircraft/transwing/core/experience.ts',
  );
  const { playbackPresentation } = await load('aircraft/playbackPresentation.ts');
  const { WORLD_FLIGHT_DURATION: TOTAL, worldFlightPhase } = await load(
    'aircraft/transwing/worldFlight.ts',
  );
  const runtime = new SimulationRuntime();
  runtime.setReady(true);
  const base = structuredClone(runtime.getSnapshot());
  runtime.dispose();
  const experience = {
    ...structuredClone(INITIAL_EXPERIENCE),
    time: 26.5,
    playing: true,
    tiltMode: true,
    tilt: { ...INITIAL_EXPERIENCE.tilt, progress: 0.9, playing: false, rate: 1.5, repeat: true },
  };
  const pose = {
    ...structuredClone(base.state),
    wingTilt: 0.375,
    positionM: [10, 7.25, -20],
    time: { ...base.state.time, seconds: 987.5, paused: false },
  };
  const inputs = freeze({ base, experience, pose });

  const product = buildTranswingSnapshot(inputs.base, inputs.pose, inputs.experience, 'product');
  assert.equal(product.ready, true);
  assert.equal(product.mode, 'product');
  assert.equal(product.control, 'local');
  assert.equal(product.externallyControlled, false);
  assert.equal(product.timeUnit, 'percent');
  assert.equal(
    product.time,
    37.5,
    'mechanism timeline uses rendered wing progress, not simulation or flight time',
  );
  assert.equal(product.duration, 100);
  assert.equal(product.playbackRate, 1.5);
  assert.equal(product.loop, true);
  assert.equal(product.lift, '38%');
  assert.equal(product.cruise, '0/4');
  assert.equal(product.playing, false, 'mechanism play state uses the tilt controller');
  assert.equal(product.state, 'mechanism');
  assert.equal(product.speedMps, 0);
  assert.equal(product.altitude, 7.25);
  assert.equal(product.timelineLabel, '整翼机构进度');
  passed('Transwing local mechanism snapshot uses rendered tilt progress and local playback state');

  const flight = buildTranswingSnapshot(inputs.base, inputs.pose, inputs.experience, 'flight', {
    rate: 4,
    loop: false,
  });
  const sample = worldFlightPhase(inputs.experience.time);
  assert.equal(flight.playbackRate, 4);
  assert.equal(flight.loop, false);
  const defaultFlight = buildTranswingSnapshot(
    inputs.base,
    inputs.pose,
    inputs.experience,
    'flight',
  );
  assert.equal(defaultFlight.playbackRate, 1);
  assert.equal(defaultFlight.loop, true);
  assert.equal(flight.control, 'local');
  assert.equal(flight.externallyControlled, false);
  assert.equal(flight.timeUnit, 'seconds');
  assert.equal(flight.time, 26.5);
  assert.equal(flight.duration, TOTAL);
  assert.equal(flight.playing, true);
  assert.equal(flight.state, sample.state);
  assert.equal(flight.label, sample.label);
  assert.equal(flight.speedMps, 0);
  assert.equal(flight.altitude, inputs.pose.positionM[1]);
  assert.equal(flight.timelineLabel, 'Transwing 飞行演示');
  passed(
    'Transwing local flight snapshot uses flight time and phase rather than replay or mechanism units',
  );

  const replayRuntime = freeze({
    ...structuredClone(base),
    control: 'replay',
    replayIndex: 7,
    replayCount: 12,
    replayPlaying: true,
    replayRate: 0.1,
  });
  const replayPose = freeze({ ...structuredClone(pose), time: { ...pose.time, paused: true } });
  const replay = buildTranswingSnapshot(replayRuntime, replayPose, inputs.experience, 'product');
  assert.equal(replay.playbackRate, 0.1);
  assert.equal(replay.loop, false);
  assert.equal(replay.control, 'replay');
  assert.equal(
    replay.externallyControlled,
    false,
    'offline replay must leave seek/restart/play available',
  );
  assert.equal(replay.timeUnit, 'frames');
  assert.equal(replay.time, 7);
  assert.equal(replay.duration, 11, 'timeline bounds are zero-based indexes for twelve frames');
  assert.equal(replay.playing, true, 'replayPlaying overrides recorded time.paused');
  assert.equal(replay.state, 'replay');
  assert.equal(replay.speedMps, 0);
  assert.equal(replay.timelineLabel, 'JSON 回放帧');
  const pausedReplay = buildTranswingSnapshot(
    freeze({ ...replayRuntime, replayPlaying: false }),
    inputs.pose,
    inputs.experience,
    'flight',
  );
  assert.equal(
    pausedReplay.playing,
    false,
    'paused replay remains paused even if recorded/local flight states play',
  );
  assert.equal(pausedReplay.time, 7);
  assert.equal(pausedReplay.duration, 11);
  assert.equal(pausedReplay.timeUnit, 'frames');
  const emptyReplay = buildTranswingSnapshot(
    freeze({ ...replayRuntime, replayCount: 0, replayIndex: 0 }),
    replayPose,
    inputs.experience,
    'product',
  );
  assert.equal(emptyReplay.duration, 0);
  passed(
    'Transwing replay snapshot exposes frame indexes and replay play state without Python control lock',
  );

  const externalRuntime = freeze({ ...structuredClone(base), control: 'external', ready: false });
  const external = buildTranswingSnapshot(
    externalRuntime,
    inputs.pose,
    inputs.experience,
    'product',
  );
  assert.equal(external.playbackRate, undefined);
  assert.equal(external.loop, false);
  assert.equal(external.ready, false);
  assert.equal(external.control, 'external');
  assert.equal(external.externallyControlled, true);
  assert.equal(external.timeUnit, 'seconds');
  assert.equal(external.time, 987.5);
  assert.equal(external.playing, true);
  assert.equal(external.state, 'external');
  assert.equal(external.speedMps, 0);
  assert.equal(external.timelineLabel, 'Python 仿真时间');
  assert.equal(external.duration, 0, 'live external time has no finite seek span');
  const pausedExternal = buildTranswingSnapshot(
    externalRuntime,
    replayPose,
    inputs.experience,
    'flight',
  );
  assert.equal(pausedExternal.playing, false);
  assert.equal(pausedExternal.time, 987.5);
  assert.equal(pausedExternal.externallyControlled, true);
  passed('Transwing Python snapshot uses external seconds/paused state and explicit control lock');

  const unlocked = {
    disableMode: false,
    disablePlay: false,
    disableSeek: false,
    disableRestart: false,
    disableSpeed: false,
    disableLoop: false,
  };
  const productHud = playbackPresentation(freeze(product));
  assert.deepEqual(productHud, {
    ...unlocked,
    timeLabel: '37.5% 展开',
    timelineLabel: '整翼机构进度',
    step: '0.1',
    rateOptions: [0.25, 0.5, 1, 1.5, 2],
    rate: 1.5,
    loop: true,
  });
  const flightHud = playbackPresentation(freeze(flight));
  assert.deepEqual(flightHud, {
    ...unlocked,
    timeLabel: `26.5 / ${TOTAL.toFixed(1)} s`,
    timelineLabel: 'Transwing 飞行演示',
    step: '0.01',
    rateOptions: [0.25, 0.5, 1, 1.5, 2, 4],
    rate: 4,
    loop: false,
  });
  const replayHud = playbackPresentation(freeze(replay));
  assert.deepEqual(replayHud, {
    ...unlocked,
    disableMode: true,
    disableLoop: true,
    timeLabel: '8 / 12 帧',
    timelineLabel: 'JSON 回放帧',
    step: '1',
    rateOptions: [0.1, 1],
    rate: 0.1,
    loop: false,
  });
  const externalHud = playbackPresentation(freeze(external));
  assert.equal(externalHud.timeLabel, '987.50 s · Python 时钟');
  assert.equal(externalHud.timelineLabel, 'Python 仿真时间');
  assert.equal(externalHud.step, '0.01');
  assert.equal(externalHud.loop, false);
  for (const key of Object.keys(unlocked)) assert.equal(externalHud[key], true, key);
  // Recompute both local modes after replay/external and assert every lock/rate option restores.
  assert.deepEqual(playbackPresentation(product), productHud);
  assert.deepEqual(playbackPresentation(flight), flightHud);
  passed(
    'shared playback HUD distinguishes percent/seconds/frames and restores local controls after replay or Python',
  );

  // Exercise the production adapter's actual transport methods without instantiating WebGL/DOM.
  // TypeScript AST extraction is restricted to these three methods; their bodies are unchanged.
  const source = fs.readFileSync('src/aircraft/transwing/index.ts', 'utf8');
  const parsed = ts.createSourceFile('index.ts', source, ts.ScriptTarget.ES2022, true);
  const adapter = parsed.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === 'TranswingInstance',
  );
  assert.ok(adapter, 'Transwing adapter class must exist');
  const methods = ['seek', 'setSpeed', 'setLoop'].map((name) => {
    const method = adapter.members.find(
      (node) => ts.isMethodDeclaration(node) && node.name.getText(parsed) === name,
    );
    assert.ok(method, `Missing production adapter method: ${name}`);
    return method.getText(parsed);
  });
  const javascript = ts.transpileModule(`class TransportUnderTest { ${methods.join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const Transport = new Function(
    'experienceReducer',
    'WORLD_FLIGHT_DURATION',
    `${javascript}; return TransportUnderTest;`,
  )(experienceReducer, TOTAL);
  const transport = new Transport();
  let transportState = { control: 'local', replayCount: 12 };
  const actions = [],
    replaySeeks = [],
    replayRates = [];
  Object.assign(transport, {
    mode: 'product',
    unified: { lease: null },
    state: structuredClone(INITIAL_EXPERIENCE),
    rate: 1,
    loop: false,
    dispatch: (action) => actions.push(action),
    runtime: {
      getSnapshot: () => transportState,
      replayAt: (index) => replaySeeks.push(index),
      setReplayRate: (rate) => replayRates.push(rate),
    },
  });
  transport.seek(product.time);
  assert.deepEqual(actions.pop(), {
    type: 'tilt',
    action: { type: 'scrub', progress: pose.wingTilt },
  });
  for (const [input, expected] of [
    [-1, 0],
    [0, 0],
    [50, 0.5],
    [100, 1],
    [101, 1],
  ]) {
    transport.seek(input);
    assert.equal(actions.pop().action.progress, expected);
  }
  transport.mode = 'flight';
  transport.seek(26.5);
  assert.deepEqual(actions.pop(), { type: 'set', key: 'time', value: 26.5 });
  transport.seek(TOTAL + 100);
  assert.equal(actions.pop().value, TOTAL);
  transportState = { control: 'replay', replayCount: 12 };
  transport.seek(7.4);
  transport.seek(99);
  transport.seek(-2);
  assert.deepEqual(replaySeeks, [7, 11, 0]);
  for (const rate of [0.1, 1, 0.25, 2, 0, NaN]) transport.setSpeed(rate);
  assert.deepEqual(replayRates, [0.1, 1]);
  transport.setLoop(true);
  assert.equal(transport.loop, false);
  transportState = { control: 'external' };
  transport.seek(50);
  transport.setSpeed(2);
  transport.setLoop(true);
  assert.equal(actions.length, 0);
  assert.deepEqual(replaySeeks, [7, 11, 0]);
  assert.deepEqual(replayRates, [0.1, 1]);
  assert.equal(transport.rate, 1);
  assert.equal(transport.loop, false);
  transportState = { control: 'local' };
  transport.setSpeed(1.5);
  transport.setLoop(true);
  assert.equal(transport.rate, 1.5);
  assert.equal(transport.state.tilt.rate, 1.5);
  assert.equal(transport.loop, true);
  assert.equal(transport.state.tilt.repeat, true);
  transport.seek(NaN);
  transport.seek(Infinity);
  assert.equal(actions.length, 0);
  passed(
    'production Transwing transport methods round-trip percentage seeks and respect replay/Python ownership',
  );
}
