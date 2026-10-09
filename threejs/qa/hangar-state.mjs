// State/session/panel cancellation tests use DOM and WebSocket doubles, not browser UI.
import assert from 'node:assert/strict';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const frame = (sequence, time) => ({
  version: 1,
  sequence,
  time,
  frame: 'SCENE',
  position: [sequence, 12, -4],
  quaternion: [0, 0, 0, 1],
  velocity: [4, 0, 0],
  rotorRpm: Array(11).fill(1200),
  surfaces: { aileron: 0, elevator: 0, rudder: 0 },
});

export async function testHangarState({ load, passed }) {
  const originals = {
    document: globalThis.document,
    fetch: globalThis.fetch,
    location: globalThis.location,
    WebSocket: globalThis.WebSocket,
  };
  try {
    const { VisualSession } = await load('simulation/session.ts');
    const session = new VisualSession(() => {});
    session.request('simulation.record.start');
    session.capture(frame(1, 0), 10);
    session.capture(frame(2, 0.2), 10.2);
    session.load({ version: 1, frames: [frame(1, 0), frame(2, 0.2)] });
    session.pause(true);
    assert.equal(session.state().recording.count, 2);
    assert.equal(session.state().replay.duration, 0.2);
    session.reset();
    const state = session.state();
    assert.equal(state.source, 'demo');
    assert.equal(state.paused, false);
    assert.equal(state.recording.active, false);
    assert.equal(state.recording.count, 0);
    assert.equal(state.replay.duration, 0);
    assert.equal(state.replay.time, 0);
    assert.equal(session.frame, null);
    passed('EV50 reset clears replay/recording/frame/paused state between selections');

    let socket;
    globalThis.location = { protocol: 'https:' };
    globalThis.WebSocket = class {
      constructor() {
        socket = this;
        this.closeCount = 0;
      }
      close() {
        this.closeCount++;
      }
    };
    session.connect('wss://example.test/telemetry');
    const lateMessage = socket.onmessage;
    session.reset();
    assert.equal(socket.closeCount, 1);
    assert.equal(socket.onmessage, null);
    lateMessage({
      data: JSON.stringify({ type: 'LOCAL_POSITION_NED', time_usec: 5, x: 2, y: 3, z: -4 }),
    });
    assert.equal(session.state().source, 'demo');
    assert.equal(session.state().transport, 'disconnected');
    assert.equal(session.frame, null);
    passed('EV50 reset closes transport and rejects an already-queued old socket callback');

    const { SimulationRuntime } = await load('aircraft/skytrans/core/simulation.ts');
    const { INITIAL_EXPERIENCE } = await load('aircraft/skytrans/core/experience.ts');
    const { NEUTRAL_DETAIL_POSE } = await load('aircraft/skytrans/core/details.ts');
    const { prepareManualInput } = await load('aircraft/skytrans/localControl.ts');
    const { SURFACE_IDS } = await load('aircraft/skytrans/core/surfaces.ts');
    const runtime = new SimulationRuntime();
    const otherRuntime = new SimulationRuntime();
    runtime.setReady(true);
    otherRuntime.setReady(true);
    runtime.setLocal({ wingTilt: 0.6, surfaces: { L_Inboard: 10, Tail_R: -8 }, hatchDeg: 25 });
    const detailState = {
      ...structuredClone(INITIAL_EXPERIENCE),
      detailView: 'cargo',
      detailPose: { ...NEUTRAL_DETAIL_POSE, hatch: 25 },
      detailReturnProgress: 0.2,
      cameraView: 'side',
      inspection: true,
      cameraReset: 7,
    };
    const beforeDetail = structuredClone(detailState);
    const motorPatch = { motors: { L_Front: { targetRpm: 1200, enabled: true } } };
    const manual = prepareManualInput(detailState, runtime.getSnapshot(), motorPatch);
    assert.equal(manual.state.detailView, null);
    assert.deepEqual(manual.state.detailPose, NEUTRAL_DETAIL_POSE);
    assert.equal(manual.state.detailReturnProgress, null);
    assert.deepEqual(manual.patch.surfaces, Object.fromEntries(SURFACE_IDS.map((id) => [id, 0])));
    assert.equal(manual.patch.hatchDeg, 0);
    assert.deepEqual(manual.patch.motors, motorPatch.motors);
    assert.equal(manual.state.tilt.progress, 0.6);
    for (const key of ['cameraView', 'inspection', 'cameraReset'])
      assert.equal(manual.state[key], detailState[key]);
    assert.deepEqual(detailState, beforeDetail);
    passed(
      'entering SkyTrans motor control neutralizes detail actuators without moving the camera',
    );

    const independent = prepareManualInput(detailState, runtime.getSnapshot(), {
      surfaces: { L_Outboard: 9 },
    });
    assert.equal(independent.state.detailView, 'cargo');
    assert.deepEqual(independent.patch.surfaces, { L_Outboard: 9 });
    assert.equal('hatchDeg' in independent.patch, false);
    runtime.setLocal(independent.patch, 'manual');
    assert.equal(runtime.getSnapshot().state.surfaces.L_Inboard, 10);
    assert.equal(runtime.getSnapshot().state.surfaces.L_Outboard, 9);
    assert.equal(runtime.getSnapshot().state.surfaces.Tail_R, -8);
    assert.equal(runtime.getSnapshot().state.hatchDeg, 25);
    assert.deepEqual(
      otherRuntime.getSnapshot().state.surfaces,
      Object.fromEntries(SURFACE_IDS.map((id) => [id, 0])),
    );
    assert.equal(otherRuntime.getSnapshot().state.wingTilt, 0);
    runtime.dispose();
    runtime.dispose();
    assert.equal(runtime.getSnapshot().disposed, true);
    assert.equal(otherRuntime.getSnapshot().disposed, false);
    assert.equal(otherRuntime.getSnapshot().ready, true);
    otherRuntime.dispose();
    passed(
      'SkyTrans surfaces remain independent and separate runtime instances share no mutable state',
    );

    const elements = new Map();
    function element(id) {
      if (!elements.has(id))
        elements.set(id, { id, value: '', textContent: '', disabled: false, click() {} });
      return elements.get(id);
    }
    globalThis.document = {
      baseURI: 'https://example.test/hangar/',
      createElement(tag) {
        return {
          tag,
          dataset: {},
          prepend() {},
          querySelectorAll: () => [...elements.values()],
        };
      },
      querySelector: () => ({ prepend() {} }),
      getElementById: element,
    };
    const requests = [],
      fetches = [];
    globalThis.fetch = (url, options) => {
      const pending = deferred();
      fetches.push({ url, options, ...pending });
      return pending.promise;
    };
    const { simulationPanel } = await load('simulation/panel.ts');
    const panel = simulationPanel(
      {
        request(request) {
          requests.push(request);
          return { ok: true, data: {} };
        },
      },
      session,
      () => ({}),
    );
    const first = element('sim-ulog').onclick();
    panel.deactivate();
    assert.equal(fetches[0].options.signal.aborted, true);
    fetches[0].resolve({ ok: true, text: async () => 'late ULog recording' });
    await first;
    assert.deepEqual(requests, []);
    assert.equal(element('sim-message').textContent, '');
    passed('deactivating EV50 panel aborts ULog and blocks abort-insensitive late completion');

    const fileText = deferred();
    const input = {
      value: 'selected',
      files: [{ name: 'old.json', size: 100, text: () => fileText.promise }],
    };
    const fileImport = element('sim-file').onchange({ target: input });
    assert.equal(input.value, '');
    panel.deactivate();
    fileText.resolve('late file content');
    await fileImport;
    assert.deepEqual(requests, []);
    assert.equal(element('sim-message').textContent, '');
    passed('deactivating EV50 panel blocks uncancelable late file.text completion');

    const stale = element('sim-ulog').onclick();
    const latest = element('sim-ulog').onclick();
    assert.equal(fetches[1].options.signal.aborted, true);
    fetches[2].resolve({ ok: true, text: async () => 'new recording' });
    await latest;
    fetches[1].reject(new Error('obsolete failure'));
    await stale;
    assert.deepEqual(requests, [{ operation: 'simulation.replay.load', payload: 'new recording' }]);
    assert.equal(element('sim-message').textContent.includes('obsolete'), false);
    panel.deactivate();
    passed('latest replay import wins and an obsolete failure cannot overwrite success');
  } finally {
    for (const [name, value] of Object.entries(originals)) globalThis[name] = value;
  }
}
