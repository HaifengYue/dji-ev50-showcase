"""Bounded, remove-only root lip refinement of the current native Transwing scene.

Only the supplied bpy scene is used. No historical geometry is reconstructed.
Call ``refine_center_wing(scene=None)`` from a composed native refinement. The CLI
writes only an explicitly supplied candidate path and never overwrites xp4.blend.
Coordinates and radii below are concept model units, not certified dimensions.
"""
from pathlib import Path
import bpy, bmesh, json, math, hashlib, sys
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

OWNERS = ('Fuselage', 'Fixed_root_L', 'Fixed_root_R', 'Composite_wing_L', 'Composite_wing_R')
# Smooth, C1 joined planform arc. A Boolean DIFFERENCE makes every change
# subtractive even where a sampled arc is outside the old skin.
PROFILE = ((.535, -.8947777778, -.1555555556),
           (.620, -.942, -.90),
           (.700, -1.022, -.88),
           (.780, -1.071, -.69),
           (.823, -1.0945, -.69))
TIP_CENTER = (.690, -1.014)
TIP_RADIUS = .032


def _profile(x):
    for (a,ya,da),(b,yb,db) in zip(PROFILE, PROFILE[1:]):
        if x <= b + 1e-12:
            u=(x-a)/(b-a); h=b-a
            y=(2*u**3-3*u*u+1)*ya+(u**3-2*u*u+u)*h*da+(-2*u**3+3*u*u)*yb+(u**3-u*u)*h*db
            d=(6*u*u-6*u)*ya/h+(3*u*u-4*u+1)*da+(-6*u*u+6*u)*yb/h+(3*u*u-2*u)*db
            return y,d
    return PROFILE[-1][1:]


def _world_verts(obj):
    return [obj.matrix_world@v.co for v in obj.data.vertices]


def _mesh_stats(obj):
    me=obj.data; me.calc_loop_triangles(); bm=bmesh.new();bm.from_mesh(me)
    volume=bm.calc_volume(signed=True)
    bad_edges=sum(not e.is_manifold for e in bm.edges)
    bad_orientation=sum(e.is_manifold and not e.is_contiguous for e in bm.edges)
    bm.free()
    normals=[n.vector for n in me.corner_normals]
    areas=[t.area for t in me.loop_triangles]
    return dict(vertices=len(me.vertices), polygons=len(me.polygons), triangles=len(me.loop_triangles),
                volume=volume, nonmanifoldEdges=bad_edges, inconsistentEdges=bad_orientation,
                degenerateTriangles=sum(a<=1e-18 for a in areas), minimumTriangleArea=min(areas),
                customNormals=me.has_custom_normals, smoothFaces=sum(p.use_smooth for p in me.polygons),
                flatFaces=sum(not p.use_smooth for p in me.polygons),
                invalidOrZeroCornerNormals=sum(not all(math.isfinite(c) for c in n) or n.length<.5 for n in normals),
                sharpEdges=sum(e.use_edge_sharp for e in me.edges))


def _prism(name,outline,z0=-.31,z1=-.13):
    # Coordinates are authored in WORLD space, including moving-owner cuts.
    N=len(outline);vs=[(x,y,z(x,y) if callable(z) else z) for z in (z0,z1) for x,y in outline]
    fs=[tuple(reversed(range(N))),tuple(range(N,2*N))]
    fs += [(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)]
    me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.update()
    bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    if callable(z0):bmesh.ops.triangulate(bm,faces=list(bm.faces),quad_method='BEAUTY',ngon_method='BEAUTY')
    bm.to_mesh(me);bm.free()
    ob=bpy.data.objects.new(name,me);bpy.context.scene.collection.objects.link(ob)
    return ob


