import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Load the real exported hierarchy and geometry without browser-only image decoding.
globalThis.ProgressEvent ??= class ProgressEvent {};
const bytes = fs.readFileSync('public/ev50.glb');
const jsonLength = bytes.readUInt32LE(12);
const data = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
const binOffset = 20 + jsonLength;
data.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(binOffset + 8).toString('base64')}`;
delete data.images;
delete data.textures;
delete data.samplers;
data.materials = data.materials.map(() => ({}));
const gltf = await new GLTFLoader().parseAsync(JSON.stringify(data), '');
const aircraft = gltf.scene;
aircraft.updateMatrixWorld(true);
const names = ['Gear_Main_Left', 'Gear_Main_Right', 'Gear_Tail'];
const wheels = names.map((name) => aircraft.getObjectByName(name));
for (const wheel of wheels) {
  assert.ok(wheel);
  assert.equal(wheel.userData.part, 'landing_wheel');
  const tyre = aircraft.getObjectByName(`${wheel.name}_Tyre`);
  assert.ok(Math.abs(new T.Box3().setFromObject(tyre).min.y) < 0.001, 'Tyre must touch ground');
}
assert.ok(wheels[2].getWorldPosition(new T.Vector3()).z < 0, 'Tail wheel is aft');
assert.ok(wheels.slice(0, 2).every((wheel) => wheel.getWorldPosition(new T.Vector3()).z > 0));
aircraft.traverse((object) =>
  assert.ok(!/^Gear_(Front|Rear)_/.test(object.name), 'No legacy gear'),
);
const temporary = ['.airframe-rig-test.mjs', '.airframe-telemetry-test.mjs'];
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
try {
  fs.writeFileSync(temporary[1], compile(fs.readFileSync('src/simulation/telemetry.ts', 'utf8')));
  fs.writeFileSync(
    temporary[0],
    compile(fs.readFileSync('src/simulation/aircraft-rig.ts', 'utf8')).replace(
      "'./telemetry'",
      "'./.airframe-telemetry-test.mjs'",
    ),
  );
  const { aircraftRig } = await import(`./${temporary[0]}`);
  const rig = aircraftRig(aircraft);
  assert.equal(rig.describe().landingGear.length, 3);
  assert.ok(rig.describe().rotors.every((rotor) => rotor.present));
  aircraft.traverse((object) =>
    assert.ok(!object.name.endsWith('_VisualWheel'), 'Do not duplicate authored wheels'),
  );
  rig.update({ aileron: 0, elevator: 0, rudder: 0 }, 0, true);
  console.log(
    'Airframe: exported three-point contacts, hierarchy, rotors and runtime integration passed.',
  );
} finally {
  for (const path of temporary) if (fs.existsSync(path)) fs.unlinkSync(path);
}
