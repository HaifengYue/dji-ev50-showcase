"""Portable finite moving-support authoring recipe. Not a production integration.

Reads only this repository's JSON and bounded geometric helpers. It never reads
analysis maps, .tri inventories, saved fixture meshes or review reports. Only
RootCarrierBridge_L/R data are replaced, after both temporary solids are ready.
Topology guards here are authoring checks; independent exact acceptance remains
mandatory. The unchanged old fixed pedestal is explicitly outside this module.
"""
from pathlib import Path
import hashlib
import json
import math
import sys
import bpy
import bmesh
import numpy as np
from mathutils import Vector
from wing_surface_repair import simplify_slivers
from mesh_precision import face_area

CONTRACT_PATH = Path(__file__).with_name('data') / 'annotated-moving-support.json'
CONTRACT = json.loads(CONTRACT_PATH.read_text())
assert CONTRACT['schema'] == 'transwing.annotated-moving-support.v1'
TARGETS = tuple(CONTRACT['targets'])


def _audit(obj):
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    result={'volume':bm.calc_volume(signed=True),
            'nonManifoldEdges':sum(not e.is_manifold for e in bm.edges),
            'floatAreaBelow1eMinus18':sum(f.calc_area()<=1e-18 for f in bm.faces),
            'triangleCount':len(bm.faces)}
    bm.to_mesh(obj.data);bm.free();obj.data.update()
    return result


def _new_mesh(name,vertices,faces):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    return obj


def _sphere_vertices():
    c=CONTRACT['capsule'];bm=bmesh.new()
    bmesh.ops.create_icosphere(bm,subdivisions=c['icosphereSubdivisions'],radius=c['outerRadius'])
    bm.normal_update();vertices=np.array([tuple(v.co)for v in bm.verts])
    minimum=min(abs(f.normal.dot(f.verts[0].co))for f in bm.faces)
    maximum=max(np.linalg.norm(vertices,axis=1));bm.free()
    guarded=minimum-c['worldCoordinateConstructionGuard']
    if guarded<c['requiredInnerSphereRadius']:
        raise ValueError('Faceted sphere fails actual inner-ball radius')
    if math.pi*guarded**2<CONTRACT['requiredGeometricAreas']['commonTrunk']:
        raise ValueError('Finite construction fails common-trunk area')
    return vertices,{'actualMinimumFacePlaneRadius':minimum,'guardedInnerRadius':guarded,
                     'guardedInnerDiskArea':math.pi*guarded**2,'maximumVertexRadius':float(maximum)}


def _capsule(name,start,end,sphere):
    bm=bmesh.new()
    for p in np.r_[sphere+np.array(start),sphere+np.array(end)]:bm.verts.new(p)
    bmesh.ops.convex_hull(bm,input=list(bm.verts),use_existing_faces=False)
    unused=[v for v in bm.verts if not v.link_faces]
    if unused:bmesh.ops.delete(bm,geom=unused,context='VERTS')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    mesh=bpy.data.meshes.new('capsule');bm.to_mesh(mesh);bm.free()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    result=_audit(obj)
    if result['nonManifoldEdges'] or result['floatAreaBelow1eMinus18'] or result['volume']<=0:
        raise ValueError('Invalid finite capsule')
    return obj


def _foot(name,lo,hi):
    a,b=lo,hi
    vertices=[(a[0],a[1],a[2]),(b[0],a[1],a[2]),(b[0],b[1],a[2]),(a[0],b[1],a[2]),
              (a[0],a[1],b[2]),(b[0],a[1],b[2]),(b[0],b[1],b[2]),(a[0],b[1],b[2])]
    faces=[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
    obj=_new_mesh(name,vertices,faces);_audit(obj);return obj


def _clean(obj):
    c=CONTRACT['cleanup'];bm=bmesh.new();bm.from_mesh(obj.data)
    before_vertices=len(bm.verts);before_faces=len(bm.faces);volume=bm.calc_volume(signed=True)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=c['nearVertexMergeDistance'])
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=c['degenerateEdgeDissolveDistance'])
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    records=simplify_slivers(bm,obj)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.normal_update()
    result={'verticesBefore':before_vertices,'facesBefore':before_faces,
            'verticesAfter':len(bm.verts),'facesAfter':len(bm.faces),
            'originalVolume':volume,'finalVolume':bm.calc_volume(signed=True),
            'sliverCollapseRecords':records,'nonManifoldEdges':sum(not e.is_manifold for e in bm.edges),
            'floatAreaBelow1eMinus18':sum(face_area(f)<=1e-18 for f in bm.faces)}
    if result['nonManifoldEdges'] or result['floatAreaBelow1eMinus18'] or result['finalVolume']<=0:
        bm.free();raise ValueError('Finite moving-support cleanup failed authoring solid guard')
    bm.to_mesh(obj.data);bm.free();obj.data.update();return result