def _subtract(obj,cutter):
    # Work in the owner's exact native local coordinate frame. Applying an
    # Exact Boolean through a translated parent needlessly round-trips every
    # untouched vertex through Float32 world coordinates, collapsing tiny native
    # features far from this cut. Neither parent nor native TRS is baked.
    original_world=obj.matrix_world.copy();parent=obj.parent
    original_mesh=obj.data.copy()
    face_attr=obj.data.attributes.new('__root_face_id','INT','FACE')
    for p in obj.data.polygons:face_attr.data[p.index].value=p.index+1
    point_attr=obj.data.attributes.new('__root_point_id','INT','POINT')
    for v in obj.data.vertices:point_attr.data[v.index].value=v.index+1
    pinv=obj.matrix_parent_inverse.copy();loc=obj.location.copy()
    quat=obj.rotation_quaternion.copy();euler=obj.rotation_euler.copy();scale=obj.scale.copy()
    cutter.data.transform(original_world.inverted())
    obj.parent=None;obj.matrix_world=Matrix.Identity(4)
    bpy.context.view_layer.update();bpy.context.view_layer.objects.active=obj
    try:
        mod=obj.modifiers.new('Bounded root relief (subtractive)','BOOLEAN')
        mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
        bpy.ops.object.modifier_apply(modifier=mod.name)
        _restore_uncut_domains(obj,original_mesh,cutter)
        bm=bmesh.new();bm.from_mesh(obj.data)
        targets={}
        for edge in bm.edges:
            a,b=edge.verts
            if tuple(a.co)==tuple(b.co):targets[b]=a
        groups={}
        for v in bm.verts:
            key=tuple(v.co)
            if key in groups:targets[v]=groups[key]
            else:groups[key]=v
        if targets:
            bmesh.ops.weld_verts(bm,targetmap=targets);bm.to_mesh(obj.data);obj.data.update()
        bm.free()
    finally:
        obj.parent=parent;obj.matrix_parent_inverse=pinv
        obj.location=loc;obj.rotation_quaternion=quat;obj.rotation_euler=euler;obj.scale=scale
        cutter.data.transform(original_world)
        bpy.context.view_layer.update()
        if not original_mesh.users:bpy.data.meshes.remove(original_mesh)


def _restore_uncut_domains(obj, original, cutter):
    """Reinsert exact original polygons outside the cutter's local AABB.

    Boolean solvers may retessellate unrelated non-planar native n-gons. Face
    provenance lets this operation retain their exact oriented polygon domains,
    coordinates and normals rather than accepting collateral skin changes.
    """
    me=obj.data
    cv=[v.co for v in cutter.data.vertices]
    lo=[min(v[i] for v in cv)-1e-8 for i in range(3)]
    hi=[max(v[i] for v in cv)+1e-8 for i in range(3)]
    restore=set()
    for p in original.polygons:
        vv=[original.vertices[i].co for i in p.vertices]
        if any(max(v[j] for v in vv)<lo[j] or min(v[j] for v in vv)>hi[j] for j in range(3)):
            restore.add(p.index)
    fa=me.attributes['__root_face_id'];va=me.attributes['__root_point_id']
    verts=[tuple(v.co) for v in original.vertices];lookup={v:i for i,v in enumerate(verts)}
    remap={}
    for v in me.vertices:
        co=tuple(v.co);src=va.data[v.index].value-1
        if 0<=src<len(verts) and verts[src]==co:remap[v.index]=src
        elif co in lookup:remap[v.index]=lookup[co]
        else:remap[v.index]=len(verts);lookup[co]=len(verts);verts.append(co)
    rows=[];norms=[];sharp=set()
    for p in original.polygons:
        if p.index in restore:
            rows.append((list(p.vertices),p.use_smooth,p.material_index))
            norms.extend(tuple(original.corner_normals[li].vector) for li in p.loop_indices)
    for p in me.polygons:
        source=fa.data[p.index].value-1
        if source not in restore:
            rows.append(([remap[i] for i in p.vertices],p.use_smooth,p.material_index))
            norms.extend(tuple(me.corner_normals[li].vector) for li in p.loop_indices)
    for edge in original.edges:
        if edge.use_edge_sharp:sharp.add(tuple(sorted(edge.vertices)))
    for edge in me.edges:
        if edge.use_edge_sharp:sharp.add(tuple(sorted(remap[i] for i in edge.vertices)))
    # Remove only now-unused points; preserve distinct native vertex identities.
    used=sorted({i for ids,sm,mat in rows for i in ids});newidx={v:i for i,v in enumerate(used)}
    fresh=bpy.data.meshes.new(me.name+' bounded domains')
    fresh.from_pydata([verts[i] for i in used],[],[[newidx[i] for i in ids] for ids,sm,mat in rows])
    for m in me.materials:fresh.materials.append(m)
    for p,(_,smooth,mat) in zip(fresh.polygons,rows):p.use_smooth=smooth;p.material_index=mat
    for e in fresh.edges:e.use_edge_sharp=tuple(sorted(used[i] for i in e.vertices)) in sharp
    fresh.normals_split_custom_set(norms);fresh.update();obj.data=fresh
    obj['rootOriginalFarFacesPreserved']=len(restore)
    if not me.users:bpy.data.meshes.remove(me)


