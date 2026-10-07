"""Selective axial compaction for the annotated root-hinge candidate.

This builder preserves each radial coordinate, parent and object transform.
It does not build a fairing, finite host cavity or support, and is not called by
the production generator until those dependencies and the motion gates pass.
"""
import math,hashlib,struct
import bpy,bmesh
from mathutils import Vector

ASSEMBLY_SHIFT=-.030
EXPECTED_PIVOT=(1.35,-1.415,-.20)
SOURCE_COORDINATE_BUDGET=1e-6  # authoring float32 admission check, not a material/contact tolerance
# suffix: original center/length, compact center-before-shift/length.
PARTS={
 'RootHingeShaft_':(0.,.176,-.001,.054),
 'RootHingeEndcap_{side}-0.148':(-.088,.010,-.0275,.003),
 'RootHingeEndcap_{side}0.148':(.088,.010,.0255,.003),
 'RootBearingFixed_{side}_Front':(-.050,.022,-.013,.022),
 'RootBearingFixed_{side}_Rear':(.060,.022,.013,.022),
 'RootBearingSeal_{side}_Front':(-.050,.026,-.013,.026),
 'RootBearingSeal_{side}_Rear':(.060,.026,.013,.026),
 'RootBearingHousing_':(.005,.132,0.,.052),
 'RootCarrierMoving_':(-.020,.047,-.006,.026),
 'RootCarrierThrust_':(-.002,.009,.004,.009),
}

def _digest(obj):
    h=hashlib.sha256()
    for vertex in obj.data.vertices:h.update(struct.pack('<3d',*vertex.co))
    for face in obj.data.polygons:
        h.update(struct.pack('<I',len(face.vertices)))
        h.update(struct.pack('<%dI'%len(face.vertices),*face.vertices))
    return h.hexdigest()

