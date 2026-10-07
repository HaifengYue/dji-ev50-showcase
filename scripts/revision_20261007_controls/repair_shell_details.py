"""Bounded shell-detail repair: two antenna end caps and eight seated panel outlines.

Operate only on the already loaded scene. No source open/save, no shell rebuilding,
no sealing of functional, hinged, rotational or probe airflow clearances.
Dimensions are uncalibrated concept units, not manufacturing tolerances.
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

import numpy as np
from mathutils.bvhtree import BVHTree

import bpy
import bmesh

from surface_supports import _cap_open_tube, _closed, _contact, _fit_seam, _frame, _points, _tree
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "revision_20261007_edges" / "portable_qa"))
from intersections import classify

ANTENNAS = ('Ventral_antenna', 'Ventral_antenna.001')
PANEL_NAMES = tuple('Pod_U_access_panel_' + side + '_' + end + suffix
                    for side in ('L', 'R') for end in ('Front', 'Rear')
                    for suffix in ('', '.001'))
COWL_NAMES = ()
# All original cowl contours are preserved: finite intersection review found only
# Float32-scale boundary contacts, not the earlier plane-depth-based macro defect.
TARGET_NAMES = ANTENNAS + PANEL_NAMES + COWL_NAMES


def _fingerprint(obj):
    h = hashlib.sha256()
    h.update(obj.type.encode())
    h.update((obj.parent.name if obj.parent else '').encode())
    for row in obj.matrix_basis:
        h.update(struct.pack('<4d', *row))
    if obj.type == 'MESH':
        for v in obj.data.vertices:
            h.update(struct.pack('<3d', *v.co))
        for p in obj.data.polygons:
            h.update(struct.pack('<I', len(p.vertices)))
            h.update(struct.pack('<' + 'I' * len(p.vertices), *p.vertices))
            h.update(struct.pack('<I?', p.material_index, p.use_smooth))
        h.update(json.dumps([m.name if m else None for m in obj.data.materials]).encode())
    return h.hexdigest()


def _topology(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    row = {'vertices': len(bm.verts), 'faces': len(bm.faces),
           'boundaryEdges': sum(e.is_boundary for e in bm.edges),
           'nonManifoldEdges': sum(not e.is_manifold for e in bm.edges),
           'signedVolume': bm.calc_volume(signed=True)}
    bm.free()
    return row



def _untwist_closed_outline(obj):
    """Align cyclic square-ring correspondence without moving any stored point.

    Seating the legacy .001 outlines without correcting their section frame
    correspondence produces two finite crossed ruled strips. A shortest cyclic
    correspondence removes these while keeping all four points of every section.
    """
    points = [v.co.copy() for v in obj.data.vertices]
    if len(points) % 4:
        raise ValueError('Panel-outline section count is not four-sided: ' + obj.name)
    rings = len(points) // 4
    def cost(r, a, b):
        return sum((points[4*r+(j+a)%4] - points[4*((r+1)%rings)+(j+b)%4]).length_squared for j in range(4))
    dp = {0: (0., [0])}
    for r in range(rings-1):
        new = {}
        for b in range(4):
            v, path = min((v+cost(r, a, b), path+[b]) for a, (v, path) in dp.items())
            new[b] = (v, path)
        dp = new
    score, shifts = min((v+cost(rings-1, a, 0), path) for a, (v, path) in dp.items())
    changed = [r for r in range(rings) if shifts[r] != shifts[(r+1)%rings]]
    if not changed:
        return {'changedRingConnections': [], 'storedVerticesMoved': 0}
    faces = []
    for r in range(rings):
        n = (r+1) % rings
        for j in range(4):
            faces.append((4*r+(j+shifts[r])%4, 4*r+(j+1+shifts[r])%4,
                          4*n+(j+1+shifts[n])%4, 4*n+(j+shifts[n])%4))
    old = obj.data
    mesh = bpy.data.meshes.new(obj.name + '_aligned_closed_outline')
    mesh.from_pydata(points, [], faces)
    for material in old.materials:
        mesh.materials.append(material)
    for face in mesh.polygons:
        face.use_smooth = True
    mesh.update()
    obj.data = mesh
    return {'changedRingConnections': changed, 'storedVerticesMoved': 0,
            'method': 'Shortest cyclic square-section vertex correspondence; original points, centers and section width retained'}



def _validate_outline(obj, host):
    frame = _frame(obj)
    host_tree = _tree(host, frame)
    points = _points(obj, frame)
    sections = []
    for start in range(0, len(points), 4):
        distances = []
        for point in points[start:start+4]:
            hit, normal, _, distance = host_tree.find_nearest(point)
            distances.append(float(distance if (point-hit).dot(normal)>0 else -distance))
        sections.append(distances)
    obj.data.calc_loop_triangles()
    local = np.asarray([tuple(v.co) for v in obj.data.vertices], dtype=np.float64)
    triangles = [tuple(t.vertices) for t in obj.data.loop_triangles]
    tree = BVHTree.FromPolygons(local.tolist(), triangles, all_triangles=True)
    counts, robust, overlaps = {}, [], []
    candidates = 0
    for a, b in tree.overlap(tree):
        if a >= b or set(triangles[a]) & set(triangles[b]):
            continue
        candidates += 1
        result = classify(local[list(triangles[a])], local[list(triangles[b])])
        counts[result['class']] = counts.get(result['class'], 0)+1
        if result.get('robustOver1e7'):
            robust.append([a, b])
        if result['class'] == 'coplanar_area_overlap':
            overlaps.append([a, b])
    outside = min(sum(d>1e-7 for d in distances) for distances in sections)
    if outside < 2 or robust or overlaps:
        raise ValueError('Outline exposure/self-intersection validation failed: ' + str((obj.name, outside, robust, overlaps)))
    return {'sections': len(sections), 'minimumOutsideVerticesPerSection': outside,
            'minimumSectionOutwardHeight': min(max(d) for d in sections),
            'maximumSectionOutwardHeight': max(max(d) for d in sections),
            'nonAdjacentTriangleCandidates': candidates, 'classCounts': counts,
            'robustTransverseCrossingsOver1e7': len(robust), 'coplanarAreaOverlaps': len(overlaps),
            'classifier': 'scripts/revision_20261007_edges/portable_qa/intersections.py classify',
            'criterion': 'Finite segment length, both finite-triangle edge margins and both plane straddles must all exceed 1e-7 units'}


def apply():
    """Apply the exact declared repairs, verify closure, finite seating and change boundary."""
    missing = [n for n in TARGET_NAMES if n not in bpy.data.objects]
    if missing:
        raise ValueError('Missing shell-detail targets: ' + ', '.join(missing))
    bpy.context.view_layer.update()
    untouched = {o.name: _fingerprint(o) for o in bpy.data.objects if o.name not in TARGET_NAMES}
    identities = {n: (bpy.data.objects[n].parent,
                      tuple(tuple(row) for row in bpy.data.objects[n].matrix_basis),
                      tuple(bpy.data.objects[n].data.materials)) for n in TARGET_NAMES}
    rows, contacts = [], []
    for name in ANTENNAS:
        obj = bpy.data.objects[name]
        before = _topology(obj)
        coordinates = [tuple(v.co) for v in obj.data.vertices]
        if before['vertices'] != 16 or before['boundaryEdges'] != 16:
            raise ValueError('Antenna must retain its two original open octagonal rings: ' + name)
        _cap_open_tube(obj, 8)
        _closed(obj)
        after = _topology(obj)
        if [tuple(v.co) for v in obj.data.vertices] != coordinates:
            raise ValueError('Antenna end-cap repair moved stored vertices: ' + name)
        if after['nonManifoldEdges'] or after['signedVolume'] <= 0:
            raise ValueError('Antenna end-cap closure failed: ' + name)
        obj['shellDetailRepair'] = 'Original two octagonal tube ends capped; existing side wall and mounting retained'
        contact = _contact(obj, bpy.data.objects['Fuselage'], 'Original antenna mounting, independently checked after end closure')
        contacts.append(contact)
        rows.append({'name': name, 'host': 'Fuselage', 'operation': 'Cap both original octagonal ends',
                     'before': before, 'after': after, 'movedStoredVertices': 0,
                     'originalOuterSilhouettePreserved': True,
                     'capCentersWorld': [[sum((obj.matrix_world @ v.co)[k] for v in obj.data.vertices[start:start+8])/8
                                          for k in range(3)] for start in (0, 8)]})
    for name in PANEL_NAMES:
        obj = bpy.data.objects[name]
        host_name = name.replace('Pod_U_access_panel_', 'Nacelle_').removesuffix('.001')
        before = _topology(obj)
        untwist = (_untwist_closed_outline(obj) if name.endswith('.001') else
                   {'changedRingConnections': [], 'storedVerticesMoved': 0,
                    'reason': 'Seating-only finite review found no robust self-crossing on this side'})
        # Each original four-sided cross-section moves rigidly by the shortest
        # host-normal displacement to an actual 0.00030-unit material engagement.
        # The closed path, local cross-section, line diameter and owner survive.
        row, contact = _fit_seam(obj, bpy.data.objects[host_name], 4, True)
        after = _topology(obj)
        if after['nonManifoldEdges'] or after['signedVolume'] <= 0:
            raise ValueError('Panel-outline seating produced nonclosed material: ' + name)
        obj['shellDetailRepair'] = 'Original closed U-panel outline seated on actual nacelle, retaining its section and service boundary'
        rows.append({'name': name, 'host': host_name, 'operation': 'Seat original U-panel outline on actual nacelle surface',
                     'before': before, 'after': after, 'fit': row, 'sectionCorrespondenceRepair': untwist, 'exposureAndSelfIntersection': _validate_outline(obj, bpy.data.objects[host_name])})
        contacts.append(contact)
    for n, (parent, matrix, mats) in identities.items():
        o = bpy.data.objects[n]
        if o.parent != parent or tuple(tuple(row) for row in o.matrix_basis) != matrix or tuple(o.data.materials) != mats:
            raise ValueError('Shell-detail repair altered identity/transform/material: ' + n)
    changed_outside = [n for n, digest in untouched.items() if n not in bpy.data.objects or _fingerprint(bpy.data.objects[n]) != digest]
    if changed_outside or len(bpy.data.objects) != len(untouched) + len(TARGET_NAMES):
        raise ValueError('Shell-detail repair escaped its exact declared object domain: ' + str(changed_outside))
    return {'version': 1, 'changedNodes': list(TARGET_NAMES), 'repairs': rows,
            'finiteContactWitnesses': contacts,
            'untouchedObjectCount': len(untouched), 'outsideTargetObjectFingerprintsUnchanged': True,
            'sceneOpenedOrSaved': False, 'passed': True,
            'claimBoundary': 'Original concept-model mesh closure and finite local seating only; no airtight, load, manufacturing or continuous-motion claim. Functional apertures and moving seams untouched.'}
