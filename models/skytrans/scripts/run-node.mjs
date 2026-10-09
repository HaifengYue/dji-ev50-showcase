/** Resolve tsx from this pipeline's locked package, without a global install. */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(
  process.execPath,
  ['--import', pathToFileURL(require.resolve('tsx')).href, ...process.argv.slice(2)],
  { cwd: root, env: process.env, stdio: 'inherit' },
);
if (result.error) throw result.error;
if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exitCode = result.status ?? 1;
}