def compact_annotated_stack(ctx):
    # Validate the full transaction before changing any source data.
    selected=[];markers=[]
    for side,sign in [('L',-1),('R',1)]:
        pivot=bpy.data.objects['WingPivot_'+side]
        target=Vector((sign*EXPECTED_PIVOT[0],EXPECTED_PIVOT[1],EXPECTED_PIVOT[2]))
        if (pivot.location-target).length>3e-7:
            raise ValueError('Compact hinge requires the final annotated pivot: '+side)
        axis=ctx['wing_axis'](sign).normalized()
        for key,dimensions in PARTS.items():
            name=key.format(side=side)if '{side}'in key else key+side
            obj=bpy.data.objects[name]
            if obj.get('annotatedCompactStack'):
                raise ValueError('Compact hinge may only be applied once: '+name)
            moving=name.startswith(('RootCarrierMoving_','RootCarrierThrust_'))
            if obj.type!='MESH' or obj.parent!=(pivot if moving else None):
                raise ValueError('Unexpected compact hinge source hierarchy: '+name)
            if obj.animation_data or obj.modifiers:
                raise ValueError('Compact hinge requires authored mesh without active modifiers/actions: '+name)
            origin=Vector()if moving else target
            points=[obj.matrix_basis@v.co-origin for v in obj.data.vertices]
            axial=[q.dot(axis)for q in points]
            radial=[(q-axis*q.dot(axis)).length for q in points]
            old_center,old_length,_,_=dimensions
            if max(abs(min(axial)-(old_center-old_length/2)),abs(max(axial)-(old_center+old_length/2)))>SOURCE_COORDINATE_BUDGET:
                raise ValueError('Unexpected actual source axial domain before compact transaction: '+name+' '+str((min(axial),max(axial))))
            radial_targets=(.00897571,.014)if name.startswith('RootHingeShaft_')else((.01222649,.01669586)if name.startswith('RootHingeEndcap_')else((.017,.028)if name.startswith('RootBearingFixed_')else((.016,.026)if name.startswith('RootBearingSeal_')else((.0258,.0277)if name.startswith('RootBearingHousing_')else(.030,.039)))))
            if max(abs(min(radial)-radial_targets[0]),abs(max(radial)-radial_targets[1]))>SOURCE_COORDINATE_BUDGET:
                raise ValueError('Unexpected actual source radial domain before compact transaction: '+name+' '+str((min(radial),max(radial))))
            selected.append((obj,side,axis,origin,dimensions))
        for prefix,offset in [('RootAxisStart_',-.028),('RootAxisEnd_',.026),('RootBearingCenter_{side}_Front',-.013),('RootBearingCenter_{side}_Rear',.013)]:
            name=prefix.format(side=side)if '{side}'in prefix else prefix+side
            obj=bpy.data.objects[name]
            if obj.parent is not None:raise ValueError('Unexpected fixed marker parent: '+name)
            markers.append((obj,target+axis*(ASSEMBLY_SHIFT+offset)))
    rows=[]
    for obj,side,axis,origin,(old_center,old_length,new_center,new_length)in selected:
        before=_digest(obj);basis=obj.matrix_basis.copy();inverse=basis.inverted()
        old=[];maximum_radial_change=0.;maximum_axial_rounding=0.
        for vertex in obj.data.vertices:
            q=basis@vertex.co-origin;t=q.dot(axis);radial=q-axis*t
            target_t=(t-old_center)*new_length/old_length+new_center+ASSEMBLY_SHIFT
            vertex.co=inverse@(origin+radial+axis*target_t)
            result=basis@vertex.co-origin;rt=result.dot(axis)
            maximum_radial_change=max(maximum_radial_change,((result-axis*rt)-radial).length)
            maximum_axial_rounding=max(maximum_axial_rounding,abs(rt-target_t))
            old.append((t,radial.length))
        obj.data.update()
        # Translation into the compact author's float32 mesh can make bevel
        # vertices exactly identical. Weld exact identities only: no tolerance,
        # no vertex displacement, and no exclusion from the subsequent QA mesh.
        bm=bmesh.new();bm.from_mesh(obj.data);canonical={};targetmap={}
        for vertex in bm.verts:
            key=tuple(vertex.co)
            if key in canonical:targetmap[vertex]=canonical[key]
            else:canonical[key]=vertex
        exact_duplicate_count=len(targetmap)
        if targetmap:bmesh.ops.weld_verts(bm,targetmap=targetmap)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bm.to_mesh(obj.data);bm.free();obj.data.update()
        if any(tuple(v.co)not in canonical for v in obj.data.vertices):
            raise ValueError('Exact compact-stack weld moved a surviving vertex: '+obj.name)
        obj['annotatedCompactStack']=True
        rows.append({'node':obj.name,'oldAxialCenter':old_center,'oldAxialLength':old_length,
            'newAxialCenter':new_center+ASSEMBLY_SHIFT,'newAxialLength':new_length,
            'originalActualAxialBounds':[min(t for t,r in old),max(t for t,r in old)],
            'originalActualRadialBounds':[min(r for t,r in old),max(r for t,r in old)],
            'exactDuplicateVerticesWelded':exact_duplicate_count,'noSurvivingVertexMovedDuringWeld':True,
            'maximumRadialCoordinateRoundoff':maximum_radial_change,'maximumAxialCoordinateRoundoff':maximum_axial_rounding,
            'originalLocalMeshSha256':before,'compactedLocalMeshSha256':_digest(obj),
            'parentAndTransformUnchanged':obj.matrix_basis==basis,'radialDimensionsUnchangedByConstruction':True})
    for obj,point in markers:obj.location=point
    bpy.context.view_layer.update()
    return {'candidateOnly':True,'productionGeneratorIntegrated':False,'axisLineUnchanged':True,
        'assemblyAxisShift':ASSEMBLY_SHIFT,'changedMeshes':rows,'changedMarkers':[obj.name for obj,_ in markers],
        'requiresRealReconstruction':['RootCarrierBridge_L/R','RootFixedBearingPedestal_L/R','RootFairingFixed_L/R','RootFairingMoving_L/R','four main-wing finite cavities and their material ownership'],
        'claimBoundary':'No enclosure, support, full-motion, strength or manufacturing acceptance is implied. Independent source/runtime and material tests remain required.'}
