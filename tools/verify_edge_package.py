"""Verify the complete current package, including rejection of unlisted content."""
from pathlib import Path
import json, runpy
ROOT=Path(__file__).resolve().parents[1]
manifest=json.loads((ROOT/'DEVELOPMENT_MANIFEST.json').read_text())
expected={r['path'] for r in manifest['files']}|{'DEVELOPMENT_MANIFEST.json'}
# Installed dependencies and version-control metadata are not distributable content.
actual=set()
for p in ROOT.rglob('*'):
    rel=p.relative_to(ROOT)
    if '.git' in rel.parts or 'node_modules' in rel.parts or '__pycache__' in rel.parts or p.name=='tsconfig.tsbuildinfo':
        continue
    assert not p.is_symlink(),f'Unexpected symlink: {rel}'
    if p.is_file():actual.add(rel.as_posix())
assert actual==expected,{'unlisted':sorted(actual-expected),'missing':sorted(expected-actual)}
assert len(expected)==manifest['contentFileCount']+1
runpy.run_path(str(ROOT/'tools/verify_package.py'),run_name='__main__')
print(json.dumps({'completeFileSetVerified':True,'unlistedFiles':0,'contentFiles':len(actual)-1}))