def _delete_cutter(obj):
    me=obj.data;bpy.data.objects.remove(obj,do_unlink=True)
    if not me.users:bpy.data.meshes.remove(me)


def _source_state(obj):
    me=obj.data;me.calc_loop_triangles();wv=_world_verts(obj)
    tris=[tuple(t.vertices) for t in me.loop_triangles]
    corner_map={}
    for p in me.polygons:
        face_key=tuple(sorted(tuple(me.vertices[i].co) for i in p.vertices))
        for li in p.loop_indices:
            key=tuple(me.vertices[me.loops[li].vertex_index].co)
            corner_map.setdefault(key,[]).append((face_key,me.corner_normals[li].vector.copy()))
    return dict(polygonKeys={tuple(sorted(tuple(me.vertices[i].co) for i in p.vertices)) for p in me.polygons},vertexKeys={tuple(v.co) for v in me.vertices},cornerMap=corner_map,vertices=wv,triangles=tris,bvh=BVHTree.FromPolygons(wv,tris,all_triangles=True,epsilon=0),
                stats=_mesh_stats(obj))


def _normal_repair(obj, moving=False, source_state=None):
    """Separate skin and relief-wall normals only in the edited root vicinity.

    Existing split normals elsewhere are copied verbatim. The local smooth skin
    field is a robust cubic least-squares fit to the *current native* skin, with
    independent upper/lower fits. This avoids averaging thin walls into the skin.
    New planar cut walls have their analytic planform normals, never skin normals.
    """
    me=obj.data;me.update();wv=_world_verts(obj)
    norms=[n.vector.copy() for n in me.corner_normals]
    restored=0
    corner_map=source_state['cornerMap']
    for p in me.polygons:
        face_key=tuple(sorted(tuple(me.vertices[i].co) for i in p.vertices))
        if any(norms[li].length<.5 for li in p.loop_indices):
            p.use_smooth=True
            for li in p.loop_indices:me.edges[me.loops[li].edge_index].use_edge_sharp=False
        for li in p.loop_indices:
            key=tuple(me.vertices[me.loops[li].vertex_index].co)
            records=corner_map.get(key,[])
            exact=[n for f,n in records if f==face_key]
            if exact:
                norms[li]=exact[0].copy();restored+=1
            elif norms[li].length<.5:
                valid=[n for f,n in records if n.length>.5]
                if valid:norms[li]=valid[0].copy();restored+=1
    world_normal=obj.matrix_world.to_3x3().inverted().transposed()
    local_normal=world_normal.inverted()
    changed_faces=set();wall_faces=set();fit_reports=[]
    def local_patch(p):
        return .53<=abs(p.x)<=1.055 and -1.205<=p.y<=-.885 and -.285<=p.z<=-.135
    def design(x,y):
        X=(x-.80)/.25;Y=(y+1.07)/.15
        return [1,X,Y,X*X,X*Y,Y*Y,X**3,X*X*Y,X*Y*Y,Y**3]
    poly_world_normal={p.index:(world_normal@p.normal).normalized() for p in me.polygons}
    def smoothstep(a,b,x):
        t=max(0.,min(1.,(x-a)/(b-a)));return t*t*(3-2*t)
    def blend_weight(v):
        return (smoothstep(.53,.555,abs(v.x))*(1-smoothstep(.97,1.055,abs(v.x))) *
                smoothstep(-1.205,-1.175,v.y)*(1-smoothstep(-.915,-.885,v.y)))
    for sign in (1,-1):
        polys=[p for p in me.polygons if poly_world_normal[p.index].z*sign>.76 and all(local_patch(wv[i]) for i in p.vertices)]
        ids=sorted({i for p in polys for i in p.vertices})
        if len(ids)<20:continue
        # The native sampled wing skin is smooth away from its old wall-normal
        # mixing. Robust fit rejects tiny closure wedges, rather than flattening
        # their geometry or extending a fit into the original hinge envelope.
        P=np.asarray([[abs(wv[i].x),wv[i].y,wv[i].z] for i in ids]);A=np.array([design(x,y) for x,y,z in P]);z=P[:,2]
        weights=np.ones(len(z))
        for _ in range(5):
            coeff=np.linalg.lstsq(A*weights[:,None],z*weights,rcond=None)[0]
            residual=z-A@coeff;scale=max(float(np.median(abs(residual)))*1.4826,.0002)
            weights=np.minimum(1,2.5*scale/np.maximum(abs(residual),1e-10))
        rms=float(np.sqrt(np.mean(residual**2)))
        used=0
        application_polys=[p for p in me.polygons if poly_world_normal[p.index].z*sign>.76 and any(local_patch(wv[i]) for i in p.vertices)]
        for p in application_polys:
            # Do not repurpose steep actual closure faces as smooth skin.
            for li in p.loop_indices:
                co=wv[me.loops[li].vertex_index]
                if not local_patch(co):continue
                X=(abs(co.x)-.8)/.25;Y=(co.y+1.07)/.15;c=coeff
                dx=(c[1]+2*c[3]*X+c[4]*Y+3*c[6]*X*X+2*c[7]*X*Y+c[8]*Y*Y)/.25
                dy=(c[2]+c[4]*X+2*c[5]*Y+c[7]*X*X+2*c[8]*X*Y+3*c[9]*Y*Y)/.15
                nn=Vector((-dx*(1 if co.x>=0 else -1),-dy,1)).normalized()*sign
                if nn.dot(poly_world_normal[p.index])>.75:
                    target=(local_normal@nn).normalized();w=blend_weight(co);original=norms[li]
                    if original.length<.5:original=target
                    norms[li]=(original*(1-w)+target*w).normalized();used+=1
            p.use_smooth=True;changed_faces.add(p.index)
        fit_reports.append(dict(side=sign,sampleVertices=len(ids),fitRMS=rms,repairedCorners=used))
    for p in me.polygons:
        coords=[wv[i] for i in p.vertices]
        if not all(local_patch(v) for v in coords):continue
        # A generated cut has a constant planform contour through thickness.
        if moving:
            onwall=all(abs(math.hypot(abs(v.x)-TIP_CENTER[0],v.y-TIP_CENTER[1])-TIP_RADIUS)<2e-5 for v in coords)
            def wn(v):
                return Vector((-(abs(v.x)-TIP_CENTER[0])*(1 if v.x>=0 else -1),-(v.y-TIP_CENTER[1]),0)).normalized()
        else:
            onwall=all(PROFILE[0][0]-1e-6<=abs(v.x)<=PROFILE[-1][0]+1e-6 and abs(v.y-_profile(abs(v.x))[0])<3e-5 for v in coords)
            def wn(v):
                d=_profile(abs(v.x))[1]
                return Vector((-d*(1 if v.x>=0 else -1),1,0)).normalized()
        if onwall and abs(poly_world_normal[p.index].z)<.1:
            for li in p.loop_indices:norms[li]=(local_normal@wn(wv[me.loops[li].vertex_index])).normalized()
            p.use_smooth=True;wall_faces.add(p.index);changed_faces.add(p.index)
    edge_faces={}
    for p in me.polygons:
        for li in p.loop_indices:edge_faces.setdefault(me.loops[li].edge_index,[]).append(p.index)
    for ei,fs in edge_faces.items():
        if len(fs)==2 and bool(fs[0] in wall_faces)!=bool(fs[1] in wall_faces):me.edges[ei].use_edge_sharp=True
    me.normals_split_custom_set(norms);me.update()
    # Blender can give a zero normal-space to Float32 sliver faces already in
    # the native. Use an incident finite face field for only those vertices.
    repaired_sliver_vertices=set()
    for _ in range(2):
        invalid=[li for li,n in enumerate(me.corner_normals) if n.vector.length<.5]
        if not invalid:break
        badverts={me.loops[li].vertex_index for li in invalid};repaired_sliver_vertices|=badverts
        fallback={v:Vector((0,0,0)) for v in badverts}
        for p in me.polygons:
            for vi in p.vertices:
                if vi in badverts and p.normal.length>.5:fallback[vi]+=p.normal*max(p.area,1e-12)
        for p in me.polygons:
            if any(vi in badverts for vi in p.vertices):p.use_smooth=True
            for li in p.loop_indices:
                vi=me.loops[li].vertex_index
                if vi in badverts:norms[li]=fallback[vi].normalized()
        for e in me.edges:
            if any(vi in badverts for vi in e.vertices):e.use_edge_sharp=False
        me.normals_split_custom_set(norms);me.update()
    return dict(sliverNormalVertices=len(repaired_sliver_vertices),sourceCornerNormalsRestored=restored,repairedFaces=len(changed_faces),analyticCutWallFaces=len(wall_faces),skinFits=fit_reports,
                untouchedRegionCornerNormalsCopied=True)


