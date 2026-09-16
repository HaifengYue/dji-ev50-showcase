// Logic tests with DOM/encoder doubles. These do not validate browser rendering
// or produce actual PNG/video files; real browser acceptance is separate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as T from 'three';

const temporary = '.presentation-test-tmp.mjs';
const passed = [];
const original = {
  document: globalThis.document,
  window: globalThis.window,
  MediaRecorder: globalThis.MediaRecorder,
  createObjectURL: URL.createObjectURL,
  revokeObjectURL: URL.revokeObjectURL,
};
fs.writeFileSync(
  temporary,
  ts.transpileModule(fs.readFileSync('src/presentation.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText,
);

function classes() {
  const values = new Set();
  return {
    add: (v) => values.add(v),
    remove: (v) => values.delete(v),
    contains: (v) => values.has(v),
    toggle(v, force = !values.has(v)) {
      if (force) values.add(v);
      else values.delete(v);
      return force;
    },
  };
}
function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(listener);
    },
    emit(name, event = {}) {
      for (const listener of listeners.get(name) ?? []) listener(event);
    },
  };
}
function harness() {
  const downloads = [],
    revoked = [],
    streams = [],
    timers = new Map();
  let timerId = 0;
  const elements = new Map();
  const ids = [
    'product-view',
    'auto-orbit',
    'lighting',
    'save-image',
    'record-video',
    'immersive',
    'exit-immersive',
    'stop-recording',
    'tools-toggle',
    'capture-status',
    'capture-download',
  ];
  for (const id of ids)
    elements.set(id, {
      value: id === 'product-view' ? 'hero' : 'daylight',
      checked: false,
      disabled: false,
      textContent: '',
      hidden: id === 'capture-download',
      attrs: {},
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      focus() {},
      getClientRects: () => [{}],
      click() {
        if (!this.disabled) this.onclick?.();
      },
    });
  globalThis.document = {
    ...eventTarget(),
    hidden: false,
    body: { classList: classes() },
    getElementById: (id) => elements.get(id),
  };
  globalThis.window = {
    ...eventTarget(),
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  URL.createObjectURL = (blob) => {
    downloads.push(blob);
    return `blob:logic-test-${downloads.length}`;
  };
  URL.revokeObjectURL = (url) => revoked.push(url);
  let snapshotCalls = 0;
  const canvas = {
    ...eventTarget(),
    width: 1440,
    height: 1000,
    toBlob(callback) {
      snapshotCalls++;
      callback(new Blob(['synthetic PNG payload'], { type: 'image/png' }));
    },
    captureStream(fps) {
      assert.equal(fps, 30);
      const track = {
        stopped: false,
        stop() {
          this.stopped = true;
        },
      };
      const stream = { getTracks: () => [track] };
      streams.push(stream);
      return stream;
    },
  };
  class Recorder {
    static isTypeSupported(type) {
      return type === 'video/webm;codecs=vp8';
    }
    constructor(stream, options) {
      this.stream = stream;
      this.mimeType = options.mimeType;
      this.state = 'inactive';
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({
          data: new Blob(['synthetic encoder payload'], { type: this.mimeType }),
        });
        this.onstop?.();
      });
    }
  }
  globalThis.MediaRecorder = Recorder;
  const controls = {
    ...eventTarget(),
    target: new T.Vector3(0, 0.65, 0),
    enableDamping: true,
    update() {},
  };
  const options = {
    canvas,
    controls,
    camera: new T.PerspectiveCamera(42, 1.44, 0.1, 5000),
    scene: new T.Scene(),
    sun: new T.DirectionalLight(),
    hemisphere: new T.HemisphereLight(),
    setSky(golden) {
      options.golden = golden;
    },
    showProduct() {
      options.productSelections++;
    },
    productSelections: 0,
  };
  options.scene.fog = new T.Fog(0, 650, 3200);
  options.scene.background = new T.Color(0);
  return {
    options,
    elements,
    downloads,
    revoked,
    streams,
    timers,
    get snapshotCalls() {
      return snapshotCalls;
    },
  };
}

