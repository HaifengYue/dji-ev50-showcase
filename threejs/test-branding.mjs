// Brand migration changes labels and paths, never imported geometry or source evidence.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bytes = (file) => fs.readFileSync(path.join(root, file));
const sha = (file) => createHash('sha256').update(bytes(file)).digest('hex');
const pinned = {
  'models/skytrans/assets/blender/xp4.blend':
    '4bb048190cd9fc5009f2b4090711cae157a4df37cd056b0e32d5a2a77fca07b3',
  'threejs/public/skytrans/models/xp4.glb':
    '380e44e92fa9790e2e7145bded8d15b2bcab3480a147776c8246486f9bb35c4d',
  'models/skytrans/assets/blender/nacelle-system-concept.blend':
    'b4c5273c586ac2a0fcb526e9e039d7705e45f35d431ad031a7d5bf00ec4919f7',
  'threejs/public/skytrans/models/nacelle-system-concept.glb':
    '55f0d778657593e8745ecd0711f5720c3d6f98abb91b9ffab0875eeef8d08996',
};
for (const [file, expected] of Object.entries(pinned)) assert.equal(sha(file), expected, file);

const html = bytes('threejs/index.html').toString();
assert.match(html, /<title>SkyCaptain/);
assert.match(html, /value="skytrans">SkyTrans<\/option>/);
assert.doesNotMatch(html, /transwing/i);
assert.match(bytes('threejs/src/main.ts').toString(), /'跨越山海' : 'Skytrans'/);
assert.match(bytes('threejs/src/main.ts').toString(), /document\.title = `SkyCaptain/);
assert.equal(JSON.parse(bytes('package.json')).name, 'sky-captain');
assert.equal(JSON.parse(bytes('threejs/package.json')).name, 'sky-captain-web');

const recording = JSON.parse(bytes('threejs/public/skytrans/examples/python-full-flow.json'));
assert.equal(recording.protocol, 'transwing.sim.v1');
const manifest = JSON.parse(bytes('threejs/public/skytrans/models/manifest.json'));
assert.equal(manifest.assets['xp4.glb'].sha256, pinned['threejs/public/skytrans/models/xp4.glb']);
assert.deepEqual(
  manifest.animations.map((clip) => clip.name),
  ['TRANSWING_Hover_Cruise_Hover', 'TRANSWING_Motors_Start_Stop'],
);

for (const file of [
  'models/xp4.glb',
  'models/nacelle-system-concept.glb',
  'models/manifest.json',
  'examples/python-full-flow.json',
]) {
  assert.deepEqual(bytes('threejs/dist/skytrans/' + file), bytes('threejs/dist/transwing/' + file));
  assert.deepEqual(
    bytes('threejs/public/skytrans/' + file),
    bytes('threejs/dist/skytrans/' + file),
  );
}
const readme = bytes('README.md').toString();
for (const match of readme.matchAll(/\]\(([^)]+)\)/g)) {
  if (/^(https?:|#)/.test(match[1])) continue;
  assert.ok(
    fs.existsSync(path.join(root, match[1].split('#')[0])),
    `Broken README link: ${match[1]}`,
  );
}
console.log(
  'PASS SkyCaptain/SkyTrans labels, original asset hashes, preserved wire/animation identities, built legacy URL aliases and README links',
);
