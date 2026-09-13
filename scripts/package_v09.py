"""Package the current visual demo without dependencies, credentials or old movies.

Run after the build and validation commands listed in docs/VALIDATION_V09.md.
The v08 Blender source is included because the v09 material pass depends on it.
"""
from hashlib import sha256
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'deliverables' / 'EV50_project_v09.zip'


def collect_files():
    files = {ROOT / name for name in ('README.md', 'PROGRESS.md', '.gitignore')}
    for folder in ('threejs/src', 'threejs/public', 'threejs/scripts', 'threejs/dist'):
        files.update(p for p in (ROOT / folder).rglob('*') if p.is_file()
                     and not any(part.startswith('.') or part == '__pycache__' for part in p.relative_to(ROOT).parts))
    for folder, suffixes in (
        ('threejs', {'.json', '.ts', '.html', '.mjs'}),
        ('blender', {'.py'}), ('scripts', {'.py'}), ('docs', {'.md', '.json'}),
        ('.github/workflows', {'.yml', '.yaml'}),
        ('models/v08', {'.blend', '.glb'}), ('models/v09', {'.blend', '.glb'}),
        ('previews/v09', {'.png', '.json'}),
    ):
        files.update(p for p in (ROOT / folder).glob('*') if p.is_file()
                     and not p.name.startswith('.') and p.suffix in suffixes
                     and p.name != 'package_v09.json')
    return sorted(files, key=lambda p: p.relative_to(ROOT).as_posix())


def main():
    asset = ROOT / 'models/v09/ev50_v09.glb'
    active = ROOT / 'threejs/public/ev50.glb'
    built = ROOT / 'threejs/dist/ev50.glb'
    if not asset.is_file() or not active.is_file() or not built.is_file():
        raise RuntimeError('Missing source, active or built model. Build the project first.')
    digest = sha256(asset.read_bytes()).hexdigest()
    if any(sha256(p.read_bytes()).hexdigest() != digest for p in (active, built)):
        raise RuntimeError('Model versions differ between source, public and dist.')
    validation = json.loads((ROOT / 'docs/gltf_validator.json').read_text(encoding='utf-8'))
    if validation['issues']['numErrors'] or validation['issues'].get('truncated'):
        raise RuntimeError('GLB validation contains errors or is truncated.')
    files = collect_files()
    entries = []
    for path in files:
        payload = path.read_bytes()
        entries.append({'path':path.relative_to(ROOT).as_posix(), 'bytes':len(payload),
                        'sha256':sha256(payload).hexdigest()})
    manifest = {
        'version':'v09', 'api_version':'3.0', 'model_sha256':digest,
        'gltf_errors':validation['issues']['numErrors'],
        'gltf_warnings':validation['issues']['numWarnings'],
        'browser_acceptance':'Not completed; automated browser check was blocked before execution.',
        'offline_movie':'No updated movie included. Historical movies remain in the original workspace.',
        'files':entries,
    }
    content = json.dumps(manifest, ensure_ascii=False, indent=2)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUTPUT, 'w', ZIP_DEFLATED, compresslevel=6) as archive:
        for path in files:
            archive.write(path, path.relative_to(ROOT).as_posix())
        archive.writestr('MANIFEST.json', content)
    with ZipFile(OUTPUT) as archive:
        bad_member = archive.testzip()
        if bad_member:
            raise RuntimeError(f'ZIP verification failed: {bad_member}')
    (ROOT / 'docs/package_v09.json').write_text(content, encoding='utf-8')
    print(json.dumps({'archive':str(OUTPUT), 'files':len(files), 'bytes':OUTPUT.stat().st_size,
                      'model_sha256':digest, 'crc_check':'passed'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
