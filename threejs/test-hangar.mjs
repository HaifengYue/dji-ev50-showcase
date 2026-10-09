// Node lifecycle/contract tests. These do not validate browser/WebGL rendering.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { testHangarContracts } from './qa/hangar-contracts.mjs';

const temporary = '.hangar-selection-test-tmp.mjs';
fs.writeFileSync(
  temporary,
  ts.transpileModule(fs.readFileSync('src/aircraft/selection.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText,
);

const tests = [];
function test(name, run) {
  tests.push({ name, run });
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function aircraft(name, onDispose) {
  return {
    name,
    disposeCount: 0,
    dispose() {
      this.disposeCount++;
      onDispose?.();
    },
  };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

try {
  const { createAircraftSelection } = await import(`./${temporary}`);
  function harness(extra = {}) {
    const loads = [],
      events = [];
    const selection = createAircraftSelection({
      load(id, signal) {
        const result = deferred();
        loads.push({ id, signal, ...result });
        return result.promise;
      },
      onPending: (id) => events.push(['pending', id]),
      onReady: (id, value) => events.push(['ready', id, value]),
      onError: (id, error) => events.push(['error', id, error]),
      ...extra,
    });
    return { selection, loads, events };
  }

  test('initial state and ready ownership', async () => {
    const { selection, loads, events } = harness();
    assert.equal(selection.current, null);
    assert.equal(selection.currentId, null);
    assert.equal(selection.pendingId, null);
    assert.equal(selection.error, null);
    const ready = selection.select('ev50');
    assert.equal(selection.pendingId, 'ev50');
    assert.equal(selection.current, null);
    const value = aircraft('ev50');
    loads[0].resolve(value);
    await ready;
    assert.equal(selection.current, value);
    assert.equal(selection.currentId, 'ev50');
    assert.equal(selection.pendingId, null);
    assert.deepEqual(
      events.map((e) => e.slice(0, 2)),
      [
        ['pending', 'ev50'],
        ['ready', 'ev50'],
      ],
    );
    selection.dispose();
    assert.equal(value.disposeCount, 1);
    assert.equal(selection.current, null);
  });

  test('duplicate pending selections share one promise and load', async () => {
    const { selection, loads } = harness();
    const first = selection.select('skytrans');
    assert.equal(selection.select('skytrans'), first);
    assert.equal(loads.length, 1);
    loads[0].resolve(aircraft('skytrans'));
    await first;
    await selection.select('skytrans');
    assert.equal(loads.length, 1);
    assert.equal(selection.current.disposeCount, 0);
    selection.dispose();
  });

  test('replacement clears and disposes active before pending/load callbacks', async () => {
    const order = [];
    const first = aircraft('ev50', () => {
      assert.equal(selection.current, null);
      assert.equal(selection.currentId, null);
      order.push('dispose');
    });
    const selection = createAircraftSelection({
      load(id) {
        order.push(`load:${id}`);
        return Promise.resolve(id === 'ev50' ? first : aircraft(id));
      },
      onPending: (id) => order.push(`pending:${id}`),
    });
    await selection.select('ev50');
    await selection.select('skytrans');
    assert.deepEqual(order, [
      'pending:ev50',
      'load:ev50',
      'dispose',
      'pending:skytrans',
      'load:skytrans',
    ]);
    assert.equal(first.disposeCount, 1);
    selection.dispose();
  });

  test('rapid swaps are latest-wins even when old loaders ignore abort', async () => {
    const { selection, loads, events } = harness();
    const first = selection.select('ev50');
    const second = selection.select('skytrans');
    const third = selection.select('ev50');
    assert.equal(loads[0].signal.aborted, true);
    assert.equal(loads[1].signal.aborted, true);
    assert.equal(loads[2].signal.aborted, false);
    await Promise.all([first, second]); // Superseded callers cannot hang on ignored abort.
    const old = aircraft('old'),
      middle = aircraft('middle'),
      latest = aircraft('latest');
    loads[2].resolve(latest);
    await third;
    loads[0].resolve(old);
    loads[1].resolve(middle);
    await flush();
    assert.equal(selection.current, latest);
    assert.equal(old.disposeCount, 1);
    assert.equal(middle.disposeCount, 1);
    assert.equal(latest.disposeCount, 0);
    assert.deepEqual(
      events.filter((e) => e[0] === 'ready').map((e) => e[2]),
      [latest],
    );
    selection.dispose();
  });

  test('abort rejection and stale failures do not change state or notify', async () => {
    const { selection, loads, events } = harness();
    const first = selection.select('ev50');
    loads[0].signal.addEventListener('abort', () => loads[0].reject(new Error('abort')));
    const second = selection.select('skytrans');
    await first;
    const value = aircraft('skytrans');
    loads[1].resolve(value);
    await second;
    await flush();
    assert.equal(selection.error, null);
    assert.equal(
      events.some((e) => e[0] === 'error'),
      false,
    );
    assert.equal(selection.current, value);
    selection.dispose();
  });

  test('failed load preserves error, retry clears it and can succeed', async () => {
    const { selection, loads, events } = harness();
    const failure = new Error('missing asset');
    const first = selection.select('skytrans');
    loads[0].reject(failure);
    await first;
    assert.equal(selection.error, failure);
    assert.equal(selection.pendingId, null);
    assert.equal(selection.currentId, null);
    assert.deepEqual(events.at(-1), ['error', 'skytrans', failure]);
    const retry = selection.select('skytrans');
    assert.equal(selection.error, null);
    const value = aircraft('retried');
    loads[1].resolve(value);
    await retry;
    assert.equal(selection.current, value);
    selection.dispose();
  });

  test('synchronous loader exceptions settle safely and allow retry', async () => {
    const failure = new Error('synchronous load');
    let calls = 0;
    const { selection, events } = harness({
      load() {
        if (++calls === 1) throw failure;
        return Promise.resolve(aircraft('recovered'));
      },
    });
    await selection.select('ev50');
    assert.equal(selection.error, failure);
    assert.deepEqual(events.at(-1), ['error', 'ev50', failure]);
    await selection.select('ev50');
    assert.equal(selection.current.name, 'recovered');
    selection.dispose();
  });

  test('dispose is terminal/idempotent and cleans late results once', async () => {
    const { selection, loads, events } = harness();
    const pending = selection.select('ev50');
    selection.dispose();
    selection.dispose();
    assert.equal(loads[0].signal.aborted, true);
    await pending;
    await selection.select('skytrans');
    assert.equal(loads.length, 1);
    const late = aircraft('late');
    loads[0].resolve(late);
    await flush();
    selection.dispose();
    assert.equal(late.disposeCount, 1);
    assert.equal(selection.current, null);
    assert.equal(selection.currentId, null);
    assert.equal(selection.pendingId, null);
    assert.equal(selection.error, null);
    assert.deepEqual(events, [['pending', 'ev50']]);
  });

  test('disposed controller ignores late rejection', async () => {
    const { selection, loads, events } = harness();
    const pending = selection.select('ev50');
    selection.dispose();
    loads[0].reject(new Error('late network error'));
    await pending;
    await flush();
    assert.equal(selection.error, null);
    assert.deepEqual(events, [['pending', 'ev50']]);
  });

  test('onPending can synchronously select a different aircraft', async () => {
    const { selection, loads, events } = harness({
      onPending(id) {
        events.push(['pending', id]);
        if (id === 'ev50') void selection.select('skytrans');
      },
    });
    await selection.select('ev50');
    assert.deepEqual(
      loads.map((l) => l.id),
      ['skytrans'],
    );
    const ready = selection.select('skytrans');
    loads[0].resolve(aircraft('skytrans'));
    await ready;
    assert.equal(selection.currentId, 'skytrans');
    selection.dispose();
  });

  test('onPending can synchronously dispose without starting a loader', async () => {
    const { selection, loads } = harness({
      onPending() {
        selection.dispose();
      },
    });
    await selection.select('ev50');
    assert.equal(loads.length, 0);
    assert.equal(selection.pendingId, null);
  });

  test('abort listener reentrancy cannot allow an obsolete outer load', async () => {
    const { selection, loads } = harness();
    const first = selection.select('ev50');
    loads[0].signal.addEventListener('abort', () => void selection.select('replacement'));
    const second = selection.select('skytrans');
    await Promise.all([first, second]);
    assert.deepEqual(
      loads.map((l) => l.id),
      ['ev50', 'replacement'],
    );
    const ready = selection.select('replacement');
    loads[1].resolve(aircraft('replacement'));
    await ready;
    loads[0].resolve(aircraft('old'));
    await flush();
    assert.equal(selection.currentId, 'replacement');
    selection.dispose();
  });

  test('active dispose reentrancy cannot resurrect outer selection', async () => {
    const { selection, loads } = harness();
    const first = selection.select('ev50');
    const value = aircraft('ev50', () => void selection.select('replacement'));
    loads[0].resolve(value);
    await first;
    await selection.select('skytrans');
    assert.deepEqual(
      loads.map((l) => l.id),
      ['ev50', 'replacement'],
    );
    const ready = selection.select('replacement');
    loads[1].resolve(aircraft('replacement'));
    await ready;
    assert.equal(value.disposeCount, 1);
    assert.equal(selection.currentId, 'replacement');
    selection.dispose();
  });

  test('onReady can replace an aircraft without stale cleanup/state changes', async () => {
    const { selection, loads, events } = harness({
      onReady(id, value) {
        events.push(['ready', id, value]);
        assert.equal(selection.current, value);
        assert.equal(selection.currentId, id);
        assert.equal(selection.pendingId, null);
        if (id === 'ev50') {
          void selection.select('skytrans');
          throw new Error('obsolete ready callback failure');
        }
      },
    });
    const first = selection.select('ev50');
    const ev50 = aircraft('ev50');
    loads[0].resolve(ev50);
    await first;
    assert.equal(selection.pendingId, 'skytrans');
    assert.equal(ev50.disposeCount, 1);
    assert.equal(
      events.some((e) => e[0] === 'error'),
      false,
    );
    const ready = selection.select('skytrans');
    loads[1].resolve(aircraft('skytrans'));
    await ready;
    selection.dispose();
  });

  test('onReady failure releases rejected installation and reports error', async () => {
    const failure = new Error('UI setup failed');
    const { selection, loads, events } = harness({
      onReady() {
        throw failure;
      },
    });
    const pending = selection.select('ev50');
    const value = aircraft('ev50');
    loads[0].resolve(value);
    await pending;
    assert.equal(value.disposeCount, 1);
    assert.equal(selection.current, null);
    assert.equal(selection.currentId, null);
    assert.equal(selection.error, failure);
    assert.deepEqual(events.at(-1), ['error', 'ev50', failure]);
    selection.dispose();
    assert.equal(value.disposeCount, 1);
  });

  test('onError can synchronously retry without old failure overwriting it', async () => {
    const { selection, loads } = harness({
      onError() {
        void selection.select('ev50');
      },
    });
    const first = selection.select('ev50');
    loads[0].reject(new Error('temporary'));
    await first;
    assert.equal(selection.error, null);
    assert.equal(selection.pendingId, 'ev50');
    const retry = selection.select('ev50');
    loads[1].resolve(aircraft('retry'));
    await retry;
    assert.equal(selection.current.name, 'retry');
    selection.dispose();
  });

  test('throwing pending/error/dispose hooks cannot reject or strand ownership', async () => {
    let shouldThrow = true;
    const { selection, loads } = harness({
      onPending() {
        if (shouldThrow) throw new Error('pending failed');
      },
      onError() {
        throw new Error('error notification failed');
      },
    });
    await selection.select('ev50');
    assert.equal(loads.length, 0);
    assert.equal(selection.error.message, 'pending failed');
    shouldThrow = false;
    const pending = selection.select('ev50');
    const value = aircraft('ev50', () => {
      throw new Error('dispose failed');
    });
    loads[0].resolve(value);
    await pending;
    const replacement = selection.select('skytrans');
    loads[1].resolve(aircraft('skytrans'));
    await replacement;
    assert.equal(value.disposeCount, 1);
    selection.dispose();
    selection.dispose();
  });

  test('synchronous loader reentrancy still owns and releases its eventual result', async () => {
    const old = aircraft('old');
    let selection;
    selection = createAircraftSelection({
      load(id) {
        if (id === 'ev50') {
          void selection.select('skytrans');
          return Promise.resolve(old);
        }
        return Promise.resolve(aircraft('skytrans'));
      },
    });
    await selection.select('ev50');
    await flush();
    assert.equal(old.disposeCount, 1);
    assert.equal(selection.currentId, 'skytrans');
    selection.dispose();
  });

  test('100 alternating switches release every instance exactly once', async () => {
    const { selection, loads, events } = harness();
    const callers = [];
    const values = [];
    for (let index = 0; index < 100; index++) {
      callers.push(selection.select(index % 2 === 0 ? 'ev50' : 'skytrans'));
      values.push(aircraft(`aircraft-${index}`));
    }
    for (let index = 99; index >= 0; index--) loads[index].resolve(values[index]);
    await Promise.all(callers);
    await flush();
    assert.equal(events.filter((event) => event[0] === 'ready').length, 1);
    assert.equal(selection.current, values[99]);
    assert.ok(values.slice(0, 99).every((value) => value.disposeCount === 1));
    selection.dispose();
    assert.ok(values.every((value) => value.disposeCount === 1));
  });

  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    for (const { name, run } of tests) {
      await run();
      console.log(`PASS hangar: ${name}`);
    }
    const contracts = await testHangarContracts();
    await flush();
    assert.deepEqual(unhandled, [], 'selection must never leak unhandled promise rejections');
    console.log(
      `PASS hangar lifecycle (${tests.length} lifecycle + ${contracts} contract cases; Node, not browser rendering)`,
    );
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
} finally {
  fs.rmSync(temporary, { force: true });
}
