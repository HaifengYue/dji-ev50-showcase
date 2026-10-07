"""Bounded actual side-strip stitching after repair4 and trim2.

Native authoring operation only. Data contains finite construction admission
coordinates and connectivity, not an imported model or a relaxed QA tolerance.
Both complete side transactions validate before either source mesh is written.
"""
from pathlib import Path
import hashlib
import json

DATA_PATH = Path(__file__).with_name('data')/'annotated-root-closing.json'


def close_annotated_side_strips():
    import bpy
    import bmesh
    from mathutils import Matrix, Vector
    raw = DATA_PATH.read_bytes()
    data = json.loads(raw)
    if data['schema'] != 'transwing.bounded-root-closing.v2':
        raise ValueError('Unexpected finite closing construction schema')
    pending = []
    try:
        allowed = {'Composite_wing_L','Composite_wing_R','Fixed_root_L','Fixed_root_R'}
        names = {p['mesh'] for p in data['patches']}
        if names != allowed or set(data['approvedNodes']) != allowed:
            raise ValueError('Bounded closing must name exactly the four approved root hosts')
        for name in sorted(names):
            side = name[-1]
            sign = -1 if side == 'L' else 1
            obj = bpy.data.objects[name]
            pivot = bpy.data.objects['WingPivot_'+side]
            expected = Vector((sign*data['pivotRight'][0],*data['pivotRight'][1:]))
            if (pivot.location-expected).length > 3e-7 or pivot.rotation_quaternion.angle > 1e-7:
                raise ValueError('Finite closing requires final B axis and explicit cruise pose')
            if obj.parent != (None if name.startswith('Fixed_root_') else pivot) or obj.matrix_basis != Matrix.Identity(4):
                raise ValueError('Finite closing requires canonical unscaled wing-local material')
            if obj.get('boundedClosureStitchApplied') is not None or obj.modifiers:
                raise ValueError('Finite closing cannot be repeated or applied over active modifiers')
            bm = bmesh.new()
            pending.append((obj,bm,None))
            bm.from_mesh(obj.data)
            if not all(len(f.verts) == 3 for f in bm.faces):
                raise ValueError('Finish existing four-wing repair and tail trim first')
            by_point = {}
            for v in bm.verts:
                key = tuple(v.co)
                if key in by_point:
                    raise ValueError('Ambiguous duplicate coordinate at finite closing admission')
                by_point[key] = v
            by_face = {}
            for f in bm.faces:
                key = tuple(sorted(tuple(v.co) for v in f.verts))
                if key in by_face:
                    raise ValueError('Duplicate source face at finite closing admission')
                by_face[key] = f
            edits, additions, removals = {}, [], set()
            for patch in [p for p in data['patches'] if p['mesh'] == name]:
                for tri in patch['originalSideTrianglesLocal']:
                    key = tuple(sorted(tuple(p) for p in tri))
                    if key not in by_face:
                        raise ValueError('Native source closing triangle differs from the explicitly frozen construction')
                    removals.add(by_face[key])
                verts = []
                for row in patch['vertices']:
                    old, new = tuple(row['oldLocal']), tuple(row['newLocal'])
                    if old not in by_point or (old in edits and edits[old] != new):
                        raise ValueError('Finite closing admission coordinate mismatch')
                    if row['role'] == 'outer-boundary' and old != new:
                        raise ValueError('Exterior closing boundary must remain unchanged')
                    if max(abs(a-b) for a,b in zip(old,new)) >= 5.1e-6:
                        raise ValueError('Finite closing exceeds its bounded construction displacement')
                    edits[old] = new
                    verts.append(by_point[old])
                for tri in patch['newSideFaces']:
                    if len({patch['vertices'][i]['role'] for i in tri}) != 2:
                        raise ValueError('Every closing face must stitch both existing boundary chains')
                    additions.append(tuple(verts[i] for i in tri))
            old_count = len(bm.faces)
            if len(removals) != len(additions):
                raise ValueError('Finite closing may not discard a material-face region')
            bmesh.ops.delete(bm, geom=list(removals), context='FACES_ONLY')
            for old,new in edits.items():
                by_point[old].co = new
            for verts in additions:
                f = bm.faces.new(verts)
                f.smooth = False
                f.material_index = 0
            obsolete = [e for e in bm.edges if not e.link_faces]
            bmesh.ops.delete(bm, geom=obsolete, context='EDGES')
            bm.normal_update()
            if (len(bm.faces) != old_count or not all(v.link_faces for v in bm.verts)
                    or not all(e.is_manifold for e in bm.edges)
                    or not all(f.calc_area() > 0 for f in bm.faces)
                    or bm.calc_volume(signed=True) <= 0):
                raise ValueError('Finite closing candidate failed authoring topology checks')
            report = {'node':name,'removedSideTriangles':len(removals),
                      'newSideTriangles':len(additions),'obsoleteZeroFaceDiagonalsRemoved':len(obsolete),
                      'changedInnerVertices':sum(a != b for a,b in edits.items()),
                      'outerBoundaryVerticesUnchanged':True,'constructionCheckOnly':True}
            pending[-1] = (obj,bm,report)
        # All source admission and candidate bmesh checks finished on both sides.
        for obj,bm,_ in pending:
            bm.to_mesh(obj.data)
            obj.data.update()
            obj['boundedClosureStitchApplied'] = True
            obj['boundedClosureStitchClaim'] = str(len(data['patches']))+' explicit simple side strips; physical material and motion require new independent validation'
        return {'parts':[r for _,_,r in pending],
                'recipeSha256':hashlib.sha256(raw).hexdigest(),
                'claimBoundary':'Authoring transaction only; actual source/runtime strict material, support and motion must be independently reverified'}
    finally:
        for _,bm,_ in pending:
            bm.free()
