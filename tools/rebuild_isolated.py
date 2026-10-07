"""Prepare or build an independent tree from the locked primitive inputs.

This launcher supplies no geometry and never overwrites the source project.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--parent', required=True, type=Path,
                        help='Existing directory outside this project; its transwing-studio child must not exist')
    parser.add_argument('--run', action='store_true', help='Run Blender and compression after preparation')
    parser.add_argument('--install-deps', action='store_true', help='Run npm ci --prefix scripts in the new tree')
    parser.add_argument('--blender', default='blender')
    parser.add_argument('--node', default='node')
    parser.add_argument('--npm', default='npm.cmd' if os.name == 'nt' else 'npm')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if root.name != 'transwing-studio':
        raise ValueError('The project directory must be named transwing-studio')
    parent = args.parent.resolve(strict=True)
    if parent == root or parent.is_relative_to(root):
        raise ValueError('The independent parent must be outside the source project')
    receipt = parent / 'transwing-preparation.json'
    if receipt.exists():
        raise FileExistsError('Use a new parent directory; preparation receipt already exists')
    sys.path.insert(0, str(root / 'scripts'))
    from constructor_inputs import prepare_independent_tree, verify_locked_inputs
    original_assets = {
        name: sha(root / name) for name in (
            'assets/blender/xp4-source.glb', 'assets/blender/xp4.blend',
            'public/models/xp4.glb', 'public/models/manifest.json')
    }
    prepared = prepare_independent_tree(root, parent, receipt)
    target = Path(prepared['destinationRealpath'])
    guard_relative = Path('tools/guarded-native-entry-recovery.py')
    guard = target / guard_relative
    guard.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(root / guard_relative, guard)
    assert sha(guard) == sha(root / guard_relative)
    temporary = target / 'qa/native-staging/tmp'
    temporary.mkdir()
    env = os.environ.copy()
    env.pop('PYTHONPATH', None)
    env.update(PWD=str(target), TMPDIR=str(temporary),
               PYTHONDONTWRITEBYTECODE='1', TRANSWING_RENDER='0',
               OMP_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1')
    commands = []
    if args.install_deps:
        commands.append([args.npm, 'ci', '--prefix', 'scripts'])
    if args.run:
        commands.extend([
            [args.blender, '-b', '-t', '4', '--python-exit-code', '1',
             '--python', str(guard), '--', '--expected-root', str(target)],
            [args.node, 'scripts/compress-model.mjs'],
        ])
    rows = []
    try:
        for index, command in enumerate(commands):
            log = target / 'qa/native-staging' / f'isolated-command-{index + 1}.log'
            with log.open('xb') as output:
                result = subprocess.run(command, cwd=target, env=env,
                                        stdout=output, stderr=subprocess.STDOUT)
            rows.append({'command': command, 'exitCode': result.returncode,
                         'log': str(log.relative_to(target)), 'logSha256': sha(log)})
            if result.returncode:
                raise subprocess.CalledProcessError(result.returncode, command)
    finally:
        source_unchanged = all(sha(root / name) == digest
                               for name, digest in original_assets.items())
        verify_locked_inputs(root)
        verify_locked_inputs(target)
        result = {
            'schema': 'transwing.isolated-rebuild-execution.v1',
            'sourceRoot': str(root), 'targetRoot': str(target),
            'primitiveInputs': len(prepared['files']),
            'guardSha256': sha(guard), 'commands': rows,
            'sourceAssetsUnchanged': source_unchanged,
            'geometryComparisonPerformed': False,
            'overallAcceptancePassed': False,
        }
        (parent / 'transwing-rebuild.json').write_text(
            json.dumps(result, indent=2) + '\n', encoding='utf-8')
        if not source_unchanged:
            raise RuntimeError('Source project asset identity changed')
    print(target)
    print('Prepared locked inputs' if not args.run else 'Generated independent outputs; compare before adopting them')


if __name__ == '__main__':
    main()
