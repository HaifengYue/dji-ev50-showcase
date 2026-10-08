// Controlled fetch/timer doubles exercise the real bridge and gateway, without network traffic.
import assert from 'node:assert/strict';

const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export async function testHangarApi({ load, passed }) {
  const original = {
    window: globalThis.window,
    fetch: globalThis.fetch,
    info: console.info,
    warn: console.warn,
  };
  const { startHttpBridge } = await load('api/http-bridge.ts');
  console.info = () => {};
  console.warn = () => {};
  async function withBridge(port, run) {
    const calls = [],
      requests = [],
      timers = [],
      stops = [],
      commands = [];
    globalThis.window = {
      location: {
        href: 'https://example.test/hangar/',
        search: `?apiBridge=http://127.0.0.1:${port}`,
      },
      setTimeout(callback) {
        timers.push(callback);
        return timers.length;
      },
    };
    globalThis.fetch = (url, options) => {
      const pending = deferred();
      const call = { url: new URL(url), options, ...pending };
      calls.push(call);
      requests.push(call);
      return pending.promise;
    };
    function start(owner = 'original') {
      const stop = startHttpBridge({
        ready: true,
        request(command) {
          commands.push({ owner, ...command });
          return { id: command.id, operation: command.operation, ok: true, data: { owner } };
        },
      });
      stops.push(stop);
      return stop;
    }
    function respond(call, data = {}) {
      call.resolve({ ok: true, json: async () => ({ data }) });
    }
    async function next(pathname) {
      await flush();
      assert.ok(calls.length > 0, `Expected ${pathname}; no request was made`);
      const call = calls.shift();
      assert.equal(call.url.pathname, pathname);
      return call;
    }
    async function runTimer() {
      await flush();
      assert.ok(timers.length > 0, 'Expected a retry/poll timer');
      timers.shift()();
      await flush();
    }
    async function nextPoll() {
      await flush();
      // Successful loops may publish state and schedule their next poll first.
      if (calls[0]?.url.pathname === '/api/v1/bridge/state') {
        respond(calls.shift());
        await flush();
      }
      if (calls.length === 0) await runTimer();
      return next('/api/v1/bridge/commands');
    }
    const sideEffects = (id) => commands.filter((command) => command.id === id);
    try {
      await run({ start, respond, next, nextPoll, runTimer, sideEffects, calls, commands });
    } finally {
      stops.forEach((stop) => stop());
      requests.forEach((call) => call.reject(new DOMException('Test cleanup', 'AbortError')));
      timers.splice(0).forEach((callback) => callback());
      await flush();
    }
  }
  try {
    await withBridge(8787, async ({ start, next, respond, calls, commands }) => {
      const stop = start();
      const poll = await next('/api/v1/bridge/commands');
      stop();
      stop();
      assert.equal(poll.options.signal.aborted, true);
      respond(poll, { commands: [{ sequence: 1, id: 'obsolete', operation: 'flight.play' }] });
      await flush();
      assert.deepEqual(commands, []);
      assert.equal(calls.length, 0);
      passed('stopped EV50 bridge aborts fetch and ignores a late command response');
    });

    await withBridge(8788, async ({ start, next, nextPoll, respond, sideEffects, calls }) => {
      const stop = start();
      respond(await nextPoll(), {
        commands: [{ sequence: 7, id: 'first', operation: 'flight.play' }],
      });
      const oldAck = await next('/api/v1/bridge/results');
      assert.equal(sideEffects('first').length, 1);
      stop();
      respond(oldAck);
      await flush();
      assert.equal(calls.length, 0, 'stopped session must not publish a snapshot');
      start('replacement');
      await flush();
      // A stopped owner's confirmed late ACK may be retried conservatively.
      if (calls[0]?.url.pathname === '/api/v1/bridge/results') {
        const retry = await next('/api/v1/bridge/results');
        assert.equal(retry.options.body, oldAck.options.body);
        respond(retry);
      }
      const resumed = await nextPoll();
      assert.equal(resumed.url.searchParams.get('after'), '7');
      respond(resumed, { commands: [{ sequence: 8, id: 'stale', operation: 'flight.play' }] });
      const staleAck = await next('/api/v1/bridge/results');
      assert.equal(sideEffects('stale').length, 0);
      assert.equal(JSON.parse(staleAck.options.body).response.error.code, 'STALE_SELECTION');
      respond(staleAck);
      passed('late result after stop cannot erase re-entry quarantine or bridge sequence cursor');
      const freshPoll = await nextPoll();
      assert.equal(freshPoll.url.searchParams.get('after'), '8');
      respond(freshPoll, { commands: [{ sequence: 9, id: 'fresh', operation: 'flight.play' }] });
      const freshAck = await next('/api/v1/bridge/results');
      assert.equal(sideEffects('fresh').length, 1);
      assert.equal(sideEffects('fresh')[0].owner, 'replacement');
      assert.equal(JSON.parse(freshAck.options.body).response.ok, true);
      passed('resumed EV50 bridge accepts new commands after rejecting the stale first batch');
    });

    await withBridge(8789, async ({ start, next, nextPoll, runTimer, respond, sideEffects }) => {
      start();
      respond(await nextPoll(), {
        commands: [{ sequence: 11, id: 'retry-result', operation: 'flight.play' }],
      });
      const firstAck = await next('/api/v1/bridge/results');
      firstAck.reject(new Error('Synthetic transient ACK failure'));
      await runTimer();
      const retriedAck = await next('/api/v1/bridge/results');
      assert.equal(
        retriedAck.options.body,
        firstAck.options.body,
        'retry must retain original id/sequence/response',
      );
      assert.equal(
        sideEffects('retry-result').length,
        1,
        'ACK retry must not repeat command side effects',
      );
      respond(retriedAck);
      const poll = await nextPoll();
      assert.equal(poll.url.searchParams.get('after'), '11');
      respond(poll, { commands: [{ sequence: 12, id: 'after-retry', operation: 'flight.pause' }] });
      const result = await next('/api/v1/bridge/results');
      assert.equal(sideEffects('after-retry').length, 1);
      assert.equal(JSON.parse(result.options.body).id, 'after-retry');
      passed(
        'transient result POST failure retries identical ACK before polling without repeating side effects',
      );
    });

    await withBridge(8790, async ({ start, next, nextPoll, respond, sideEffects, calls }) => {
      const stop = start('old-aircraft');
      respond(await nextPoll(), {
        commands: [{ sequence: 21, id: 'old-ack', operation: 'flight.play' }],
      });
      const oldAck = await next('/api/v1/bridge/results');
      stop();
      assert.equal(oldAck.options.signal.aborted, true);
      start('new-aircraft');
      const replayAck = await next('/api/v1/bridge/results');
      assert.equal(replayAck.options.body, oldAck.options.body);
      assert.deepEqual(JSON.parse(replayAck.options.body), {
        id: 'old-ack',
        sequence: 21,
        response: {
          id: 'old-ack',
          operation: 'flight.play',
          ok: true,
          data: { owner: 'old-aircraft' },
        },
      });
      assert.equal(sideEffects('old-ack').length, 1);
      assert.equal(sideEffects('old-ack')[0].owner, 'old-aircraft');
      // Complete the superseded request while the new owner is retrying that ACK.
      respond(oldAck);
      await flush();
      assert.equal(
        calls.length,
        0,
        'old ACK callback must not start a poll or skip the new pending ACK',
      );
      respond(replayAck);
      const poll = await nextPoll();
      assert.equal(poll.url.searchParams.get('after'), '21');
      respond(poll, { commands: [{ sequence: 22, id: 'quarantined', operation: 'flight.play' }] });
      const staleAck = await next('/api/v1/bridge/results');
      assert.equal(sideEffects('quarantined').length, 0);
      assert.equal(JSON.parse(staleAck.options.body).response.error.code, 'STALE_SELECTION');
      respond(staleAck);
      const newPoll = await nextPoll();
      respond(newPoll, {
        commands: [{ sequence: 23, id: 'new-command', operation: 'flight.pause' }],
      });
      const newAck = await next('/api/v1/bridge/results');
      assert.equal(sideEffects('new-command').length, 1);
      assert.equal(sideEffects('new-command')[0].owner, 'new-aircraft');
      assert.equal(JSON.parse(newAck.options.body).response.data.owner, 'new-aircraft');
      passed(
        'pending ACK survives aircraft switch with original response and late old callback cannot remove quarantine',
      );
    });

    await withBridge(8791, async ({ start, next, nextPoll, runTimer, respond, sideEffects }) => {
      const stop = start('before-switch');
      const oldPoll = await nextPoll();
      stop();
      respond(oldPoll, { commands: [] });
      await flush();
      start('resumed');
      respond(await nextPoll(), {
        commands: [
          { sequence: 31, id: 'stale-a', operation: 'flight.play' },
          { sequence: 32, id: 'stale-b', operation: 'flight.play' },
        ],
      });
      const firstStaleAck = await next('/api/v1/bridge/results');
      assert.equal(JSON.parse(firstStaleAck.options.body).response.error.code, 'STALE_SELECTION');
      firstStaleAck.reject(new Error('Synthetic stale-result ACK failure'));
      await runTimer();
      const retryAck = await next('/api/v1/bridge/results');
      assert.equal(retryAck.options.body, firstStaleAck.options.body);
      respond(retryAck);
      const poll = await nextPoll();
      assert.equal(poll.url.searchParams.get('after'), '31');
      respond(poll, {
        commands: [
          { sequence: 31, id: 'stale-a', operation: 'flight.play' },
          { sequence: 32, id: 'stale-b', operation: 'flight.play' },
          { sequence: 33, id: 'after-cutoff', operation: 'flight.pause' },
        ],
      });
      const remainingStaleAck = await next('/api/v1/bridge/results');
      assert.equal(JSON.parse(remainingStaleAck.options.body).id, 'stale-b');
      assert.equal(
        JSON.parse(remainingStaleAck.options.body).response.error.code,
        'STALE_SELECTION',
      );
      assert.equal(sideEffects('stale-a').length, 0);
      assert.equal(sideEffects('stale-b').length, 0);
      respond(remainingStaleAck);
      const freshAck = await next('/api/v1/bridge/results');
      assert.equal(JSON.parse(freshAck.options.body).id, 'after-cutoff');
      assert.equal(JSON.parse(freshAck.options.body).response.ok, true);
      assert.equal(sideEffects('after-cutoff').length, 1);
      passed(
        'ACK failure preserves first-batch quarantine cutoff without rejecting newer commands or processing duplicates',
      );
    });

    const { Ev50ApiGateway } = await load('api/gateway.ts');
    const { visualOperations } = await load('api/contracts.ts');
    let selected = 'ev50';
    const mutations = [];
    const runtime = {
      get ready() {
        return selected === 'ev50';
      },
      getState: () => ({ id: 'ev50' }),
      command: (value) => {
        mutations.push(value);
        return { id: 'ev50' };
      },
      visualRequest: (operation, payload) => {
        mutations.push([operation, payload]);
        return {};
      },
    };
    const gateway = new Ev50ApiGateway(runtime);
    assert.equal(
      gateway.request({
        operation: 'flight.command',
        payload: { type: 'motor', lift: 0.5, cruise: 0 },
      }).ok,
      true,
    );
    selected = 'transwing';
    assert.equal(gateway.request({ operation: 'system.health' }).data.ready, false);
    for (const operation of [
      'flight.command',
      'flight.play',
      'settings.get',
      ...visualOperations,
    ]) {
      const response = gateway.request({ operation, payload: {} });
      assert.equal(response.ok, false, operation);
      assert.equal(response.error.code, 'NOT_READY', operation);
    }
    assert.equal(mutations.length, 1);
    selected = 'ev50';
    assert.equal(gateway.request({ operation: 'flight.state' }).data.id, 'ev50');
    passed(
      'EV50 gateway rejects all flight/settings/telemetry operations while another aircraft is selected',
    );
  } finally {
    globalThis.window = original.window;
    globalThis.fetch = original.fetch;
    console.info = original.info;
    console.warn = original.warn;
  }
}
