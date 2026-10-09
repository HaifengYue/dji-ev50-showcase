// Real Three.js camera/math and disposal logic, with a minimal DOM event target.
// This is intentionally not a browser/WebGL or end-to-end interaction test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';
import { testHangarApi } from './hangar-api.mjs';
import { testHangarState } from './hangar-state.mjs';
import { testHangarCapture } from './hangar-capture.mjs';
import { testHangarSnapshot } from './hangar-snapshot.mjs';

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    count() {
      return [...listeners.values()].reduce((total, values) => total + values.size, 0);
    },
  };
}

function near(actual, expected, tolerance = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}
function nearVector(actual, expected) {
  actual.toArray().forEach((value, index) => near(value, expected.toArray()[index]));
}

export async function testHangarContracts() {
  const temporary = fs.mkdtempSync(path.resolve('.hangar-modules-'));
  const sourceRoot = path.resolve('src');
  const compiled = new Map();
  function compile(relative) {
    const source = path.resolve(sourceRoot, relative);
    if (compiled.has(source)) return compiled.get(source);
    const output = path.join(temporary, path.relative(sourceRoot, source)).replace(/\.ts$/, '.mjs');
    compiled.set(source, output);
    let javascript = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText;
    javascript = javascript.replace(
      /(from\s+|import\s*\()(['"])(\.[^'"]+)\2/g,
      (match, prefix, quote, specifier) => {
        const dependency =
          path.resolve(path.dirname(source), specifier.replace(/\.js$/, '')) + '.ts';
        assert.ok(fs.existsSync(dependency), `Missing test dependency: ${dependency}`);
        const target = compile(path.relative(sourceRoot, dependency));
        const rewritten = path.relative(path.dirname(output), target).split(path.sep).join('/');
        return `${prefix}${quote}${rewritten.startsWith('.') ? rewritten : `./${rewritten}`}${quote}`;
      },
    );
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, javascript);
    return output;
  }
  async function load(relative) {
    return import(pathToFileURL(compile(relative)).href);
  }
  let count = 0;
  function passed(name) {
    count++;
    console.log(`PASS hangar contract: ${name}`);
  }
  const originalWindow = globalThis.window;
  try {
    const { AIRCRAFT, aircraftFromUrl, aircraftDescriptor, isAircraftId } =
      await load('aircraft/registry.ts');
    assert.deepEqual(
      AIRCRAFT.map((entry) => entry.id),
      ['ev50', 'skytrans'],
    );
    assert.equal(new Set(AIRCRAFT.map((entry) => entry.id)).size, AIRCRAFT.length);
    for (const id of ['ev50', 'skytrans']) {
      assert.equal(isAircraftId(id), true);
      assert.equal(aircraftFromUrl(new URL(`https://example.test/hangar/?aircraft=${id}`)), id);
      assert.equal(aircraftDescriptor(id).id, id);
    }
    for (const value of [null, '', 'EV50', 'unknown', '__proto__', 2])
      assert.equal(isAircraftId(value), false);
    assert.equal(aircraftFromUrl(new URL('https://example.test/hangar/')), 'ev50');
    assert.equal(aircraftFromUrl(new URL('https://example.test/hangar/?aircraft=unknown')), 'ev50');
    assert.equal(
      aircraftFromUrl(new URL('https://example.test/hangar/?aircraft=transwing')),
      'skytrans',
    );
    assert.equal(isAircraftId('transwing'), false);
    assert.ok(!aircraftDescriptor('skytrans').capabilities.includes('ev50-telemetry'));
    assert.ok(aircraftDescriptor('ev50').capabilities.includes('ev50-telemetry'));
    passed('registry has stable IDs, validated URL fallback, isolated capabilities');

    const { disposeObjectTree } = await load('aircraft/resources.ts');
    const { OwnedResources } = await load('aircraft/skytrans/resources.ts');
    function resourceTree() {
      const geometry = new THREE.BoxGeometry();
      const texture = new THREE.Texture();
      const material = new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture });
      const material2 = new THREE.MeshBasicMaterial({ map: texture });
      const root = new THREE.Group();
      root.add(new THREE.Mesh(geometry, [material, material2]), new THREE.Mesh(geometry, material));
      const disposals = { geometry: 0, texture: 0, material: 0, material2: 0 };
      for (const [name, resource] of Object.entries({ geometry, texture, material, material2 }))
        resource.addEventListener('dispose', () => disposals[name]++);
      return { root, disposals };
    }
    const tree = resourceTree(),
      parent = new THREE.Group();
    parent.add(tree.root);
    disposeObjectTree(tree.root);
    disposeObjectTree(tree.root);
    assert.deepEqual(tree.disposals, { geometry: 1, texture: 1, material: 1, material2: 1 });
    assert.equal(tree.root.parent, null);
    assert.equal(tree.root.children.length, 0);
    passed('EV50 object cleanup deduplicates geometry/material/texture and detaches root');

    const skytransTree = resourceTree(),
      otherTree = resourceTree();
    const owner = new OwnedResources(),
      otherOwner = new OwnedResources();
    owner.capture(skytransTree.root);
    owner.capture(skytransTree.root);
    otherOwner.capture(otherTree.root);
    owner.dispose();
    owner.dispose();
    assert.deepEqual(skytransTree.disposals, {
      geometry: 1,
      texture: 1,
      material: 1,
      material2: 1,
    });
    assert.deepEqual(otherTree.disposals, { geometry: 0, texture: 0, material: 0, material2: 0 });
    assert.throws(() => owner.capture(skytransTree.root), /already disposed/);
    otherOwner.dispose();
    passed('SkyTrans resource owners deduplicate disposal without touching another aircraft');

    const abandonedTexture = new THREE.Texture();
    const abandonedMaterial = new THREE.MeshBasicMaterial({ map: abandonedTexture });
    let extraTextureDisposals = 0,
      extraMaterialDisposals = 0;
    abandonedTexture.addEventListener('dispose', () => extraTextureDisposals++);
    abandonedMaterial.addEventListener('dispose', () => extraMaterialDisposals++);
    disposeObjectTree(new THREE.Group(), [abandonedMaterial, abandonedMaterial]);
    assert.equal(extraMaterialDisposals, 1);
    assert.equal(extraTextureDisposals, 1);
    passed(
      'replaced original materials release owned textures even when absent from the final tree',
    );

    await testHangarApi({ load, passed });
    await testHangarState({ load, passed });
    await testHangarCapture({ load, passed });
    await testHangarSnapshot({ load, passed });

    const guideOnly = await load('aircraft/skytrans/presentation.ts');
    assert.equal(guideOnly.SkyTransPresentation, undefined);
    assert.equal(typeof guideOnly.createJointGuide, 'function');
    const presentationSource = fs.readFileSync('src/aircraft/skytrans/presentation.ts', 'utf8');
    assert.ok(
      !/PMREMGenerator|GridHelper|DirectionalLight|toneMappingExposure|scene\.background|scene\.environment/.test(
        presentationSource,
      ),
    );
    passed(
      'SkyTrans presentation contains only rig guides and cannot replace the shared environment',
    );

    const { SkyTransCamera } = await load('aircraft/skytrans/camera.ts');
    const { getPresentationFrame, getInspectionFrame } = await load(
      'aircraft/skytrans/core/inspection.ts',
    );
    const rootEvents = eventTarget();
    const canvas = {
      ...eventTarget(),
      style: {},
      clientWidth: 1200,
      clientHeight: 800,
      getRootNode: () => rootEvents,
    };
    const cameras = [];
    let reducedMotion = false;
    globalThis.window = { matchMedia: () => ({ matches: reducedMotion }) };
    const host = { canvas, scene: new THREE.Scene(), setCamera: (value) => cameras.push(value) };
    host.scene.fog = new THREE.Fog(0xffffff, 30, 78);
    const camera = new SkyTransCamera(host);
    const bounds = new THREE.Box3(new THREE.Vector3(-3, -1, -2), new THREE.Vector3(3, 1, 2));
    const presentation = getPresentationFrame(bounds, camera.aspect);
    camera.frame(presentation, false, true);
    nearVector(camera.active.position, presentation.position);
    nearVector(camera.target, presentation.target);
    assert.equal(camera.active.type, 'PerspectiveCamera');
    assert.equal(camera.describe().transitioning, false);
    assert.equal(canvas.count(), 4);
    assert.equal(rootEvents.count(), 1);
    passed('native perspective framing uses host camera and one OrbitControls listener set');

    const top = getInspectionFrame(bounds, 'top', camera.aspect);
    const side = getInspectionFrame(bounds, 'side', camera.aspect);
    camera.frame(top, true);
    assert.equal(camera.describe().transitioning, true);
    camera.update(0.35, null);
    camera.frame(side, true);
    camera.update(1.1, null);
    nearVector(camera.active.position, side.position);
    nearVector(camera.target, side.target);
    assert.equal(camera.describe().transitioning, false);
    assert.equal(camera.active.type, 'OrthographicCamera');
    assert.equal(canvas.count(), 4);
    assert.equal(rootEvents.count(), 1);
    passed(
      'interrupted camera transition ends on latest orthographic view without listener growth',
    );

    const oldPosition = camera.active.position.clone();
    const oldQuaternion = camera.active.quaternion.clone();
    const oldTarget = camera.target.clone();
    const oldHeight = camera.active.top - camera.active.bottom;
    camera.active.zoom = 2.5;
    canvas.clientWidth = 400;
    canvas.clientHeight = 900;
    camera.resize();
    nearVector(camera.active.position, oldPosition);
    near(camera.active.quaternion.angleTo(oldQuaternion), 0);
    nearVector(camera.target, oldTarget);
    near(camera.active.zoom, 2.5);
    near(camera.active.top - camera.active.bottom, oldHeight);
    near((camera.active.right - camera.active.left) / oldHeight, 400 / 900);
    passed(
      'portrait resize preserves camera target/orientation/zoom and updates orthographic aspect',
    );

    const movingFrame = getPresentationFrame(bounds, camera.aspect);
    camera.frame(movingFrame, false, false, new THREE.Vector3());
    camera.update(0.5, [20, 0, 0]);
    camera.update(0.6, [30, 0, 0]);
    nearVector(camera.target, movingFrame.target);
    passed('free camera transition ignores world motion instead of silently enabling follow');

    reducedMotion = true;
    camera.frame(presentation, false);
    assert.equal(camera.describe().transitioning, false);
    assert.equal(camera.active.type, 'PerspectiveCamera');
    nearVector(camera.active.position, presentation.position);
    camera.resetExternalAnchor([0, 0, 0]);
    camera.update(0, [20, 3, -5]);
    nearVector(camera.target, presentation.target);
    passed('reduced-motion framing is immediate and free camera remains world-fixed');

    const preservedFog = [host.scene.fog.near, host.scene.fog.far];
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.8, -0.1));
    camera.setFlightView('follow', new THREE.Vector3(100, 160, -200), quaternion);
    camera.update(1.1, [100, 160, -200], quaternion);
    const followed = camera.active.position.clone();
    camera.update(0.016, [120, 163, -210], quaternion);
    nearVector(camera.active.position.clone().sub(followed), new THREE.Vector3(20, 3, -10));
    assert.equal(camera.describe().view, 'follow');
    assert.deepEqual([host.scene.fog.near, host.scene.fog.far], preservedFog);
    assert.equal(camera.active.far, 9000);
    camera.frame(presentation, false, true);
    const freePosition = camera.active.position.clone(),
      freeQuaternion = camera.active.quaternion.clone();
    for (let index = 0; index < 120; index++)
      camera.update(1 / 60, [1000 + index, 180, -2000], quaternion);
    nearVector(camera.active.position, freePosition);
    near(camera.active.quaternion.angleTo(freeQuaternion), 0);
    passed(
      'explicit flight follow tracks the rig; free camera and shared scene fog stay unchanged thereafter',
    );

    const beforeDispose = camera.describe();
    const cameraChanges = cameras.length;
    camera.dispose();
    camera.dispose();
    camera.update(2, [1000, 1000, 1000]);
    camera.frame(top, true);
    assert.deepEqual(camera.describe(), beforeDispose);
    assert.equal(cameras.length, cameraChanges);
    assert.equal(canvas.count(), 0);
    assert.equal(rootEvents.count(), 0);
    passed('camera teardown removes all canvas/root listeners and ignores late updates');
    return count;
  } finally {
    globalThis.window = originalWindow;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
