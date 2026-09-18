import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const temporary = ['.telemetry-simulation-test-tmp.mjs', '.session-simulation-test-tmp.mjs'];
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
const frame = (sequence, time, patch = {}) => ({
  version: 1,
  sequence,
  time,
  frame: 'SCENE',
  position: [sequence, 12, -4],
  quaternion: [0, 0, 0, 1],
  velocity: [4, 0, 0],
  rotorRpm: Array.from({ length: 11 }, (_, index) => (index < 8 ? 1200 : 1800)),
  surfaces: { aileron: 0.1, elevator: 0, rudder: -0.1 },
  ...patch,
});

fs.writeFileSync(temporary[0], compile(fs.readFileSync('src/simulation/telemetry.ts', 'utf8')));
fs.writeFileSync(
  temporary[1],
  compile(fs.readFileSync('src/simulation/session.ts', 'utf8')).replace(
    "'./telemetry'",
    "'./.telemetry-simulation-test-tmp.mjs'",
  ),
);
try {
  const {
    normalizeFrame,
    TelemetryBuffer,
    TelemetryReplay,
    MavlinkLiveDecoder,
    exportMavlinkJsonl,
    parseRecording,
  } = await import('./.telemetry-simulation-test-tmp.mjs');
  const { VisualSession } = await import('./.session-simulation-test-tmp.mjs');

  assert.deepEqual(normalizeFrame(frame(1, 0)).position, [1, 12, -4]);
  assert.throws(
    () => normalizeFrame(frame(1, 0, { rotorRpm: [1] })),
    /rotorRpm requires 11 values/,
  );
  const mavlink = exportMavlinkJsonl([frame(1, 0), frame(2, 0.2)]);
  assert.match(mavlink, /"LOCAL_POSITION_NED"/);
  assert.deepEqual(
    parseRecording(mavlink).map((item) => item.sequence),
    [1, 2],
  );
  const standardMavlink = [0, 200000]
    .flatMap((time_usec, index) => [
      {
        time_usec,
        type: 'LOCAL_POSITION_NED',
        x: index,
        y: 2,
        z: -12,
        vx: 4,
        vy: 0,
        vz: 0,
      },
      { time_usec, type: 'ATTITUDE_QUATERNION', q1: 1, q2: 0, q3: 0, q4: 0 },
      { time_usec, type: 'ACTUATOR_OUTPUT_STATUS', actuator: Array(11).fill(1200) },
    ])
    .map(JSON.stringify)
    .join('\n');
  assert.equal(parseRecording(standardMavlink).length, 2);
  const live = new MavlinkLiveDecoder();
  assert.equal(
    live.push({ time_usec: 500000, type: 'LOCAL_POSITION_NED', x: 3, y: 4, z: -12 }),
    null,
  );
  assert.equal(
    live.push({
      time_usec: 500000,
      type: 'ACTUATOR_OUTPUT_STATUS',
      actuator: Array(11).fill(1000),
    }),
    null,
  );
  assert.deepEqual(
    live.push({ time_usec: 500000, type: 'ATTITUDE_QUATERNION', q1: 1, q2: 0, q3: 0, q4: 0 })
      .position,
    [4, 12, -3],
  );
  assert.throws(
    () => normalizeFrame(frame(1, 0, { quaternion: [0, 0, 0, 0] })),
    /Quaternion must be nonzero/,
  );

  const buffer = new TelemetryBuffer();
  buffer.push(frame(1, 0), 10);
  buffer.push(frame(2, 0.2), 10.2);
  assert.equal(buffer.sample(10.15).sequence, 1);
  assert.throws(() => buffer.push(frame(2, 0.3), 10.3), /Out-of-order frame/);
  assert.equal(buffer.status(11.1).stale, true);

  const recording = { version: 1, frames: [frame(1, 10), frame(2, 10.5)] };
  const replay = new TelemetryReplay();
  replay.load(recording);
  assert.equal(replay.duration, 0.5);
  assert.equal(replay.tick(0.25).position[0], 1.5);
  assert.throws(() => replay.load({ version: 1, frames: [frame(2, 1), frame(1, 2)] }), /monotonic/);
  const ulogReplay = parseRecording(fs.readFileSync('public/flight-replay.json', 'utf8'));
  assert.ok(ulogReplay.length > 2, 'The packaged ULog replay must contain visual frames');
  assert.ok(ulogReplay.at(-1).time > ulogReplay[0].time, 'The packaged ULog replay needs duration');

  const sources = [],
    session = new VisualSession((source) => sources.push(source));
  assert.equal(session.request('simulation.frame', frame(1, 0)).source, 'external');
  session.request('simulation.record.start');
  session.ingest(frame(2, 0.2), 20.2);
  const exported = session.request('simulation.record.export');
  assert.equal(exported.frames.length, 1);
  assert.equal(
    session.request('simulation.replay.load', { version: 1, frames: [frame(1, 0), frame(2, 0.2)] })
      .source,
    'replay',
  );
  assert.deepEqual(sources, ['external', 'replay']);
  const localRecording = new VisualSession(() => {});
  localRecording.request('simulation.record.start');
  localRecording.capture(frame(1, 0), 10);
  localRecording.capture(frame(2, 0.2), 10.2);
  assert.equal(localRecording.state().recording.count, 2);
  assert.match(
    localRecording.request('simulation.record.export', { format: 'mavlink-jsonl' }),
    /HEARTBEAT/,
  );
  console.log('PASS simulation protocol');
} finally {
  temporary.forEach((file) => fs.rmSync(file, { force: true }));
}
