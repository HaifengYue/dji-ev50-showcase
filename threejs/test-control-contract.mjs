// Pure gateway/adapter lifecycle checks. Actual render ACK placement is covered by browser QA.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hangar-control-'));
for (const name of ['contracts', 'config', 'validation', 'gateway']) {
  const source = fs.readFileSync(new URL(`./src/control/${name}.ts`, import.meta.url), 'utf8');
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    })
    .outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'");
  fs.writeFileSync(path.join(temporary, name + '.mjs'), compiled);
}
fs.writeFileSync(
  path.join(temporary, 'ev50Control.mjs'),
  ts.transpileModule(
    fs.readFileSync(new URL('./src/aircraft/ev50Control.ts', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } },
  ).outputText,
);
const { Ev50ExternalControl } = await import(
  pathToFileURL(path.join(temporary, 'ev50Control.mjs'))
);
const { UnifiedControlGateway } = await import(pathToFileURL(path.join(temporary, 'gateway.mjs')));
const { validateControlConfig, defaultControlConfig } = await import(
  pathToFileURL(path.join(temporary, 'config.mjs'))
);
const flush = () => new Promise((resolve) => setImmediate(resolve));
const tests = [];
const fixtures = [];
const test = (name, run) => tests.push({ name, run });

function harness(options = {}) {
  let time = 10000,
    nextTimer = 1,
    frame = 0;
  const timers = new Map(),
    calls = [],
    events = [];
  const context = { aircraft: 'ev50', generation: 1, ready: true };
  const capabilities = {
    aircraft: 'ev50',
    rotorCount: 11,
    body: { forward: '+X', up: '+Y', origin: 'test rig origin' },
    operations: [
      'aircraft.pose',
      'clock.step',
      'transport.play',
      'transport.pause',
      'transport.reset',
      'transport.seek',
      'transport.speed',
      'transport.loop',
      'ev50.motors',
    ],
  };
  const state = {
    pose: { positionM: [0, 0, 0], attitude: [0, 0, 0, 1], velocityMps: [0, 0, 0] },
    clock: { authority: 'host', seconds: 0 },
    controlMode: 'local',
    transport: {
      playing: false,
      position: 0,
      duration: 100,
      unit: 'seconds',
      speed: 1,
      loop: false,
    },
    model: { aircraft: 'ev50', rotorCount: 11 },
  };
  const host = {
    getContext: () => context,
    getCapabilities: () => capabilities,
    getState: () => state,
    apply(command) {
      calls.push(structuredClone(command));
      const p = command.payload;
      if (command.operation === 'aircraft.pose') {
        for (const key of ['positionM', 'attitude', 'velocityMps'])
          if (p[key]) state.pose[key] = [...p[key]];
        if (p.timeSeconds !== undefined) state.clock.seconds = p.timeSeconds;
      } else if (command.operation === 'clock.step') state.clock.seconds += p.dt;
      else if (command.operation === 'transport.play') state.transport.playing = true;
      else if (command.operation === 'transport.pause') state.transport.playing = false;
      else if (command.operation === 'transport.seek') state.transport.position = p.position;
    },
    leaseChanged(lease, reason) {
      events.push({ lease, reason });
      state.controlMode = lease?.controlMode ?? 'local';
      state.clock.authority = lease?.clock ?? 'host';
    },
  };
  const gateway = new UnifiedControlGateway(host, {
    origin: 'http://127.0.0.1:8787',
    now: () => time,
    setTimer: (callback, milliseconds) => {
      const id = nextTimer++;
      timers.set(id, { at: time + milliseconds, callback });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    ...options,
  });
  let commandSerial = 0,
    leaseId;
  const envelope = (operation, payload = {}, fields = {}) => ({
    id: `id-${++commandSerial}`,
    operation,
    aircraft: context.aircraft,
    generation: context.generation,
    owner: 'test-client',
    ...(leaseId ? { leaseId } : {}),
    payload,
    ...fields,
  });
  const send = (operation, payload, fields) =>
    gateway.request(envelope(operation, payload, fields));
  async function acquire(external = false, ttlMs = 30000) {
    const result = await send('control.acquire', {
      controlMode: external ? 'external' : 'local',
      clock: external ? 'external' : 'host',
      ttlMs,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    leaseId = result.data.leaseId;
    return result;
  }
  function render() {
    gateway.beforeFrame();
    gateway.afterRender(++frame);
  }
  function advance(ms) {
    time += ms;
    for (const [id, timer] of [...timers])
      if (timer.at <= time) {
        timers.delete(id);
        timer.callback();
      }
  }
  const h = {
    gateway,
    state,
    context,
    capabilities,
    host,
    calls,
    events,
    timers,
    envelope,
    send,
    acquire,
    render,
    advance,
  };
  fixtures.push(h);
  return h;
}
async function error(promise, code) {
  const result = await promise;
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, code);
  return result;
}
async function applied(h, operation, payload) {
  const pending = h.send(operation, payload);
  h.render();
  const result = await pending;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.ack.status, 'applied');
  return result;
}

test('read state and capabilities are immutable detached snapshots', async () => {
  const h = harness();
  const state = await h.gateway.request({ operation: 'aircraft.state' });
  assert.equal(state.data.coordinates.up, '+Y');
  assert.equal(state.data.state.model.rotorCount, 11);
  assert.throws(() => {
    state.data.state.pose.positionM[0] = 9;
  }, TypeError);
  h.state.pose.positionM[0] = 7;
  assert.equal(state.data.state.pose.positionM[0], 0);
  const caps = await h.gateway.request({ operation: 'system.capabilities' });
  assert.deepEqual(caps.data.implementedTransports, ['browser', 'local-http']);
  assert.equal(caps.data.deduplication.eviction, false);
});
test('mutations require identity, current aircraft/generation, ready host and lease', async () => {
  const h = harness();
  await error(h.gateway.request({ operation: 'transport.play' }), 'INVALID_REQUEST');
  await error(h.send('transport.play'), 'LEASE_REQUIRED');
  await error(h.send('control.acquire', {}, { aircraft: 'transwing' }), 'AIRCRAFT_MISMATCH');
  await error(h.send('control.acquire', {}, { generation: 0 }), 'STALE_SELECTION');
  h.context.ready = false;
  await error(h.send('control.acquire'), 'NOT_READY');
  h.context.ready = true;
  h.context.blockedReason = 'Python owns model';
  await error(h.send('control.acquire'), 'CONTROL_BUSY');
  assert.equal(h.calls.length, 0);
});
test('owner and lease token independently guard writes', async () => {
  const h = harness();
  await h.acquire();
  await error(h.send('transport.play', {}, { owner: 'other' }), 'OWNER_MISMATCH');
  await error(h.send('transport.play', {}, { leaseId: 'wrong' }), 'LEASE_MISMATCH');
  await error(h.send('control.acquire'), 'CONTROL_BUSY');
  assert.equal(h.calls.length, 0);
});
test('ACK is unresolved before apply and before successful post-apply render', async () => {
  const h = harness();
  await h.acquire(true);
  let done = false;
  const pending = h.send('aircraft.pose', { positionM: [1, 2, 3], timeSeconds: 2 }).then((v) => {
    done = true;
    return v;
  });
  await flush();
  assert.equal(done, false);
  assert.equal(h.calls.length, 0);
  h.gateway.beforeFrame();
  await flush();
  assert.equal(done, false);
  assert.equal(h.calls.length, 1);
  h.gateway.afterRender(1);
  const result = await pending;
  assert.equal(result.ack.status, 'applied');
  assert.equal(result.ack.frame, 1);
  assert.deepEqual(result.data.state.pose.positionM, [1, 2, 3]);
});
test('one queued mutation per actual frame, repeated frame number cannot ACK', async () => {
  const h = harness();
  await h.acquire();
  const a = h.send('transport.play'),
    b = h.send('transport.pause');
  h.gateway.beforeFrame();
  h.gateway.beforeFrame();
  assert.equal(h.calls.length, 1);
  h.gateway.afterRender(3);
  assert.equal((await a).ok, true);
  let done = false;
  b.then(() => {
    done = true;
  });
  h.gateway.beforeFrame();
  h.gateway.afterRender(3);
  await flush();
  assert.equal(done, false);
  h.gateway.afterRender(4);
  assert.equal((await b).ack.frame, 4);
});
test('duplicate pending id shares one execution and immutable original outcome', async () => {
  const h = harness();
  await h.acquire(true);
  const request = h.envelope('aircraft.pose', { positionM: [4, 5, 6] });
  const a = h.gateway.request(request),
    b = h.gateway.request({ ...request, payload: { positionM: [4, 5, 6] } });
  assert.equal(a, b);
  h.render();
  const original = await a;
  h.state.pose.positionM[0] = 90;
  h.context.generation++;
  assert.equal(await h.gateway.request(request), original);
  assert.equal(original.data.state.pose.positionM[0], 4);
  assert.equal(h.calls.length, 1);
  await error(h.gateway.request({ ...request, payload: { positionM: [7, 8, 9] } }), 'ID_CONFLICT');
});
test('rejected command ids preserve their first failure after conditions change', async () => {
  const h = harness();
  const request = h.envelope('transport.play');
  const first = await error(h.gateway.request(request), 'LEASE_REQUIRED');
  await h.acquire();
  assert.equal(await h.gateway.request(request), first);
  assert.equal(h.calls.length, 0);
});
test('request data is copied before enqueue and source edits cannot change commands', async () => {
  const h = harness();
  await h.acquire(true);
  const request = h.envelope('aircraft.pose', { positionM: [1, 0, 0] });
  const p = h.gateway.request(request);
  request.payload.positionM[0] = 999;
  h.render();
  assert.equal((await p).data.state.pose.positionM[0], 1);
});
test('selection invalidation cancels queued and applied-unrendered work', async () => {
  const h = harness();
  await h.acquire(true);
  const applied = h.send('aircraft.pose', { timeSeconds: 1 }),
    queued = h.send('clock.step', { dt: 1 });
  h.gateway.beforeFrame();
  h.gateway.invalidateSelection();
  await error(applied, 'STALE_SELECTION');
  await error(queued, 'STALE_SELECTION');
  assert.equal(h.gateway.getLease(), null);
  assert.equal(h.events.at(-1).lease, null);
  h.gateway.afterRender(1);
  assert.equal(h.calls.length, 1);
});
test('selection generation change is also detected without explicit invalidation', async () => {
  const h = harness();
  await h.acquire();
  const pending = h.send('transport.play');
  h.context.generation++;
  h.gateway.beforeFrame();
  await error(pending, 'STALE_SELECTION');
  assert.equal(h.calls.length, 0);
});
test('release and disconnect cancel pending commands and release host ownership', async () => {
  const h = harness();
  await h.acquire();
  const p = h.send('transport.play');
  const release = await h.send('control.release');
  assert.equal(release.ok, true);
  await error(p, 'LEASE_REQUIRED');
  await h.acquire();
  const q = h.send('transport.play');
  h.gateway.disconnect();
  await error(q, 'DISCONNECTED');
  assert.equal(h.gateway.getLease(), null);
  assert.equal(h.timers.size, 0);
});
test('expiry timer cancels commands without a render or further API request', async () => {
  const h = harness();
  await h.acquire(true, 1000);
  const p = h.send('aircraft.pose', { positionM: [1, 2, 3] });
  h.gateway.beforeFrame();
  h.advance(999);
  assert.notEqual(h.gateway.getLease(), null);
  h.advance(1);
  await error(p, 'LEASE_EXPIRED');
  assert.equal(h.gateway.getLease(), null);
  await error(h.send('clock.step', { dt: 0.1 }), 'LEASE_EXPIRED');
});
test('renewal extends the original lease without reacquiring the adapter', async () => {
  const h = harness();
  const first = await h.acquire(false, 1000);
  h.advance(900);
  const renewed = await h.send('control.renew', { ttlMs: 2000 });
  assert.equal(renewed.data.leaseId, first.data.leaseId);
  assert.equal(h.events.length, 1);
  h.advance(100);
  assert.notEqual(h.gateway.getLease(), null);
  h.advance(1899);
  assert.notEqual(h.gateway.getLease(), null);
  h.advance(1);
  assert.equal(h.gateway.getLease(), null);
});
test('real timer expires ownership while no animation frames run', async () => {
  const h = harness({ now: Date.now, setTimer: setTimeout, clearTimer: clearTimeout });
  await h.acquire(false, 1000);
  let result;
  const pending = h.send('transport.play').then((r) => {
    result = r;
  });
  await new Promise((resolve) => setTimeout(resolve, 1050));
  await pending;
  assert.equal(result.error.code, 'LEASE_EXPIRED');
  assert.equal(h.gateway.getLease(), null);
});
test('local/external mode and clock matrix is explicit', async () => {
  const h = harness();
  await h.acquire();
  await error(h.send('aircraft.pose', { timeSeconds: 0 }), 'MODE_MISMATCH');
  await error(h.send('clock.step', { dt: 1 }), 'MODE_MISMATCH');
  await applied(h, 'transport.play');
  await h.send('control.release');
  await h.acquire(true);
  for (const [op, payload] of [
    ['transport.reset', {}],
    ['transport.seek', { position: 0, unit: 'seconds' }],
    ['transport.speed', { speed: 1 }],
    ['transport.loop', { loop: false }],
  ])
    await error(h.send(op, payload), 'MODE_MISMATCH');
  await applied(h, 'transport.pause');
  await applied(h, 'aircraft.pose', { timeSeconds: 8 });
  await applied(h, 'transport.play');
  await applied(h, 'clock.step', { dt: 2 });
  await error(h.send('aircraft.pose', { timeSeconds: 9 }), 'CLOCK_REGRESSION');
});
test('external pause blocks step, while queued play then step applies in frame order', async () => {
  const h = harness();
  await h.acquire(true);
  const rejected = h.send('clock.step', { dt: 1 });
  h.render();
  await error(rejected, 'VALIDATION_FAILED');
  assert.equal(h.calls.length, 0);
  assert.equal(h.state.clock.seconds, 0);
  const play = h.send('transport.play'),
    step = h.send('clock.step', { dt: 1 });
  h.render();
  assert.equal((await play).ok, true);
  h.render();
  assert.equal((await step).ok, true);
  assert.equal(h.state.clock.seconds, 1);
});
test('queued external timestamps are revalidated against prior application', async () => {
  const h = harness();
  await h.acquire(true);
  const later = h.send('aircraft.pose', { timeSeconds: 20 }),
    older = h.send('aircraft.pose', { timeSeconds: 10 });
  h.render();
  assert.equal((await later).ok, true);
  h.render();
  await error(older, 'CLOCK_REGRESSION');
  assert.equal(h.calls.length, 1);
});
test('seek explicit unit matches the current timeline at application', async () => {
  const h = harness();
  await h.acquire();
  const p = h.send('transport.seek', { position: 2, unit: 'frames' });
  h.render();
  await error(p, 'VALIDATION_FAILED');
  assert.equal(h.calls.length, 0);
  await error(h.send('transport.seek', { position: 1.5, unit: 'frames' }), 'VALIDATION_FAILED');
});
test('model namespaces cannot cross aircraft and unsupported capabilities do not dispatch', async () => {
  const h = harness();
  await h.acquire();
  await error(
    h.send('transwing.motors', { motors: { L_Front: { targetRpm: 100 } } }),
    'AIRCRAFT_MISMATCH',
  );
  h.capabilities.operations = h.capabilities.operations.filter((op) => op !== 'ev50.motors');
  await error(h.send('ev50.motors', { lift: 0.5, cruise: 0 }), 'OPERATION_UNSUPPORTED');
  assert.equal(h.calls.length, 0);
});
test('numeric, quaternion, unknown-field, unit and clock inputs reject atomically', async () => {
  const h = harness();
  await h.acquire(true);
  for (const [op, payload] of [
    ['aircraft.pose', { attitude: [0, 0, 0, 0] }],
    ['aircraft.pose', { positionM: [1, 2] }],
    ['aircraft.pose', { yaw: 2 }],
    ['clock.step', { dt: 61 }],
  ])
    await error(h.send(op, payload), 'VALIDATION_FAILED');
  await error(h.send('aircraft.pose', { timeSeconds: Infinity }), 'INVALID_REQUEST');
  assert.equal(h.calls.length, 0);
});
test('Transwing motor/surface/geometry schemas are strict and rotor arrays cannot leak in', async () => {
  const h = harness();
  h.context.aircraft = h.capabilities.aircraft = h.state.model.aircraft = 'transwing';
  h.capabilities.rotorCount = h.state.model.rotorCount = 4;
  h.capabilities.operations = ['transwing.mechanism', 'transwing.motors', 'transwing.surfaces'];
  await h.acquire(true);
  for (const payload of [
    { motors: new Array(11).fill(0) },
    { motors: { WRONG: { targetRpm: 1 } } },
    { motors: { L_Front: { targetRpm: 12001 } } },
  ])
    await error(h.send('transwing.motors', payload), 'VALIDATION_FAILED');
  await error(h.send('transwing.mechanism', { surfaces: { elevator: 5 } }), 'VALIDATION_FAILED');
  await error(h.send('transwing.mechanism', { hatchDeg: 56 }), 'VALIDATION_FAILED');
  await applied(h, 'transwing.mechanism', { wingTilt: 0.5, surfaces: { Tail_L: 4 }, hatchDeg: 55 });
  await applied(h, 'transwing.motors', { motors: { L_Front: { targetRpm: 100, enabled: true } } });
});
test('config changes atomically validate same-origin loopback, explicit enable, fixed units and clock', async () => {
  const h = harness();
  const valid = await h.send('config.update', {
    transport: 'local-http',
    baseURL: 'http://127.0.0.1:8787',
    localService: { enabled: true },
  });
  assert.equal(valid.ok, true);
  assert.equal(h.gateway.getConfig().transport, 'local-http');
  for (const patch of [
    { baseURL: 'https://example.com' },
    { baseURL: 'http://localhost:8787' },
    { baseURL: 'http://127.0.0.1:8788' },
    { baseURL: 'http://secret@127.0.0.1:8787' },
    { baseURL: 'http://127.0.0.1:8787?token=abc' },
    { localService: { enabled: false } },
    { controlMode: 'external' },
    { clock: 'external' },
    { transport: 'websocket' },
    { units: { position: 'feet' } },
    { leaseTtlMs: 999 },
    { unknown: true },
  ])
    await error(h.send('config.update', patch), 'VALIDATION_FAILED');
  assert.deepEqual(h.gateway.getConfig(), valid.data);
  await h.acquire();
  await error(h.send('config.update', { leaseTtlMs: 5000 }), 'CONTROL_BUSY');
});
test('hosted origins cannot enable loopback or remote service and no implicit network requests occur', () => {
  const config = defaultControlConfig();
  for (const baseURL of ['http://127.0.0.1', 'https://example.com'])
    assert.throws(() =>
      validateControlConfig(
        config,
        { baseURL, localService: { enabled: true }, transport: 'local-http' },
        'https://example.com',
      ),
    );
  assert.throws(() =>
    validateControlConfig(config, { transport: 'local-http' }, 'http://127.0.0.1'),
  );
  assert.equal(config.baseURL, null);
  assert.equal(config.localService.enabled, false);
});
test('adapter acquisition failure keeps config and lease unchanged', async () => {
  const h = harness();
  const original = h.gateway.getConfig();
  h.host.leaseChanged = () => {
    throw new Error('Replay owns this aircraft');
  };
  await error(
    h.send('control.acquire', { controlMode: 'external', clock: 'external' }),
    'VALIDATION_FAILED',
  );
  assert.equal(h.gateway.getLease(), null);
  assert.deepEqual(h.gateway.getConfig(), original);
});
test('adapter command failure never produces an applied ACK', async () => {
  const h = harness();
  await h.acquire();
  h.host.apply = () => {
    throw new Error('Rejected by rig interlock');
  };
  const p = h.send('transport.play');
  h.render();
  await error(p, 'HOST_ERROR');
});
test('adapter release failure is observable and does not leave a queued command or timer', async () => {
  const h = harness();
  await h.acquire();
  const p = h.send('transport.play');
  h.host.leaseChanged = () => {
    throw new Error('Host release failed');
  };
  await error(h.send('control.release'), 'HOST_ERROR');
  await error(p, 'LEASE_REQUIRED');
  assert.equal(h.gateway.getLease(), null);
  assert.equal(h.timers.size, 0);
  const state = await h.gateway.request({ operation: 'control.state' });
  assert.equal(state.data.lifecycleError, 'Host release failed');
});
test('sparse JSON arrays reject rather than applying undefined pose coordinates', async () => {
  const h = harness();
  await h.acquire(true);
  await error(h.send('aircraft.pose', { positionM: Array(3) }), 'INVALID_REQUEST');
  assert.equal(h.calls.length, 0);
});
test('synchronous host selection invalidation resolves the command without another frame', async () => {
  const h = harness();
  await h.acquire();
  h.host.apply = () => h.gateway.invalidateSelection();
  const p = h.send('transport.play');
  h.gateway.beforeFrame();
  await error(p, 'STALE_SELECTION');
  assert.equal(h.gateway.getLease(), null);
});
test('external acquisition preserves current adapter time as regression baseline', async () => {
  const h = harness();
  h.state.clock.seconds = 12;
  await h.acquire(true);
  await error(h.send('aircraft.pose', { timeSeconds: 0 }), 'CLOCK_REGRESSION');
  await applied(h, 'aircraft.pose', { timeSeconds: 12 });
});
test('history and pending limits reject without eviction, lost dedupe, or side effects', async () => {
  const h = harness({ maxPending: 1, maxRemembered: 4 });
  await h.acquire();
  const request = h.envelope('transport.play'),
    first = h.gateway.request(request);
  await error(h.send('transport.pause'), 'CAPACITY_EXCEEDED');
  h.render();
  await first;
  assert.equal(await h.gateway.request(request), await first);
  await error(h.send('nonsense'), 'OPERATION_UNSUPPORTED');
  await error(h.send('transport.pause'), 'CAPACITY_EXCEEDED');
  assert.equal(h.calls.length, 1);
});

test('session reset requires explicit consumed-results acknowledgement and idle control', async () => {
  const h = harness();
  await error(h.send('control.resetSession', {}), 'VALIDATION_FAILED');
  await error(
    h.send('control.resetSession', { acknowledgeCompletedResults: false }),
    'VALIDATION_FAILED',
  );
  await h.acquire();
  const pending = h.send('transport.play');
  h.gateway.beforeFrame();
  await error(
    h.send('control.resetSession', { acknowledgeCompletedResults: true }),
    'CONTROL_BUSY',
  );
  assert.equal(h.gateway.getState().commandEpoch, 0);
  await h.send('control.release');
  await error(pending, 'LEASE_REQUIRED');
  const reset = await h.send('control.resetSession', { acknowledgeCompletedResults: true });
  assert.equal(reset.ok, true);
  assert.equal(reset.data.commandEpoch, 1);
  const control = await h.gateway.request({ operation: 'control.state' });
  assert.equal(control.data.retained, 0);
  assert.equal(control.data.remaining, 10000);
  assert.equal(control.data.commandEpoch, 1);
  assert.deepEqual(control.data.lastReset.response, reset);
});
test('lost reset ACK retry returns its sole immutable receipt without advancing epoch twice', async () => {
  const h = harness();
  const request = h.envelope('control.resetSession', { acknowledgeCompletedResults: true });
  const first = await h.gateway.request(request),
    retry = await h.gateway.request({ ...request });
  assert.equal(retry, first);
  assert.equal(h.gateway.getState().commandEpoch, 1);
  const changed = { ...request, owner: 'other' };
  await error(h.gateway.request(changed), 'STALE_SESSION');
  assert.equal(h.gateway.getState().commandEpoch, 1);
});
test('old epoch commands, omitted epochs and stale reads reject after reset; discovery reads remain available', async () => {
  const h = harness();
  await h.acquire();
  const request = h.envelope('transport.play');
  const first = h.gateway.request(request);
  h.render();
  await first;
  await h.send('control.release');
  await h.send('control.resetSession', { acknowledgeCompletedResults: true });
  await error(h.gateway.request(request), 'STALE_SESSION');
  await error(h.send('control.acquire'), 'STALE_SESSION');
  await error(h.gateway.request({ operation: 'aircraft.state', epoch: 0 }), 'STALE_SESSION');
  assert.equal((await h.gateway.request({ operation: 'aircraft.state' })).data.commandEpoch, 1);
  assert.equal(
    (await h.gateway.request({ operation: 'system.capabilities' })).data.commandEpoch,
    1,
  );
  const acquired = await h.send('control.acquire', {}, { epoch: 1 });
  assert.equal(acquired.ok, true);
  assert.equal(h.calls.length, 1);
});
test('epochs deliberately scope command ids and retain only the latest reset receipt', async () => {
  const h = harness();
  const firstRequest = h.envelope('control.resetSession', { acknowledgeCompletedResults: true });
  await h.gateway.request(firstRequest);
  const nextRequest = { ...firstRequest, epoch: 1 };
  const second = await h.gateway.request(nextRequest);
  assert.equal(second.data.commandEpoch, 2);
  assert.equal(await h.gateway.request(nextRequest), second);
  await error(h.gateway.request(firstRequest), 'STALE_SESSION');
  const state = await h.gateway.request({ operation: 'control.state' });
  assert.equal(state.data.lastReset.request.epoch, 1);
  assert.equal(state.data.retained, 0);
});
test('saturated matching-owner release has one emergency slot and remains idempotent', async () => {
  const h = harness({ maxRemembered: 2 });
  await h.acquire();
  await applied(h, 'transport.play');
  const release = h.envelope('control.release');
  await error(
    h.gateway.request({ ...release, id: 'wrong-owner-release', owner: 'other' }),
    'OWNER_MISMATCH',
  );
  await error(
    h.gateway.request({ ...release, id: 'invalid-payload-release', payload: { surprise: true } }),
    'VALIDATION_FAILED',
  );
  let state = await h.gateway.request({ operation: 'control.state' });
  assert.equal(state.data.retained, 2);
  const original = await h.gateway.request(release);
  assert.equal(original.ok, true);
  assert.equal(await h.gateway.request(release), original);
  for (let i = 0; i < 10; i++) await error(h.send('control.release'), 'LEASE_REQUIRED');
  state = await h.gateway.request({ operation: 'control.state' });
  assert.equal(state.data.retained, 3);
  assert.equal(state.data.remaining, 0);
  assert.equal(state.data.lease, null);
  const reset = await h.send('control.resetSession', { acknowledgeCompletedResults: true });
  assert.equal(reset.ok, true);
  assert.equal((await h.gateway.request({ operation: 'control.state' })).data.retained, 0);
});
test('saturated disconnect cancels queued work and never requires a reload to recover', async () => {
  const h = harness({ maxRemembered: 2 });
  await h.acquire();
  const pending = h.send('transport.play');
  assert.equal((await h.send('control.disconnect')).ok, true);
  await error(pending, 'DISCONNECTED');
  assert.equal(
    (await h.send('control.resetSession', { acknowledgeCompletedResults: true })).data.commandEpoch,
    1,
  );
  assert.equal((await h.send('control.acquire', {}, { epoch: 1 })).ok, true);
});
test('invalid saturated resets cannot grow memory or discard completed outcomes', async () => {
  const h = harness({ maxRemembered: 1 });
  const remembered = h.envelope('config.update', { leaseTtlMs: 2000 });
  const original = await h.gateway.request(remembered);
  for (let i = 0; i < 20; i++)
    await error(
      h.send('control.resetSession', { acknowledgeCompletedResults: false }),
      'VALIDATION_FAILED',
    );
  const state = await h.gateway.request({ operation: 'control.state' });
  assert.equal(state.data.retained, 1);
  assert.equal(state.data.commandEpoch, 0);
  assert.equal(await h.gateway.request(remembered), original);
});
test('actual 10000-command gateway capacity releases, resets and accepts a new stream epoch', async () => {
  const h = harness();
  await h.acquire();
  for (let i = 1; i < 10000; i++) {
    const pending = h.send('transport.pause');
    h.render();
    assert.equal((await pending).ok, true);
  }
  let state = await h.gateway.request({ operation: 'control.state' });
  assert.equal(state.data.capacity, 10000);
  assert.equal(state.data.retained, 10000);
  assert.equal(state.data.remaining, 0);
  await error(h.send('transport.play'), 'CAPACITY_EXCEEDED');
  assert.equal((await h.send('control.release')).ok, true);
  const resetRequest = h.envelope('control.resetSession', { acknowledgeCompletedResults: true });
  const reset = await h.gateway.request(resetRequest);
  assert.equal(reset.ok, true);
  assert.equal(await h.gateway.request(resetRequest), reset);
  assert.equal((await h.send('control.acquire', {}, { epoch: 1 })).ok, true);
  state = await h.gateway.request({ operation: 'control.state' });
  assert.equal(state.data.commandEpoch, 1);
  assert.equal(state.data.retained, 1);
  assert.equal(state.data.remaining, 9999);
});
test('epoch input rejects nonintegers, negatives and future generations before dispatch', async () => {
  const h = harness();
  await error(h.send('control.acquire', {}, { epoch: null }), 'INVALID_REQUEST');
  await error(h.send('control.acquire', {}, { epoch: -1 }), 'INVALID_REQUEST');
  await error(h.send('control.acquire', {}, { epoch: 0.5 }), 'INVALID_REQUEST');
  await error(h.send('control.acquire', {}, { epoch: 1 }), 'STALE_SESSION');
  assert.equal(h.events.length, 0);
  assert.equal(h.gateway.getState().commandEpoch, 0);
});

function ev50Harness() {
  const external = new Ev50ExternalControl();
  let pauses = 0;
  const flight = {
    position: { toArray: () => [10, 20, 30] },
    quaternion: { toArray: () => [0, 0, 0, 1] },
    time: 47,
    lift: 0.5,
    cruise: 0.25,
    pause() {
      pauses++;
    },
  };
  external.acquire(flight);
  return { external, flight, pauses: () => pauses };
}
test('EV50 external acquisition preserves pose, starts paused at zero and repeated reads never advance', () => {
  const { external, pauses } = ev50Harness();
  const first = external.snapshot();
  assert.equal(first.time, 0);
  assert.deepEqual(first.position, [10, 20, 30]);
  assert.equal(external.playing, false);
  assert.equal(pauses(), 1);
  for (let i = 0; i < 100; i++) {
    assert.deepEqual(external.snapshot(), first);
    assert.equal(external.angle(0), 0);
  }
  const detached = external.snapshot();
  detached.position[0] = 999;
  assert.deepEqual(external.snapshot(), first);
});
test('EV50 paused step rejects atomically and explicit step alone advances pose, time and eleven rotor phases', () => {
  const { external } = ev50Harness();
  const first = external.snapshot();
  assert.throws(() => external.apply({ operation: 'clock.step', payload: { dt: 1 } }), /Resume/);
  assert.deepEqual(external.snapshot(), first);
  assert.equal(external.angle(0), 0);
  external.apply({
    operation: 'aircraft.pose',
    payload: { velocityMps: [2, -3, 4], timeSeconds: 5 },
  });
  external.apply({ operation: 'transport.play', payload: {} });
  external.apply({ operation: 'clock.step', payload: { dt: 0.25 } });
  const stepped = external.snapshot();
  assert.equal(stepped.time, 5.25);
  assert.deepEqual(stepped.position, [10.5, 19.25, 31]);
  assert.equal(stepped.rotorRpm.length, 11);
  assert.deepEqual(stepped.rotorRpm, [...Array(8).fill(900), ...Array(3).fill(450)]);
  assert.ok(Math.abs(external.angle(0) - 1.5 * Math.PI) < 1e-10);
  assert.ok(Math.abs(external.angle(10) - 1.75 * Math.PI) < 1e-10);
  for (let i = 0; i < 100; i++) assert.deepEqual(external.snapshot(), stepped);
  external.apply({ operation: 'transport.pause', payload: {} });
  const paused = external.snapshot(),
    angle = external.angle(0);
  assert.throws(() => external.apply({ operation: 'clock.step', payload: { dt: 1 } }), /Resume/);
  assert.deepEqual(external.snapshot(), paused);
  assert.equal(external.angle(0), angle);
});
test('EV50 release clears external authority and every new lease resets clock, velocity and rotor phase', () => {
  const { external, flight } = ev50Harness();
  external.apply({ operation: 'transport.play', payload: {} });
  external.apply({ operation: 'clock.step', payload: { dt: 0.25 } });
  external.release();
  assert.equal(external.active, false);
  assert.equal(external.playing, false);
  assert.equal(external.snapshot(), null);
  assert.throws(
    () => external.apply({ operation: 'ev50.motors', payload: { lift: 1, cruise: 1 } }),
    /lease/,
  );
  external.acquire(flight);
  assert.equal(external.snapshot().time, 0);
  assert.equal(external.angle(0), 0);
  assert.deepEqual(external.snapshot().velocity, [0, 0, 0]);
  assert.equal(external.playing, false);
});
test('EV50 grouped actuation keeps eight lift and three cruise rotors, never four-motor remapping', () => {
  const { external } = ev50Harness();
  external.apply({ operation: 'ev50.motors', payload: { lift: 0.2, cruise: 0.8 } });
  assert.deepEqual(external.snapshot().rotorRpm, [...Array(8).fill(360), ...Array(3).fill(1440)]);
  const before = external.snapshot();
  assert.throws(
    () =>
      external.apply({
        operation: 'transwing.motors',
        payload: { motors: { L_Front: { enabled: true } } },
      }),
    /Unsupported/,
  );
  assert.deepEqual(external.snapshot(), before);
});
test('EV50 step overflow rejects before changing position, time, sequence or rotor phases', () => {
  const { external } = ev50Harness();
  external.apply({
    operation: 'aircraft.pose',
    payload: { positionM: [99990, 0, 0], velocityMps: [20, 0, 0] },
  });
  external.apply({ operation: 'transport.play', payload: {} });
  const before = external.snapshot(),
    angle = external.angle(0);
  assert.throws(() => external.apply({ operation: 'clock.step', payload: { dt: 1 } }));
  assert.deepEqual(external.snapshot(), before);
  assert.equal(external.angle(0), angle);
});

let passed = 0;
try {
  for (const { name, run } of tests) {
    const start = fixtures.length;
    try {
      await run();
      passed++;
      console.log(`PASS ${name}`);
    } finally {
      for (const h of fixtures.slice(start)) h.gateway.dispose();
    }
  }
  console.log(`Unified control contract: ${passed}/${tests.length} passed`);
} finally {
  for (const h of fixtures) h.gateway.dispose();
  fs.rmSync(temporary, { recursive: true, force: true });
}
