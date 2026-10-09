"""Lightweight source/hash/path preflight; does not run Blender or certify geometry."""
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT.parent.parent / 'threejs'


def main():
    contract = json.loads((ROOT / 'scripts/data/current-model-contract.json').read_text())
    source = ROOT / contract['source']
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    assert digest == contract['sourceSha256'], 'Native source differs from reviewed contract'
    manifest = json.loads((HOST / 'public/skytrans/models/manifest.json').read_text())
    assert manifest['annotationRevision']['sourceCandidateSha256'] == digest
    assert manifest['assets']['xp4.blend']['sha256'] == digest
    runtime = HOST / 'public/skytrans/models/xp4.glb'
    assert hashlib.sha256(runtime.read_bytes()).hexdigest() == manifest['assets']['xp4.glb']['sha256']
    assert runtime.stat().st_size == manifest['assets']['xp4.glb']['bytes']
    assert runtime.stat().st_size <= contract['runtimeBudgetBytes']

    # These are the current rebake/verification dependencies. Historical filenames
    # inside lineage metadata are not executable reconstruction dependencies.
    required = [
        'assets/animation/wing-transition-reference.json',
        'assets/animation/motor-reference.json',
        'scripts/data/annotated-mechanism-intent.json',
        'scripts/data/fixed-root-paint-encoding.json',
        'scripts/verify/current-linkage-qa-contract.json',
        'scripts/export-transition.py', 'scripts/kinematics.py',
        'scripts/internal_drive.py', 'scripts/annotated_mechanism.py',
        'scripts/drive_layout.py', 'scripts/run-node.mjs',
        'qa/lib/triangle-contact.mjs', 'qa/lib/solid-contact.mjs',
        'qa/lib/runtime-rotor-motion.mts', 'qa/source-runtime.test.ts',
    ]
    required += ['scripts/verify/' + name + '.py' for name in (
        'wing_material_sweep', 'rotor_sweep', 'control_combinations',
        'drive_sweep', 'self_intersections', 'check_identity_and_aperture',
        'check_refined_supports', 'check_slot_clearance',
        'finite_intersections', 'native_contract_qa',
    )]
    required += ['scripts/pipeline/' + name for name in (
        'bake_native.py', 'compress-model.mjs', 'write_manifest.py',
        'integrated_identity_context.mjs', 'integrated_verify_source_runtime.mjs',
        'verify_integrated_baked_animation.mts',
        'verify_integrated_runtime_compatibility.mts',
        'integrated_verify_owner_topology.mts',
        'integrated_verify_all_owner_inventory.mts',
        'integrated_semantic_geometry.mts',
        'integrated_semantic_geometry.test.mts', 'identity_negative.mjs',
    )]
    for name in required:
        assert (ROOT / name).is_file(), f'Missing current pipeline dependency: {name}'
    python_files = sorted((ROOT / 'scripts').glob('*.py'))
    python_files += sorted((ROOT / 'scripts/pipeline').glob('*.py'))
    python_files += sorted((ROOT / 'scripts/verify').glob('*.py'))
    python_files += sorted((ROOT / 'tools').glob('*.py'))
    for file in python_files:
        ast.parse(file.read_text(), filename=str(file))
    result = subprocess.run(['node', 'scripts/check-module-graph.mjs'], cwd=ROOT)
    if result.returncode:
        return result.returncode
    print(json.dumps({
        'sourceSha256': digest,
        'runtimeSha256': manifest['assets']['xp4.glb']['sha256'],
        'pythonSyntaxFiles': len(python_files),
        'requiredPaths': len(required),
        'sourceHashAndPathPreflightPassed': True,
        'rebakeExecuted': False,
        'physicalVerificationExecuted': False,
    }, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
