"""V27 candidate-to-baked complete geometry identity; no material, appearance or playback acceptance."""
from pathlib import Path
import bpy, json, hashlib, struct, os

ROOT = Path(__file__).resolve().parents[2]
QA = (ROOT / os.environ.get('TRANSWING_INTEGRATED_STAGE', 'qa/revision-20261007-inset/baked-integrated-a')).resolve()
assert QA.is_relative_to(ROOT / 'qa/revision-20261007-inset')
(QA / 'BAKE_GEOMETRY_IDENTITY.json').write_text(json.dumps({'passed': False, 'revision': 27, 'status': 'running-or-interrupted', 'integrationApproved': False}) + '\n')
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
reference_path = QA / 'SOURCE_GEOMETRY_REFERENCE.json'
ref = json.loads(reference_path.read_text())
receipt = json.loads((QA / 'BAKE_RECEIPT.json').read_text())
expected = os.environ.get('TRANSWING_INTEGRATED_EXPECTED_SHA', '51ec3c493b62d0d4caac924ddf1e26b6889288affa5ccd5376f0eb249be6e72c')
candidate = (ROOT / ref['sourceCandidate']).resolve()
assert candidate.is_relative_to(ROOT / 'qa/revision-20261007')
assert sha(candidate) == ref['sourceCandidateSha256'] == receipt['sourceCandidateSha256'] == expected
assert sha(reference_path) == receipt['sourceGeometryReferenceSha256']
assert ref['sourceCandidate'] == receipt['sourceCandidate']
source = QA / 'xp4.blend'
output = next(row for row in receipt['outputs'] if (ROOT / row['path']).resolve() == source)
assert sha(source) == output['sha256'] and source.stat().st_size == output['bytes']
mesh_names = sorted(name for name, row in ref['rows'].items() if row['type'] == 'MESH')
node_names = sorted(ref['rows'])
assert len(mesh_names) == receipt['expectedMeshes']
assert len(node_names) == receipt['expectedNodes']
assert mesh_names == sorted(receipt['meshOwnerNames']) == sorted(ref['currentMeshOwnerNames'])
parent = json.loads((QA / 'v25-parent-validation.json').read_text())
assert parent['modelVersion'] == 25
aliases = ['WingLowerClosure_L', 'WingLowerClosure_R']
for name in parent['quantization']['float32PositionExceptions']:
    assert name in ref['rows'], 'Missing inherited critical owner: ' + name
    assert ref['rows'][name]['type'] == ('EMPTY' if name in aliases else 'MESH')

def complete_geometry_signature(obj):
    verts = [tuple(vertex.co) for vertex in obj.data.vertices]
    polygons = []
    for polygon in obj.data.polygons:
        points = [struct.pack('<3f', *verts[index]).hex() for index in polygon.vertices]
        polygons.append(str(polygon.material_index) + ':' + ','.join(min(points[i:] + points[:i] for i in range(len(points)))))
    payload = {
        'allVerticesIncludingUnused': sorted(struct.pack('<3f', *vertex).hex() for vertex in verts),
        'orientedPolygons': sorted(polygons),
        'materials': [material.name if material else None for material in obj.data.materials],
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def compare(file, label, check_static_frames):
    bpy.ops.wm.open_mainfile(filepath=str(file))
    if check_static_frames:
        bpy.context.scene.frame_set(99)
    bpy.context.view_layer.update()
    objects = {obj.name: obj for obj in bpy.data.objects if obj.type in ['MESH', 'EMPTY']}
    differences = []
    missing, unexpected = sorted(set(node_names) - set(objects)), sorted(set(objects) - set(node_names))
    if missing or unexpected:
        differences.append({'kind': 'complete-object-inventory', 'missing': missing, 'unexpected': unexpected})
    mesh_count = static_count = 0
    for name, row in ref['rows'].items():
        obj = objects.get(name)
        if obj is None or obj.type != row['type'] or (obj.parent.name if obj.parent else None) != row['parent']:
            differences.append({'name': name, 'kind': 'hierarchy'})
            continue
        if obj.type == 'MESH':
            mesh_count += 1
            if complete_geometry_signature(obj) != row['geometrySha256']:
                differences.append({'name': name, 'kind': 'complete-geometry'})
            if len(obj.data.vertices) != row['vertices'] or len(obj.data.polygons) != row['polygons']:
                differences.append({'name': name, 'kind': 'complete-mesh-element-counts'})
        if not obj.animation_data:
            static_count += 1
            if [list(r) for r in obj.matrix_basis] != row['matrixBasis'] or [list(r) for r in obj.matrix_parent_inverse] != row['matrixParentInverse']:
                differences.append({'name': name, 'kind': 'static-local-frame'})
    for name in aliases:
        obj = objects.get(name)
        if obj is None or obj.type != 'EMPTY' or obj.parent.name != 'WingPivot_' + name[-1]:
            differences.append({'name': name, 'kind': 'EMPTY-semantic-anchor'})
    assert mesh_count == len(mesh_names)
    return {'artifact': label, 'sha256': sha(file), 'completeMeshIdentitiesCompared': mesh_count,
            'allNamedParentsCompared': len(node_names), 'staticLocalFramesCompared': static_count,
            'differences': differences}

# Independently reopen the pinned current candidate; never trust only a generated reference.
candidate_result = compare(candidate, 'pinned-current-candidate', False)
baked_result = compare(source, 'fresh-baked-blend', True)
differences = [{'artifact': result['artifact'], **row} for result in [candidate_result, baked_result] for row in result['differences']]
report = {
    'passed': not differences, 'revision': 27,
    'jointMaterialAcceptanceImplied': False, 'appearanceAccepted': False, 'integrationApproved': False,
    'candidateReferenceSha256': sha(reference_path), 'sourceCandidateSha256': expected,
    'bakedBlendSha256': sha(source), 'completeMeshIdentitiesCompared': len(mesh_names),
    'allNamedParentsCompared': len(node_names), 'countsVerifiedAgainstCurrentReferenceAndBakeReceipt': True,
    'completeGeometryIncludesUnusedVerticesOrientedPolygonsAndMaterialSlots': True,
    'actualCandidateReopenedAndIndependentlyCompared': True,
    'animatedFramesRequireSeparateActualGLTFPlaybackVerification': True,
    'checks': [candidate_result, baked_result], 'differences': differences,
    'claimBoundary': 'Complete current-candidate and baked native geometry identity only. No thickness, clearance, collision, visual, animation-playback or integration acceptance is granted.',
}
(QA / 'BAKE_GEOMETRY_IDENTITY.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2), flush=True)
assert report['passed']
