// Capture ownership tests with synthetic canvas/encoder callbacks. No image/video encoding.
import assert from 'node:assert/strict';
import * as THREE from 'three';

function eventTarget() {
  return { addEventListener() {}, removeEventListener() {} };
}
function classList() {
  const values = new Set();
  return {
    add: (value) => values.add(value),
    remove: (value) => values.delete(value),
    contains: (value) => values.has(value),
    toggle(value, force = !values.has(value)) {
      if (force) values.add(value);
      else values.delete(value);
      return force;
    },
  };
}

export async function testHangarCapture({ load, passed }) {
  const originals = {
    document: globalThis.document,
    window: globalThis.window,
    MediaRecorder: globalThis.MediaRecorder,
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };
  const elements = new Map();
  const downloads = [],
    captures = [],
    recorders = [];
  let aircraftName = 'EV50',
    stoppedTracks = 0;
  const element = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        value: '',
        checked: false,
        disabled: false,
        hidden: false,
        textContent: '',
        attrs: {},
        setAttribute(key, value) {
          this.attrs[key] = value;
        },
        getClientRects: () => [{}],
        focus() {},
        click() {},
      });
    return elements.get(id);
  };
  globalThis.document = {
    ...eventTarget(),
    hidden: false,
    body: { classList: classList() },
    getElementById: element,
  };
  globalThis.window = { ...eventTarget(), setTimeout: () => 1, clearTimeout() {} };
  URL.createObjectURL = (blob) => {
    downloads.push(blob);
    return `blob:synthetic-${downloads.length}`;
  };
  URL.revokeObjectURL = () => {};
  globalThis.MediaRecorder = class {
    static isTypeSupported(type) {
      return type === 'video/webm';
    }
    constructor(stream, options) {
      this.mimeType = options.mimeType;
      this.state = 'inactive';
      recorders.push(this);
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
    }
  };
  const canvas = {
    ...eventTarget(),
    width: 800,
    height: 600,
    toBlob: (callback) => captures.push(callback),
    captureStream: () => ({
      getTracks: () => [
        {
          stop() {
            stoppedTracks++;
          },
        },
      ],
    }),
  };
  try {
    const { presentation } = await load('presentation.ts');
    const ui = presentation({
      canvas,
      camera: new THREE.PerspectiveCamera(42, 4 / 3),
      controls: { ...eventTarget(), target: new THREE.Vector3(), update() {} },
      scene: new THREE.Scene(),
      sun: new THREE.DirectionalLight(),
      hemisphere: new THREE.HemisphereLight(),
      setSky() {},
      showProduct() {},
      aircraftName: () => aircraftName,
    });
    ui.setReady();
    element('save-image').onclick();
    ui.afterRender();
    assert.equal(captures.length, 1);
    ui.suspend();
    aircraftName = 'TRANSWING P4';
    ui.setReady();
    element('capture-status').textContent = 'Current Transwing status';
    captures.shift()(new Blob(['old synthetic PNG'], { type: 'image/png' }));
    assert.equal(
      downloads.length,
      0,
      'old PNG callback must not publish into another aircraft selection',
    );
    assert.equal(element('capture-status').textContent, 'Current Transwing status');
    passed('late screenshot callback cannot publish or overwrite status after an aircraft switch');

    element('save-image').onclick();
    ui.afterRender();
    captures.shift()(new Blob(['current synthetic PNG'], { type: 'image/png' }));
    assert.equal(downloads.length, 1);
    assert.ok(element('capture-download').download.startsWith('TRANSWING P4_'));
    passed('new selection can immediately save its own correctly labeled screenshot');

    element('record-video').onclick();
    assert.equal(recorders.length, 1);
    assert.equal(recorders[0].state, 'recording');
    recorders[0].ondataavailable({ data: new Blob(['synthetic recording']) });
    ui.suspend();
    aircraftName = 'EV50';
    ui.setReady();
    element('capture-status').textContent = 'Current EV50 status';
    recorders[0].onstop();
    assert.equal(
      downloads.length,
      1,
      'switch-canceled video must not publish into another selection',
    );
    assert.equal(element('capture-status').textContent, 'Current EV50 status');
    assert.equal(stoppedTracks, 1);
    assert.equal(document.body.classList.contains('recording'), false);
    assert.equal(element('record-video').disabled, false);
    element('record-video').onclick();
    recorders[1].ondataavailable({ data: new Blob(['new synthetic recording']) });
    element('record-video').onclick();
    recorders[1].onstop();
    assert.equal(downloads.length, 2);
    assert.ok(element('capture-download').download.startsWith('EV50_'));
    assert.equal(stoppedTracks, 2);
    passed(
      'switch-canceled recording cannot publish or overwrite status and releases stream tracks',
    );
  } finally {
    globalThis.document = originals.document;
    globalThis.window = originals.window;
    globalThis.MediaRecorder = originals.MediaRecorder;
    URL.createObjectURL = originals.createObjectURL;
    URL.revokeObjectURL = originals.revokeObjectURL;
  }
}
