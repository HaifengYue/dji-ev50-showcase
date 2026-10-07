"""Compare both independently rebuilt encodings without changing either model."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--other', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True, help='New output directory')
    parser.add_argument('--node', default='node')
    parser.add_argument('--resource-monitor', type=Path,
                        help='Optional audited Node RSS monitor for Linux verification')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    other = args.other.resolve(strict=True)
    output = args.output.resolve()
    if root == other or root.name != 'transwing-studio' or other.name != 'transwing-studio':
        raise ValueError('Require two different transwing-studio roots')
    output.mkdir(parents=True, exist_ok=False)
    method = root / 'tools/compare-complete-native-signed-zero.mts'
    reports = []
    for kind, relative in [('source', 'assets/blender/xp4-source.glb'),
                           ('runtime', 'public/models/xp4.glb')]:
        before, after = root / relative, other / relative
        report = output / (kind + '.json')
        config = output / (kind + '-config.json')
        config.write_text(json.dumps({'before': {'path': str(before), 'sha256': sha(before)},
                                      'after': {'path': str(after), 'sha256': sha(after)},
                                      'output': str(report)}, indent=2) + '\n', encoding='utf-8')
        command = [args.node, '--max-old-space-size=1280']
        env = os.environ.copy()
        if args.resource_monitor:
            monitor = args.resource_monitor.resolve(strict=True)
            command.extend(['--require', str(monitor)])
            env.update(QA_RESOURCE_FILE=str(output / (kind + '-resource.json')),
                       QA_RSS_LIMIT_BYTES=str(int(1.8 * 1024**3)),
                       QA_AVAILABLE_FLOOR_BYTES=str(2 * 1024**3))
        command.extend(['--import', 'tsx', str(method), str(config)])
        with (output / (kind + '.log')).open('xb') as log:
            subprocess.run(command, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
        data = json.loads(report.read_text(encoding='utf-8'))
        passed = (not data['changedGeometry'] and not data['changedNodeFrames']
                  and not data['changedNodeExtras'] and data['completeAnimationsExactlyIdentical']
                  and all(r['materialsIdentical'] for r in data['meshRows']))
        reports.append({'encoding': kind, 'passed': passed, 'report': str(report),
                        'reportSha256': sha(report), 'meshCount': data['meshCount'],
                        'nodeCount': data['nodeCount'],
                        'accessorOnlyChanges': data['accessorOnlyChanges']})
    result = {'schema': 'transwing.independent-encoding-comparison.v1',
              'passed': all(r['passed'] for r in reports),
              'methodSha256': sha(method), 'reports': reports,
              'physicalAcceptanceClaimed': False, 'overallAcceptancePassed': False}
    (output / 'summary.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'passed': result['passed'], 'output': str(output)}))
    raise SystemExit(0 if result['passed'] else 1)


if __name__ == '__main__':
    main()
