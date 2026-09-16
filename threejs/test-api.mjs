import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const temporary = ['.contracts-api-test-tmp.mjs', '.gateway-api-test-tmp.mjs'];
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
fs.writeFileSync(temporary[0], compile(fs.readFileSync('src/api/contracts.ts', 'utf8')));
fs.writeFileSync(
  temporary[1],
  compile(fs.readFileSync('src/api/gateway.ts', 'utf8')).replace(
    "'./contracts'",
    "'./.contracts-api-test-tmp.mjs'",
  ),
);
try {
  const { Ev50ApiGateway } = await import('./.gateway-api-test-tmp.mjs');
  const calls = [];
  const runtime = {
    ready: false,
    getState: () => ({ route: 'valley', time: 0 }),
    getRoutes: () => [{ id: 'valley', name: '山谷穿越' }],
    command: (c) => {
      calls.push(['command', c]);
      return { route: 'valley', time: 1 };
    },
    play: () => calls.push(['play']),
    pause: () => calls.push(['pause']),
    resume: () => calls.push(['resume']),
    reset: () => calls.push(['reset']),
    seek: (s) => calls.push(['seek', s]),
    setSpeed: (s) => calls.push(['speed', s]),
    setRoute: (r) => calls.push(['route', r]),
    getSettings: () => ({
      loop: true,
      playbackSpeed: 1,
      camera: 'free',
      quality: 'High',
      annotations: false,
    }),
    updateSettings: (s) => ({ ...runtime.getSettings(), ...s }),
  };
  const api = new Ev50ApiGateway(runtime);
  assert.deepEqual(api.request({ id: 'health', operation: 'system.health' }), {
    id: 'health',
    operation: 'system.health',
    ok: true,
    data: { ready: false, version: '3.1.0' },
  });
  assert.equal(api.request({ operation: 'flight.state' }).error.code, 'NOT_READY');
  runtime.ready = true;
  assert.deepEqual(api.request({ operation: 'mission.list' }).data, [
    { id: 'valley', name: '山谷穿越' },
  ]);
  assert.deepEqual(
    api.request({ operation: 'flight.command', payload: { type: 'motor', lift: 0.6, cruise: 0.2 } })
      .data,
    { route: 'valley', time: 1 },
  );
  assert.deepEqual(calls.at(-1), ['command', { type: 'motor', lift: 0.6, cruise: 0.2 }]);
  assert.deepEqual(api.request({ operation: 'flight.seek', payload: { seconds: 12 } }).data, {
    route: 'valley',
    time: 0,
  });
  assert.deepEqual(calls.at(-1), ['seek', 12]);
  assert.equal(
    api.request({ operation: 'flight.seek', payload: { seconds: 'bad' } }).error.code,
    'VALIDATION_FAILED',
  );
  assert.equal(api.request({ operation: 'camera.move' }).error.code, 'OPERATION_UNSUPPORTED');
  assert.equal(
    api.request({ operation: 'system.capabilities' }).data.reservedNamespaces.includes('telemetry'),
    true,
  );
  console.log('PASS api gateway');
} finally {
  temporary.forEach((file) => fs.rmSync(file, { force: true }));
}
