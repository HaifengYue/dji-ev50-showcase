"""Build I's full-range conservative exclusion cutter, without cutting skin.

Only a temporary copy of Fixed_root is clipped. The returned world-space mesh
is owned by the caller and is suitable for connect_moving_bridge.connect.
The original fixed/moving meshes, transforms, parents and materials are not
modified. This intentionally retains I's conservative complete convex hull,
not the newer narrower segmented/triangle skin-relief method.
"""
import itertools
import math

import bpy
import bmesh
import numpy as np
from mathutils import Quaternion
from scipy.spatial import ConvexHull


def _remove_temporary(obj):
    mesh = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    if mesh.users == 0:
        bpy.data.meshes.remove(mesh)


def build(side, center, axis, boolean, temp_revolve):
    """Return full 0..120-degree I cutter; caller must delete it after use.

    center/axis and callbacks use the same current cruise/world frame as
    relieve_local_sweep.build. No DIFFERENCE is applied to any original object.
    """
    if side not in ('L', 'R'):
        raise ValueError('Explicit wing side required')
    fixed = bpy.data.objects['Fixed_root_' + side]
    clip = fixed.copy()
    clip.data = fixed.data.copy()
    bpy.context.collection.objects.link(clip)
    clip.name = 'TemporaryFiniteFixedSkin_' + side
    tool = None
    cutter = None
    try:
        tool = temp_revolve('TemporarySweepDomain_' + side, side,
                            [(-.05, 0), (-.05, .120), (.135, .120), (.135, 0)])
        boolean(clip, tool, 'INTERSECT')
        _remove_temporary(tool)
        tool = None
        raw = np.array([tuple(clip.matrix_world @ v.co - center)
                        for v in clip.data.vertices])
        assert len(raw) > 3
        sign = -1 if side == 'L' else 1
        points = []
        for degrees in range(0, 121, 2):
            rotation = np.array(Quaternion(axis, -sign * math.radians(degrees)).to_matrix())
            points.extend((raw @ rotation.T).tolist())
        points = np.array(points)
        hull = ConvexHull(points)
        points = points[hull.vertices]
        offset = .0034
        corners = np.array(list(itertools.product([-offset, offset], repeat=3)))
        points = (points[:, None, :] + corners[None, :, :]).reshape(-1, 3)
        hull = ConvexHull(points)
        used = np.unique(hull.simplices)
        remap = {vertex: i for i, vertex in enumerate(used)}
        vertices = [points[i] + np.array(center) for i in used]
        faces = [[remap[int(i)] for i in face] for face in hull.simplices]
        mesh = bpy.data.meshes.new('ConservativeLocalSweep_' + side)
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        assert all(edge.is_manifold for edge in bm.edges)
        bm.to_mesh(mesh)
        bm.free()
        cutter = bpy.data.objects.new(mesh.name, mesh)
        bpy.context.collection.objects.link(cutter)
        cutter['bridgeSweepRecipe'] = 'I full-range convex hull; original skin not cut'
        cutter['bridgeSweepAngleRange'] = [0., 120.]
        cutter['bridgeSweepStepDegrees'] = 2.
        cutter['bridgeSweepSourceAxisT'] = [-.05, .135]
        cutter['bridgeSweepSourceRadiusBound'] = .120
        cutter['bridgeSweepOutwardBoxOffset'] = offset
        cutter['bridgeSweepBetweenPoseArcSagitta'] = .120 * (1 - math.cos(math.radians(1)))
        return cutter
    except Exception:
        if cutter is not None:
            _remove_temporary(cutter)
        raise
    finally:
        if tool is not None:
            _remove_temporary(tool)
        _remove_temporary(clip)
