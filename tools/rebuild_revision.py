"""在全新目录重建V25；不读取当前最终Blend/GLB，不覆盖既有工程。

本入口完成输入核验和dry-run；整条新目录执行尚未作为V25交付证据。
"""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys

SOURCE = Path(__file__).resolve().parents[1]


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True,
                        help='新工程父目录，其下transwing-studio必须不存在')
    parser.add_argument('--run', action='store_true')
    parser.add_argument('--install-deps', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--blender', default='blender')
    args = parser.parse_args()
    target = args.output.resolve() / 'transwing-studio'
    if target.exists() or target == SOURCE or SOURCE in target.parents:
        raise SystemExit('拒绝覆盖既有工程或在源工程内部构造')

    manifest = json.loads((SOURCE / 'REVISION_CONSTRUCTION_INPUTS.json').read_text())
    if manifest['schema'] != 'transwing.revision-construction-inputs.v1':
        raise SystemExit('修订输入清单类型不符')
    sys.path.insert(0, str(SOURCE / 'scripts'))
    from constructor_inputs import verify_locked_inputs
    baseline = verify_locked_inputs(SOURCE)
    if baseline['inputLockSHA256'] != manifest['baselineConstructionLock']['sha256']:
        raise SystemExit('旧82项输入锁身份不符')
    forbidden = {
        'assets/blender/xp4.blend', 'assets/blender/xp4-source.glb',
        'public/models/xp4.glb', 'public/models/manifest.json',
        'assets/model-validation.json',
    }
    seen = set()
    for row in manifest['files']:
        relative = PurePosixPath(row['path'])
        if (relative.is_absolute() or '..' in relative.parts or '\\' in row['path']
                or row['path'] in seen or row['path'] in forbidden
                or row['path'].startswith('qa/revision-20261007/baked-candidate/')):
            raise SystemExit('非法或重复构造输入：' + row['path'])
        path = SOURCE / relative
        if (not path.is_file() or path.is_symlink()
                or not path.resolve().is_relative_to(SOURCE)
                or path.stat().st_size != row['bytes'] or digest(path) != row['sha256']):
            raise SystemExit('构造输入身份不符：' + row['path'])
        seen.add(row['path'])

    steps = [
        [args.blender, '-b', '-t', '4', '--python-exit-code', '1', '--python',
         'scripts/revision_20261007/rebuild_geometry.py'],
        [args.blender, '-b', '-t', '4', '--python-exit-code', '1', '--python',
         'scripts/revision_20261007/verify_geometry_rebuild.py'],
        [args.blender, '-b', '-t', '4', '--python-exit-code', '1', '--python',
         'scripts/revision_20261007/bake_candidate.py'],
        ['node', 'scripts/revision_20261007/compress-model-revision.mjs'],
        ['node', 'scripts/revision_20261007/verify_source_runtime.mjs'],
        [sys.executable, 'scripts/revision_20261007/write_revision_manifest.py'],
    ]
    mechanism_destinations = [
        'assets/blender/annotated-mechanism.json',
        'assets/build/annotated-mechanism.json',
        'public/models/annotated-mechanism.json',
    ]
    if args.dry_run:
        print(json.dumps({
            'passed': True, 'target': str(target), 'verifiedInputs': len(seen),
            'baselineVerifiedInputs': baseline['verifiedInputFiles'], 'steps': steps,
            'regeneratedMechanismSource': 'new source GLB extras.annotatedMechanism',
            'regeneratedMechanismDestinations': mechanism_destinations,
            'currentFinalModelIsNotAnInput': True,
            'referenceRole': 'identity comparison only, never geometry construction',
            'fullFreshDirectoryRunPerformed': False,
            'dryRunWritesTarget': False,
        }, ensure_ascii=False, indent=2))
        return

    target.mkdir(parents=True)
    files = set(seen)
    for name in ['src', 'python', 'examples', 'docs', 'qa/lib']:
        for file in (SOURCE / name).rglob('*'):
            if file.is_file() and '__pycache__' not in file.parts:
                files.add(str(file.relative_to(SOURCE)))
    files.update([
        'index.html', 'vite.config.ts', 'tsconfig.json', 'README.md',
        'THIRD_PARTY_NOTICES.txt', 'AUDIT_ARCHIVE.json',
        'qa/glb-loader-check.mjs', 'qa/flight-regression.test.ts',
        'REVISION_CONSTRUCTION_INPUTS.json',
    ])
    for relative in sorted(files):
        file = SOURCE / relative
        if file.is_file():
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, destination)
    if not args.run:
        print('输入已准备：' + str(target))
        return

    env = dict(os.environ, TRANSWING_REVISION_LABEL='candidate-regenerated',
               PYTHONDONTWRITEBYTECODE='1')
    env.pop('TRANSWING_CREATE_REFERENCE', None)

    def run(command):
        subprocess.run(command, cwd=target, env=env, check=True)

    if args.install_deps:
        run(['npm', 'ci'])
        run(['npm', 'ci', '--prefix', 'scripts'])
    for command in steps[:3]:
        run(command)
    stage = target / 'qa/revision-20261007/baked-candidate'
    shutil.copy2(target / 'assets/baseline-20261007/manifest.json',
                 stage / 'model-manifest.json')
    # Regenerate from the new GLB, never copy old or current-final sidecars.
    # This authoring contract already uses Blender coordinates; do not convert.
    data = (stage / 'xp4-source.glb').read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    contract = json.loads(data[20:20 + size])['extras']['annotatedMechanism']
    if contract.get('schema') != 'transwing.annotated-mechanism.final.v1':
        raise ValueError('再生GLB缺少有效机构契约')
    mechanism = stage / 'annotated-mechanism.json'
    mechanism.write_text(json.dumps(contract, ensure_ascii=False, indent=2) + '\n')
    for command in steps[3:]:
        run(command)
    for source, destination in [
        ('xp4.blend', 'assets/blender/xp4.blend'),
        ('xp4-source.glb', 'assets/blender/xp4-source.glb'),
        ('xp4.glb', 'public/models/xp4.glb'),
        ('model-manifest.json', 'public/models/manifest.json'),
        ('model-validation.json', 'assets/model-validation.json'),
    ] + [('annotated-mechanism.json', destination)
         for destination in mechanism_destinations]:
        path = target / destination
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(stage / source, path)
    for file in (stage / 'assets/animation').glob('*.json'):
        (target / 'assets/animation').mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, target / 'assets/animation' / file.name)
    run(['npm', 'test'])
    run(['npm', 'run', 'test:qa'])
    run(['npm', 'run', 'build'])
    print('新目录再生与开发检查完成：' + str(target))


if __name__ == '__main__':
    main()