def _containment(obj,state):
    """Every output corner and triangle centroid must be on/inside old solid.

    Exact difference is the constructive no-inflation guarantee. This independent
    signed-nearest check adds a finite numerical witness; it is not a continuous
    collision proof for the aircraft.
    """
    me=obj.data;me.calc_loop_triangles();wv=_world_verts(obj)
    same_faces={p.index for p in me.polygons if tuple(sorted(tuple(me.vertices[i].co) for i in p.vertices)) in state['polygonKeys']}
    pts=[wv[v.index] for v in me.vertices if tuple(v.co) not in state['vertexKeys']]
    # Test all changed output vertices and three interior barycentric witnesses per face.
    for t in me.loop_triangles:
        if t.polygon_index in same_faces:continue
        a,b,c=[wv[i] for i in t.vertices]
        if .52<abs((a.x+b.x+c.x)/3)<1.06 and -.89>(a.y+b.y+c.y)/3>-1.21:
            pts.extend(((a+b+c)/3,a*.6+b*.2+c*.2,a*.2+b*.6+c*.2,a*.2+b*.2+c*.6))
    maxout=0.;outside=[]
    for p in pts:
        near,n,index,dist=state['bvh'].find_nearest(p)
        signed=(p-near).dot(n)
        if signed>maxout:maxout=signed
        if signed>2e-6:
            # At concave native relief edges a nearest triangle's one-sided
            # plane is not an inside test. Require three independent outward
            # first-hit ray witnesses before classifying that corner as inside.
            votes=[]
            for direction in (Vector((.317,.613,.723)),Vector((-.577,.211,.789)),Vector((.741,-.611,-.279))):
                direction.normalize();hit,hn,_,hd=state['bvh'].ray_cast(p,direction,100)
                votes.append(hit is not None and hn.dot(direction)>0)
            if not all(votes):outside.append((tuple(p),signed,votes))
    return dict(exactOriginalPolygonDomains=len(same_faces),samples=len(pts),maxSignedOutsideDistance=maxout,violationsBeyond2e6=len(outside),firstViolations=outside[:5])


