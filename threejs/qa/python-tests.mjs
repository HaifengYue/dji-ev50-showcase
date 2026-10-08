// Portable wrapper: keep the package path local to the child Python process.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const pythonRoot = path.join(root, 'models/transwing/python');
const result = spawnSync(
  process.platform === 'win32' ? 'python' : 'python3',
  ['-m', 'unittest', 'discover', '-s', path.join(pythonRoot, 'tests'), '-v'],
  {
    cwd: root,
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONPATH: [pythonRoot, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    },
    stdio: 'inherit',
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
