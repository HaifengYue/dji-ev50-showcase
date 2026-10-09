/** Re-run published mechanics tests against the host's current core and Three.js.
 * Only the camera event harness adapts the former three-stdlib API to native
 * OrbitControls. Assertions, model bytes and mechanical tolerances are unchanged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const host = path.resolve(root, '../../threejs');
const require = createRequire(path.join(host, 'package.json'));
const ts = require('typescript');
const temporary = fs.mkdtempSync(path.join(host, '.skytrans-native-check-'));
const tests = fs.readdirSync(path.join(root, 'qa/core')).filter(name => name.endsWith('.test.ts')).sort();
if (tests.length !== 16) throw new Error(`Expected all 16 preserved core test files; got ${tests.length}`);
function compile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(
    /(from\s+|import\s*\()(['"])(\.[^'"]+)\2/g,
    (_match, prefix, quote, specifier) => `${prefix}${quote}${specifier.replace(/\.(?:ts|mts|mjs|js)$/, '')}.mjs${quote}`,
  ).replace('from "three-stdlib"', 'from "three/addons/controls/OrbitControls.js"');
}
function cameraHarness(source) {
  return source
    .replace('new OrbitControls(camera)', 'new OrbitControls(camera, new ControlSurface() as unknown as HTMLElement)')
    .replaceAll('controls.dollyIn(1e-6);', 'controls._dollyIn(1e-6); controls.update();')
    .replaceAll('controls.dollyOut(1e-6);', 'controls._dollyOut(1e-6); controls.update();')
    .replaceAll('controls.connect(surface as unknown as HTMLElement);', 'controls.disconnect(); controls.domElement = surface as unknown as HTMLElement; controls.connect();')
    .replaceAll('dispatch(surface.ownerDocument,', 'dispatch(surface,')
    .replace('  releasePointerCapture() {}', '  getRootNode() { return this.ownerDocument; }\n  setPointerCapture() {}\n  releasePointerCapture() {}');
}
try {
  fs.mkdirSync(path.join(temporary, 'src'), { recursive: true });
  fs.mkdirSync(path.join(temporary, 'qa/lib'), { recursive: true });
  for (const name of fs.readdirSync(path.join(host, 'src/aircraft/skytrans/core'))) {
    if (!name.endsWith('.ts')) continue;
    fs.writeFileSync(path.join(temporary, 'src', name.replace(/\.ts$/, '.mjs')),
      compile(fs.readFileSync(path.join(host, 'src/aircraft/skytrans/core', name), 'utf8')));
  }
  for (const name of tests) {
    let source = fs.readFileSync(path.join(root, 'qa/core', name), 'utf8');
    if (name === 'cameraNavigation.test.ts') source = cameraHarness(source);
    fs.writeFileSync(path.join(temporary, 'src', name.replace(/\.ts$/, '.mjs')), compile(source));
  }
  for (const name of fs.readdirSync(path.join(root, 'qa/core/lib'))) {
    fs.writeFileSync(path.join(temporary, 'qa/lib', name.replace(/\.(mts|ts)$/, '.mjs')),
      compile(fs.readFileSync(path.join(root, 'qa/core/lib', name), 'utf8')));
  }
  for (const [name, source] of [
    ['public', path.join(host, 'public/skytrans')],
    ['scripts', path.join(root, 'scripts')],
    ['assets', path.join(root, 'assets')],
    ['examples', path.join(root, 'examples')],
  ]) fs.symlinkSync(source, path.join(temporary, name), 'dir');
  fs.mkdirSync(path.join(temporary, 'qa/fixtures'));
  fs.copyFileSync(path.join(root, 'qa/fixtures/mechanical-contract.json'), path.join(temporary, 'qa/fixtures/mechanical-contract.json'));
  const result = spawnSync(process.execPath, ['--test', ...tests.map(name => path.join(temporary, 'src', name.replace(/\.ts$/, '.mjs')))], {
    cwd: temporary, stdio: 'inherit', env: { ...process.env, QA_MODEL: path.join(host, 'public/skytrans/models/xp4.glb'), QA_MANIFEST: path.join(host, 'public/skytrans/models/manifest.json') }, timeout: 180000,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