def build_annotated_moving_supports():
    """Stage one explicit pair, preserve transforms, commit mesh data only."""
    thread_args=[sys.argv[i+1]for i,a in enumerate(sys.argv[:-1])if a in ('-t','--threads')]
    thread_args += [a.split('=',1)[1]for a in sys.argv if a.startswith('--threads=')]
    if not thread_args or any(a!='4'for a in thread_args):
        raise ValueError('Deterministic geometry requires Blender -t 4')
    originals={};origin=Vector(CONTRACT['sourceAxisOriginRight'])
    for side,sg in [('R',1),('L',-1)]:
        name='RootCarrierBridge_'+side;obj=bpy.data.objects[name];pivot=bpy.data.objects['WingPivot_'+side]
        expected=Vector((sg*origin.x,origin.y,origin.z))
        if (pivot.location-expected).length>3e-7 or abs(pivot.rotation_quaternion.angle)>1e-7:
            raise ValueError('Requires original native cruise-rest axis and pose')
        if obj.parent!=pivot or obj.modifiers or obj.animation_data:
            raise ValueError('Unexpected moving bridge hierarchy or modifiers')
        if obj.get('supportFreeSpaceDiagnosticOnly'):
            raise ValueError('Refusing repeated support application; use unadapted source host')
        if not bpy.data.objects['RootCarrierMoving_'+side].get('annotatedCompactStack'):
            raise ValueError('Requires original finite compact carrier')
        originals[name]={'object':obj,'world':obj.matrix_world.copy(),'basis':obj.matrix_basis.copy(),
                         'parent':obj.parent,'parentInverse':obj.matrix_parent_inverse.copy(),
                         'materials':tuple(obj.data.materials)}
    temporary=[];staged=[];parts=[];unions=[]
    try:
        sphere,sphere_report=_sphere_vertices()
        for kind,path in [('trunk',CONTRACT['trunk'])]+[(f'leg{k+1}',p)for k,p in enumerate(CONTRACT['legs'])]:
            for k,(a,b)in enumerate(zip(path,path[1:])):
                obj=_capsule(f'MapPrimitive_{kind}_{k}',a,b,sphere);parts.append(obj);temporary.append(obj)
        for k,(lo,hi)in enumerate(CONTRACT['footBoxes']):
            obj=_foot('MapPrimitive_foot_'+str(k),lo,hi);parts.append(obj);temporary.append(obj)
        base=parts[0].copy();base.data=parts[0].data.copy();bpy.context.collection.objects.link(base)
        base.name='MapBridge_R_unioned';temporary.append(base)
        for obj in parts[1:]:
            bpy.context.view_layer.objects.active=base
            mod=base.modifiers.new('Map finite union','BOOLEAN');mod.operation='UNION';mod.solver='EXACT';mod.object=obj
            bpy.ops.object.modifier_apply(modifier=mod.name);result=_audit(base);unions.append({'part':obj.name,'solid':result})
            if result['nonManifoldEdges'] or result['volume']<=0:
                raise ValueError('Finite capsule union failed closed positive material guard')
        right=[v.co.copy()for v in base.data.vertices];faces=[tuple(f.vertices)for f in base.data.polygons]
        for side,sg in [('R',1),('L',-1)]:
            original=originals['RootCarrierBridge_'+side];old=original['object'];inv=old.matrix_world.inverted()
            vertices=[inv@Vector((sg*p.x,p.y,p.z))for p in right]
            obj=_new_mesh('MapDerivedFiniteBridge_'+side,vertices,faces if sg==1 else[f[::-1]for f in faces])
            temporary.append(obj);obj.parent=old.parent;obj.matrix_parent_inverse=old.matrix_parent_inverse.copy();obj.matrix_basis=old.matrix_basis.copy()
            for mat in original['materials']:obj.data.materials.append(mat)
            staged.append((old,obj))
        bpy.context.view_layer.update()
        repairs=[]
        for old,obj in staged:repairs.append({'name':old.name,'repair':_clean(obj)})
        for old,obj in staged:
            old.data=obj.data
            # Preserve the diagnostic status until independent assembly acceptance.
            old['supportFreeSpaceDiagnosticOnly']=True;old['supportAccepted']=False
        bpy.context.view_layer.update()
        for name,state in originals.items():
            obj=state['object']
            assert obj.parent==state['parent'] and obj.matrix_world==state['world'] and obj.matrix_basis==state['basis']
            assert obj.matrix_parent_inverse==state['parentInverse'] and tuple(obj.data.materials)==state['materials']
        return {'candidateOnly':True,'accepted':False,'fullMachinePassed':False,'revision':CONTRACT['revision'],
                'changesLimitedTo':list(TARGETS),'configurationSha256':hashlib.sha256(CONTRACT_PATH.read_bytes()).hexdigest(),
                'sphere':sphere_report,'unions':unions,'repairs':repairs,'fixedSupportModified':False,
                'productionGeneratorIntegrated':False,'requiresIndependentExactVerification':True}
    finally:
        for obj in temporary:
            if obj.name in bpy.data.objects:bpy.data.objects.remove(obj,do_unlink=True)
        bpy.context.view_layer.update()