def refine_center_wing(scene=None):
    scene=scene or bpy.context.scene
    if scene.get('centerWingSmoothing20261008'):
        raise RuntimeError('Center-wing refinement is already present; reload the current native before retrying.')
    source={n:_source_state(bpy.data.objects[n]) for n in OWNERS}
    node_names=set(bpy.data.objects.keys())
    reports={}
    xs=[PROFILE[0][0]+(PROFILE[-1][0]-PROFILE[0][0])*i/112 for i in range(113)]
    for sign,side in ((1,'R'),(-1,'L')):
        outline=[(sign*x,_profile(x)[0]) for x in xs]+[(sign*xs[-1],-.82),(sign*xs[0],-.82)]
        cutter=_prism('Temporary central lip cutter '+side,outline)
        for n in ('Fuselage','Fixed_root_'+side):_subtract(bpy.data.objects[n],cutter)
        _delete_cutter(cutter)
        outline=[(sign*(TIP_CENTER[0]+TIP_RADIUS*math.cos(2*math.pi*i/128)),TIP_CENTER[1]+TIP_RADIUS*math.sin(2*math.pi*i/128)) for i in range(128)]
        cutter=_prism('Temporary notch fillet cutter '+side,outline)
        _subtract(bpy.data.objects['Composite_wing_'+side],cutter);_delete_cutter(cutter)
    for n in OWNERS:
        obj=bpy.data.objects[n]
        obj.data.calc_loop_triangles()
        normal_report=_normal_repair(obj,n.startswith('Composite_wing'),source[n])
        stats=_mesh_stats(obj);before=source[n]['stats'];containment=_containment(obj,source[n])
        assert stats['nonmanifoldEdges']==0,(n,stats)
        assert stats['inconsistentEdges']==0,(n,stats)
        assert stats['degenerateTriangles']==0,(n,stats)
        assert stats['volume']>0 and stats['volume']<before['volume'],(n,before['volume'],stats['volume'])
        assert containment['violationsBeyond2e6']==0,(n,containment)
        assert stats['invalidOrZeroCornerNormals']<=before['invalidOrZeroCornerNormals'],(n,stats)
        reports[n]=dict(before=before,after=stats,removedVolume=before['volume']-stats['volume'],containment=containment,normals=normal_report)
        obj['centerWingRefinement']='2026-10-08 bounded subtractive lip fillet and local split-normal repair'
    assert set(bpy.data.objects.keys())==node_names
    report=dict(schema='transwing.center-wing-subtractive-refinement.v1',modifiedOwners=list(OWNERS),
                sourceOnly='Current loaded native bpy scene, no historical geometry input',
                operations='Exact Boolean DIFFERENCE only; no inflation, no sealing, no global subdivision',
                profile=PROFILE,tipCenter=TIP_CENTER,tipRadius=TIP_RADIUS,tipCircleSegments=128,
                cutZBounds=[-.31,-.13],reports=reports,
                existingLowAngleReliefPreserved=True,
                noPocketFloorThinned=True,
                residualRelief='Native stepped low-angle clearance remains near abs(x)=0.78 to 0.92, y=-1.11 to -1.04. Deeper removal was rejected to avoid weakening the 0.01 main-wall constraint.',
                clearanceNote='Removing material cannot create a new solid intersection when originals are subsets. Full composed motion checks are still required.',
                finiteWitnessNotContinuousProof=True)
    scene['centerWingSmoothing20261008']=json.dumps(report,separators=(',',':'))
    return report


if __name__=='__main__':
    import argparse
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);parser.add_argument('--report',required=True);opts=parser.parse_args(args)
    out=Path(opts.output).resolve();source=Path(bpy.data.filepath).resolve()
    if out==source or out.name=='xp4.blend':raise RuntimeError('Refusing to overwrite the native source')
    report=refine_center_wing();report['inputSha256']=hashlib.sha256(source.read_bytes()).hexdigest()
    out.parent.mkdir(parents=True,exist_ok=True);bpy.ops.wm.save_as_mainfile(filepath=str(out),compress=True)
    report['outputSha256']=hashlib.sha256(out.read_bytes()).hexdigest();Path(opts.report).write_text(json.dumps(report,indent=2)+'\n')
    print('CENTER_WING_REFINEMENT_PASSED',str(out))