try {
  const { presentation } = await import(`./${temporary}`);
  const h = harness(),
    ui = presentation(h.options),
    el = (id) => h.elements.get(id);
  ui.setReady();
  assert.equal(el('record-video').disabled, false);
  el('product-view').value = 'top';
  el('product-view').onchange();
  assert.deepEqual(h.options.camera.position.toArray(), [0, 13, 0.001]);
  assert.equal(h.options.productSelections, 1);
  assert.equal(h.options.controls.autoRotate, false);
  const distance = h.options.camera.position.distanceTo(h.options.controls.target);
  h.options.camera.aspect = 0.5;
  ui.resizeProductView();
  assert.ok(
    Math.abs(h.options.camera.position.distanceTo(h.options.controls.target) / distance - 2.1) <
      1e-9,
  );
  passed.push('Product preset and aspect fitting');

  el('auto-orbit').checked = true;
  el('auto-orbit').onchange();
  ui.update('product', true);
  assert.equal(h.options.controls.autoRotate, true);
  const cameraBefore = h.options.camera.position.toArray();
  el('lighting').value = 'golden';
  ui.update('flight', true);
  assert.equal(h.options.controls.autoRotate, false);
  assert.equal(h.options.golden, true);
  assert.deepEqual(h.options.camera.position.toArray(), cameraBefore);
  h.options.scene.fog = new T.Fog(0, 650, 3200);
  ui.update('flight', true);
  assert.equal(h.options.scene.fog.color.getHex(), 0xd3baa2);
  ui.update('product', true);
  assert.equal(h.options.golden, false);
  h.options.controls.emit('start');
  assert.equal(el('auto-orbit').checked, false);
  passed.push('Orbit gating, manual drag cancellation, and lighting isolation');

  el('save-image').onclick();
  assert.equal(h.snapshotCalls, 0);
  assert.equal(el('save-image').disabled, true);
  ui.afterRender();
  assert.equal(h.snapshotCalls, 1);
  assert.equal(h.downloads[0].type, 'image/png');
  assert.equal(el('save-image').disabled, false);
  passed.push('PNG request waits for completed render');

  el('record-video').onclick();
  assert.equal(ui.getState().recording, 'recording');
  assert.equal(h.timers.size, 1);
  document.hidden = true;
  document.emit('visibilitychange');
  await Promise.resolve();
  assert.equal(ui.getState().recording, 'inactive');
  assert.equal(h.timers.size, 0);
  assert.ok(h.streams[0].getTracks().every((t) => t.stopped));
  assert.ok(el('capture-status').textContent.includes('后台'));
  assert.ok(el('capture-download').download.endsWith('.webm'));
  assert.equal(el('record-video').disabled, false);
  passed.push('Recording MIME fallback, visibility stop, download and stream cleanup');

  document.hidden = false;
  el('record-video').onclick();
  const timer = [...h.timers.values()][0];
  assert.equal(timer.delay, 200_000);
  timer.callback();
  await Promise.resolve();
  assert.ok(el('capture-status').textContent.includes('200 秒'));
  assert.equal(h.timers.size, 0);
  assert.ok(h.streams[1].getTracks().every((t) => t.stopped));
  el('record-video').onclick();
  el('stop-recording').onclick();
  await Promise.resolve();
  assert.equal(ui.getState().recording, 'inactive');
  assert.equal(h.timers.size, 0);
  passed.push('Recording limit and immersive stop control');

  el('tools-toggle').onclick();
  el('immersive').onclick();
  assert.equal(document.body.classList.contains('immersive'), true);
  document.emit('keydown', { key: 'Escape' });
  assert.equal(document.body.classList.contains('immersive'), false);
  assert.equal(document.body.classList.contains('tools-open'), false);
  assert.equal(el('immersive').attrs['aria-pressed'], 'false');
  window.emit('pagehide');
  assert.equal(h.revoked.length, h.downloads.length);
  passed.push('Escape exits immersion and closes mobile tools; URLs released');

  const unavailable = harness();
  globalThis.MediaRecorder = undefined;
  const fallback = presentation(unavailable.options);
  fallback.setReady();
  assert.equal(unavailable.elements.get('record-video').disabled, true);
  assert.ok(unavailable.elements.get('capture-status').textContent.includes('不支持'));
  passed.push('Unsupported browser disables recording after model ready');

  if (process.env.WRITE_VALIDATION_REPORTS) {
    fs.writeFileSync(
      '../docs/presentation_tests.json',
      JSON.stringify(
        {
          version: 'v09',
          passed,
          browser: false,
          scope:
            'Presentation logic with DOM and encoder test doubles; no real rendering or encoding verified.',
        },
        null,
        2,
      ) + '\n',
    );
  }
  console.log('PASS presentation logic:', passed.length, 'groups');
} finally {
  fs.rmSync(temporary, { force: true });
  for (const key of ['document', 'window', 'MediaRecorder']) {
    if (original[key] === undefined) delete globalThis[key];
    else globalThis[key] = original[key];
  }
  URL.createObjectURL = original.createObjectURL;
  URL.revokeObjectURL = original.revokeObjectURL;
}
