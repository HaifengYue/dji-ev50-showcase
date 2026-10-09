import assert from 'node:assert/strict';
import http from 'node:http';
import { createHangarServer } from './hangar-server.mjs';
const server = createHangarServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/api/hangar/v1`;
const call = async (route, method = 'GET', data, headers = {}) => {
  const response = await fetch(base + route, {
    method,
    headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  return { status: response.status, body: await response.json() };
};
try {
  assert.equal((await call('/health')).body.ready, false);
  assert.equal(
    (await call('/commands', 'POST', { id: 'premature', operation: 'control.acquire' })).status,
    409,
  );
  assert.equal(
    (await call('/health', 'GET', null, { origin: 'https://unrelated.example' })).status,
    403,
  );
  const rejectedHost = await new Promise((resolve) => {
    http.get(base + '/health', { headers: { host: 'attacker.example' } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
  });
  assert.equal(rejectedHost, 403);
  assert.equal(
    (await call('/health', 'GET', null, { 'sec-fetch-site': 'cross-site' })).status,
    403,
  );
  assert.equal((await call('/viewer', 'POST', { viewerId: 'test-viewer' })).status, 200);
  assert.equal((await call('/viewer', 'POST', { viewerId: 'other-viewer' })).status, 409);
  const command = {
    id: 'test-command',
    operation: 'aircraft.pose',
    aircraft: 'ev50',
    generation: 1,
    owner: 'test',
    leaseId: 'lease-1',
    payload: { positionM: [1, 2, 3] },
  };
  const accepted = await call('/commands', 'POST', command);
  assert.equal(accepted.status, 202);
  const sequence = accepted.body.data.sequence;
  assert.equal((await call('/commands', 'POST', command)).body.data.sequence, sequence);
  assert.equal(
    (await call('/commands', 'POST', { ...command, payload: { positionM: [4, 5, 6] } })).status,
    409,
  );
  assert.equal((await call('/commands?after=0&viewerId=other-viewer')).status, 409);
  const queue = await call('/commands?after=0&viewerId=test-viewer');
  assert.equal(queue.body.data.commands.length, 1);
  assert.deepEqual(queue.body.data.commands[0].request, command);
  const result = {
    id: command.id,
    sequence,
    response: {
      protocol: 'hangar.control.v1',
      id: command.id,
      operation: command.operation,
      ok: true,
      ack: { status: 'applied', frame: 19 },
      data: { positionM: [1, 2, 3] },
    },
  };
  assert.equal(
    (await call('/results?viewerId=test-viewer', 'POST', { ...result, sequence: sequence + 1 }))
      .status,
    409,
  );
  assert.equal((await call('/results?viewerId=test-viewer', 'POST', result)).status, 200);
  assert.equal((await call('/results?viewerId=test-viewer', 'POST', result)).status, 200);
  assert.equal(
    (
      await call('/results?viewerId=test-viewer', 'POST', {
        ...result,
        response: { ...result.response, data: {} },
      })
    ).status,
    409,
  );
  const outcome = await call('/results/test-command');
  assert.equal(outcome.body.data.status, 'applied');
  assert.deepEqual(outcome.body.data.response, result.response);
  assert.equal((await call('/commands?after=0&viewerId=test-viewer')).body.data.commands.length, 0);
  await call('/state?viewerId=test-viewer', 'POST', { aircraft: 'ev50', generation: 1 });
  assert.equal((await call('/state')).body.data.aircraft, 'ev50');
  await call('/commands', 'POST', { ...command, id: 'unapplied' });
  await call('/viewer?viewerId=test-viewer', 'DELETE');
  assert.equal((await call('/results/unapplied')).body.data.response.error.code, 'DISCONNECTED');
  assert.equal((await call('/health')).body.ready, false);
  assert.equal((await call('/state')).body.data, null);
  console.log(
    'PASS unified local server: loopback origin gate, one viewer, exact idempotency, immutable applied results, ownership and disconnect',
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}

// Small capacities exercise the same bounded lifecycle without 2,000 network writes.
async function epochCases() {
  let clock = 0;
  const service = createHangarServer({ capacity: 2, now: () => clock });
  await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${service.address().port}/api/hangar/v1`;
  const call = async (route, method = 'GET', data) => {
    const response = await fetch(base + route, {
      method,
      ...(data
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }
        : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  const owner = { aircraft: 'ev50', generation: 1, owner: 'epoch-client', leaseId: 'lease-1' };
  const lease = { ...owner };
  const snapshot = (epoch, lastReset = null, activeLease = null) => ({
    state: { aircraft: 'ev50', generation: 1, commandEpoch: epoch, lease: activeLease },
    control: { ok: true, data: { lastReset } },
  });
  const response = (request, data = {}) => ({
    protocol: 'hangar.control.v1',
    id: request.id,
    operation: request.operation,
    ok: true,
    ack: { status: 'completed' },
    data,
  });
  const enqueue = async (request) => {
    const result = await call('/commands', 'POST', request);
    assert.equal(result.status, 202);
    return result.body.data.sequence;
  };
  const finish = (request, seq, outcome = response(request)) =>
    call('/results?viewerId=epoch-viewer', 'POST', {
      id: request.id,
      epoch: request.epoch ?? 0,
      sequence: seq,
      response: outcome,
    });
  try {
    await call('/viewer', 'POST', { viewerId: 'epoch-viewer' });
    await call('/state?viewerId=epoch-viewer', 'POST', snapshot(0, null, lease));
    const first = { ...owner, id: 'reuse', operation: 'transport.pause', payload: {} };
    const seq = await enqueue(first);
    await finish(first, seq);
    const reordered = {
      payload: {},
      operation: first.operation,
      id: first.id,
      leaseId: owner.leaseId,
      owner: owner.owner,
      generation: 1,
      aircraft: 'ev50',
    };
    assert.equal((await call('/commands', 'POST', reordered)).body.data.sequence, seq);
    const second = { ...first, id: 'fill' };
    await finish(second, await enqueue(second));
    assert.equal((await call('/commands', 'POST', { ...first, id: 'full' })).status, 429);
    assert.equal(
      (
        await call('/commands', 'POST', {
          ...owner,
          id: 'bad-release',
          operation: 'control.release',
          payload: { surprise: true },
        })
      ).status,
      429,
    );
    assert.equal(
      (
        await call('/commands', 'POST', {
          ...owner,
          id: 'bad-envelope',
          operation: 'control.release',
          extra: true,
          payload: {},
        })
      ).status,
      400,
    );
    assert.equal((await call('/state')).body.data.service.retained, 2);
    const release = {
      ...owner,
      id: 'saturated-release',
      operation: 'control.release',
      payload: {},
    };
    const released = await enqueue(release);
    await finish(release, released);
    assert.equal((await call('/commands', 'POST', release)).body.data.sequence, released);
    await call('/state?viewerId=epoch-viewer', 'POST', snapshot(0));
    const reset = {
      aircraft: 'ev50',
      generation: 1,
      owner: 'epoch-client',
      id: 'reset-zero',
      operation: 'control.resetSession',
      payload: { acknowledgeCompletedResults: true },
    };
    const resetting = await enqueue(reset);
    assert.equal((await call('/state')).body.data.service.commandEpoch, 0);
    const failed = {
      protocol: 'hangar.control.v1',
      id: reset.id,
      operation: reset.operation,
      ok: false,
      error: { code: 'CONTROL_BUSY', message: 'Synthetic race with direct browser lease' },
    };
    await finish(reset, resetting, failed);
    assert.equal((await call('/state')).body.data.service.retained, 4);
    // A browser-direct completed reset can retire old HTTP results and queues too.
    const direct = { ...reset, id: 'browser-direct-reset', epoch: 0 };
    const receipt = { request: direct, response: response(direct, { commandEpoch: 1 }) };
    assert.equal(
      (await call('/state?viewerId=epoch-viewer', 'POST', snapshot(1, receipt))).status,
      200,
    );
    assert.equal((await call('/state')).body.data.service.remaining, 2);
    assert.equal((await call('/commands', 'POST', first)).body.error.code, 'STALE_SESSION');
    assert.equal((await call('/results/reuse?epoch=0')).body.error.code, 'STALE_SESSION');
    assert.equal((await finish(first, seq)).body.retired, true);
    const fresh = { ...first, epoch: 1 };
    await finish(fresh, await enqueue(fresh));
    const nextReset = { ...reset, epoch: 1, id: 'reset-one' };
    const nextSequence = await enqueue(nextReset);
    const nextResult = response(nextReset, { commandEpoch: 2 });
    await finish(nextReset, nextSequence, nextResult);
    assert.equal((await call('/commands', 'POST', nextReset)).body.data.sequence, nextSequence);
    assert.deepEqual((await call('/results/reset-one?epoch=1')).body.data.response, nextResult);
    assert.equal((await finish(nextReset, nextSequence, nextResult)).status, 200);
    assert.equal((await call('/state')).body.data.service.commandEpoch, 2);
    assert.equal((await call('/state')).body.data.service.retained, 0);
    assert.equal(
      (await call('/commands', 'POST', { ...nextReset, id: 'different-reset' })).body.error.code,
      'STALE_SESSION',
    );
    // Multiple browser-direct resets between publications catch up from a bounded newest receipt.
    const skipped = { ...reset, id: 'direct-reset-four', epoch: 3 };
    const skippedReceipt = { request: skipped, response: response(skipped, { commandEpoch: 4 }) };
    assert.equal(
      (await call('/state?viewerId=epoch-viewer', 'POST', snapshot(4, skippedReceipt))).status,
      200,
    );
    assert.equal((await call('/state')).body.data.service.commandEpoch, 4);
    const queuedOld = { ...first, id: 'queued-before-direct-reset', epoch: 4 };
    await enqueue(queuedOld);
    const directFive = { ...reset, id: 'direct-reset-five', epoch: 4 };
    const receiptFive = {
      request: directFive,
      response: response(directFive, { commandEpoch: 5 }),
    };
    await call('/state?viewerId=epoch-viewer', 'POST', snapshot(5, receiptFive));
    assert.equal(
      (await call('/commands?after=0&viewerId=epoch-viewer')).body.data.commands.length,
      0,
    );
    assert.equal((await call('/commands', 'POST', queuedOld)).body.error.code, 'STALE_SESSION');
    // New epoch queued work is terminated when a viewer really expires.
    const pending = { ...first, id: 'expires', epoch: 5 };
    await enqueue(pending);
    clock = 16000;
    assert.equal((await call('/health')).body.ready, false);
    assert.equal(
      (await call('/results/expires?epoch=5')).body.data.response.error.code,
      'DISCONNECTED',
    );
    console.log(
      'PASS unified service epochs: saturation escape, failed/queued reset retention, canonical retries, completed-only rotation, lost-reset ACK, browser-direct reset, stale outbox, expiry',
    );
  } finally {
    await new Promise((resolve) => service.close(resolve));
  }
}
await epochCases();

async function lifecycleReserveRace() {
  const service = createHangarServer({ capacity: 1 });
  await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${service.address().port}/api/hangar/v1`;
  const call = async (route, method = 'GET', data) => {
    const r = await fetch(base + route, {
      method,
      ...(data
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }
        : {}),
    });
    return { status: r.status, body: await r.json() };
  };
  const owner = { aircraft: 'ev50', generation: 1, owner: 'race-client', leaseId: 'race-lease' };
  const publish = (epoch, lease, lastReset = null) =>
    call('/state?viewerId=race-viewer', 'POST', {
      state: { aircraft: 'ev50', generation: 1, commandEpoch: epoch, lease },
      control: { ok: true, data: { lastReset } },
    });
  try {
    await call('/viewer', 'POST', { viewerId: 'race-viewer' });
    await publish(0, owner);
    for (let i = 0; i < 3; i++) {
      const request = {
        ...owner,
        id: `race-${i}`,
        operation: i ? 'control.release' : 'transport.pause',
        payload: {},
      };
      const queued = await call('/commands', 'POST', request);
      assert.equal(queued.status, 202);
      await call('/results?viewerId=race-viewer', 'POST', {
        id: request.id,
        sequence: queued.body.data.sequence,
        response: {
          protocol: 'hangar.control.v1',
          id: request.id,
          operation: request.operation,
          ok: false,
          error: { code: 'LEASE_MISMATCH', message: 'Synthetic concurrent ownership change' },
        },
      });
    }
    const blocked = await call('/commands', 'POST', {
      ...owner,
      id: 'valid-release-after-races',
      operation: 'control.release',
      payload: {},
    });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, 'LIFECYCLE_CAPACITY');
    assert.match(blocked.body.error.message, /page Disconnect/);
    // The page's direct gateway exit does not enqueue an HTTP command; its explicit reset receipt recovers both caches.
    await publish(0, null);
    const request = {
      aircraft: 'ev50',
      generation: 1,
      owner: 'local-ui',
      id: 'recover-direct',
      operation: 'control.resetSession',
      payload: { acknowledgeCompletedResults: true },
      epoch: 0,
    };
    const receipt = {
      request,
      response: {
        protocol: 'hangar.control.v1',
        id: request.id,
        operation: request.operation,
        ok: true,
        ack: { status: 'completed' },
        data: { commandEpoch: 1 },
      },
    };
    assert.equal((await publish(1, null, receipt)).status, 200);
    const state = (await call('/state')).body.data;
    assert.equal(state.service.retained, 0);
    assert.equal(state.service.remaining, 1);
    assert.equal(
      (
        await call('/commands', 'POST', {
          ...owner,
          id: 'fresh-after-recovery',
          epoch: 1,
          operation: 'aircraft.state',
        })
      ).status,
      202,
    );
    console.log(
      'PASS HTTP lifecycle race: immutable failed reserves, explicit LIFECYCLE_CAPACITY and direct-page release/reset recovery without reload',
    );
  } finally {
    await new Promise((resolve) => service.close(resolve));
  }
}
await lifecycleReserveRace();

// Legacy spelling cannot create a second mailbox identity or strand a saturated lease.
const aliases = createHangarServer({ capacity: 1 });
await new Promise((resolve) => aliases.listen(0, '127.0.0.1', resolve));
try {
  const base = `http://127.0.0.1:${aliases.address().port}/api/hangar/v1`;
  const call = async (route, data) => {
    const response = await fetch(base + route, {
      method: data ? 'POST' : 'GET',
      ...(data
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }
        : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  const lease = {
    aircraft: 'skytrans',
    generation: 1,
    owner: 'alias-client',
    leaseId: 'single-lease',
  };
  await call('/viewer', { viewerId: 'alias-viewer' });
  await call('/state?viewerId=alias-viewer', { state: { ...lease, commandEpoch: 0, lease } });
  const old = {
    ...lease,
    aircraft: 'transwing',
    id: 'same',
    operation: 'transwing.motors',
    payload: { motors: { L_Front: { targetRpm: 100 } } },
  };
  const first = await call('/commands', old);
  assert.equal(first.status, 202);
  const duplicate = await call('/commands', {
    ...old,
    aircraft: 'skytrans',
    operation: 'skytrans.motors',
  });
  assert.equal(duplicate.status, 202);
  assert.equal(duplicate.body.data.sequence, first.body.data.sequence);
  assert.equal(duplicate.body.data.duplicate, true);
  const changed = await call('/commands', {
    ...old,
    payload: { motors: { L_Front: { targetRpm: 101 } } },
  });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error.code, 'ID_CONFLICT');
  const release = await call('/commands', {
    ...lease,
    aircraft: 'transwing',
    id: 'legacy-release',
    operation: 'control.release',
    payload: {},
  });
  assert.equal(release.status, 202, JSON.stringify(release));
  const queued = await call('/commands?viewerId=alias-viewer&after=0');
  assert.equal(queued.body.data.commands.length, 2);
  const complete = async (request, sequence, data = {}) => {
    const response = {
      protocol: 'hangar.control.v1',
      id: request.id,
      operation: request.operation,
      ok: true,
      ack: { status: 'completed' },
      data,
    };
    const result = await call('/results?viewerId=alias-viewer', {
      id: request.id,
      epoch: request.epoch ?? 0,
      sequence,
      response,
    });
    assert.equal(result.status, 200, JSON.stringify(result));
    return response;
  };
  await complete(old, first.body.data.sequence);
  assert.equal((await call('/results/same')).body.data.response.operation, 'transwing.motors');
  const releaseRequest = queued.body.data.commands.find(
    (entry) => entry.request.id === 'legacy-release',
  ).request;
  await complete(releaseRequest, release.body.data.sequence);
  await call('/state?viewerId=alias-viewer', {
    state: { aircraft: 'skytrans', generation: 1, commandEpoch: 0, lease: null },
  });
  const resetRequest = {
    aircraft: 'transwing',
    generation: 1,
    owner: 'alias-client',
    id: 'alias-reset',
    operation: 'control.resetSession',
    payload: { acknowledgeCompletedResults: true },
  };
  const resetting = await call('/commands', resetRequest);
  assert.equal(resetting.status, 202, JSON.stringify(resetting));
  await complete(resetRequest, resetting.body.data.sequence, { commandEpoch: 1 });
  const retryReset = await call('/commands', { ...resetRequest, aircraft: 'skytrans' });
  assert.equal(retryReset.status, 202);
  assert.equal(retryReset.body.data.duplicate, true);
  assert.equal(retryReset.body.data.sequence, resetting.body.data.sequence);
  assert.equal((await call('/health')).body.history.commandEpoch, 1);
  const stale = await call('/commands', old);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'STALE_SESSION');
  console.log(
    'PASS HTTP legacy aliases: single identity, immutable first receipt, saturated release, canonical reset retry and stale-epoch rejection',
  );
} finally {
  await new Promise((resolve) => aliases.close(resolve));
}
