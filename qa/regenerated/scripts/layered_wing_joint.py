"""按标注重建圆顺分层翼根与真实移轴机构；所有尺寸为原创概念拟合。

固定翼和活动翼分别为闭合实体。活动翼上层按实际固定翼扫掠退让，
下层为独立构造并接回活动翼的连续薄盆；轮廓改变不等于已证明全程净空。
独立验收必须检查真实三角材料、分层截面、有限支承及完整运动。
"""
import math
import bisect
from functools import lru_cache
import os
import bpy
import bmesh
from mesh_precision import face_area
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
import kinematics
from embedded_joint_surfaces import joint_profile
from nacelle_wing_layout import CENTRAL_WING_LIFT, HINGE_LIFT, lift_fixed_wing, is_nacelle_root

HALF_GAP = .003
RELIEF_START_Y = -1.84
RELIEF_END_Y = -1.39
FRONT_RETREAT = .91
INNER_EDGE_X = .65
UPPER_REFERENCE_Z = -.17
SEAM_REFERENCE_PIVOT = (1.41,-1.41,-.22)
UPPER_RECESS = .012
PAN_GAP = .019
PAN_WALL = .010
FILLET_RADIUS = .060
FILLET_Y = (-1.5647568868,-1.4870875186)
FILLET_CENTER = (1.4506474197,-1.50814297614)
_MOVING_ENVELOPES = {}


def smooth(t):
    t=max(0.,min(1.,t))
    return t*t*(3-2*t)


def _axis_x(y,z,side=1,offset=0):
    origin=Vector((side*SEAM_REFERENCE_PIVOT[0],SEAM_REFERENCE_PIVOT[1],SEAM_REFERENCE_PIVOT[2]))
    axis=kinematics.wing_axis(side)
    lo,hi=.20,2.30
    for _ in range(48):
        x=(lo+hi)/2
        q=Vector((side*x,y,z))-origin
        t=q.dot(axis);r=(q-axis*t).length
        if t-joint_profile(r)-offset>0:lo=x
        else:hi=x
    return (lo+hi)/2


@lru_cache(maxsize=16384)
def reference_curve(y):
    """独立于最终主轴坐标的红线上缘；最外鼓点使用真实内切圆顺接。"""
    reference_x=_axis_x(y,UPPER_REFERENCE_Z)
    q=Vector((reference_x-SEAM_REFERENCE_PIVOT[0],y-SEAM_REFERENCE_PIVOT[1],UPPER_REFERENCE_Z-SEAM_REFERENCE_PIVOT[2]))
    axis=kinematics.wing_axis(1);radius=(q-axis*q.dot(axis)).length
    retreat=FRONT_RETREAT*(1-smooth((y-RELIEF_START_Y)/(RELIEF_END_Y-RELIEF_START_Y)))
    result=reference_x-retreat*smooth((radius-.16)/.14)
    a,b=FILLET_Y
    if a<y<b:
        xc,yc=FILLET_CENTER
        arc=xc+math.sqrt(max(0,FILLET_RADIUS**2-(y-yc)**2))
        weight=smooth((y-a)/.003)*smooth((b-y)/.003)
        result-=max(0,result-arc)*weight
    return result


def boundary_x(y,z,fixed,side=1):
    """固定上层按平面轮廓收边；活动上部按真实扫掠开口，盆底独立构造。"""
    curve=reference_curve(y)
    if fixed:return curve
    result=curve+UPPER_RECESS
    inner=INNER_EDGE_X+HALF_GAP
    if result<=inner:result=inner
    if result<inner+.04:
        t=(result-inner)/.04;result=inner+.04*t*t*(2-t)
    envelope=_MOVING_ENVELOPES.get(side)
    if envelope:
        ys,zs,grid=envelope['ys'],envelope['zs'],envelope['grid']
        if ys[0]<=y<=ys[-1] and zs[0]<=z<=zs[-1]:
            j=max(0,min(len(ys)-2,bisect.bisect_right(ys,y)-1))
            k=max(0,min(len(zs)-2,bisect.bisect_right(zs,z)-1))
            a=(y-ys[j])/(ys[j+1]-ys[j]);b=(z-zs[k])/(zs[k+1]-zs[k])
            value=(1-a)*((1-b)*grid[j][k]+b*grid[j][k+1])+a*((1-b)*grid[j+1][k]+b*grid[j+1][k+1])
            result=max(result,value)
    return result


def _build_swept_relief(side,obj):
    """按真实固定翼材料的反向扫掠给活动上皮减材，不把相交列入豁免。"""
    obj.data.calc_loop_triangles()
    points=[obj.matrix_world@v.co for v in obj.data.vertices]
    tree=BVHTree.FromPolygons(points,[tuple(t.vertices)for t in obj.data.loop_triangles],all_triangles=True)
    origin=kinematics.pivot_position(side)
    ys=sorted(set([-1.91+.01*j for j in range(108)]+[FILLET_Y[0]+(FILLET_Y[1]-FILLET_Y[0])*j/32 for j in range(33)]));zs=[-.32+.01*k for k in range(24)]
    grid=[[boundary_x(y,z,False,side) for z in zs]for y in ys]
    radial=max((p-origin-kinematics.wing_axis(side)*(p-origin).dot(kinematics.wing_axis(side))).length for p in points)
    samples=481;step=kinematics.FOLD_ANGLE/(samples-1)
    margin=.0015+radial*math.sin(step/2)
    hits=0
    for i in range(samples):
        rotation=kinematics.wing_rotation(side,1-i/(samples-1));inverse=rotation.inverted()
        direction=rotation@Vector((-side,0,0))
        for j,y in enumerate(ys):
            for k,z in enumerate(zs):
                start=origin+rotation@(Vector((side*2.20,y,z))-origin)
                hit,normal,index,distance=tree.ray_cast(start,direction,3.5)
                if hit is None:continue
                local=origin+inverse@(hit-origin)
                grid[j][k]=max(grid[j][k],side*local.x+margin);hits+=1
    # 轴孔边界使点射线包络出现陡变；只扩张上开口的相邻采样单元。
    # 连续薄盆独立构造，不再被这一步侵蚀。
    enlarged=[[max(grid[jj][kk] for jj in range(max(0,j-1),min(len(ys),j+2))
        for kk in range(max(0,k-1),min(len(zs),k+2))) for k in range(len(zs))] for j in range(len(ys))]
    report={'ys':ys,'zs':zs,'grid':enlarged,'angleSamples':samples,'angleRangeDegrees':[0,120],'rayHits':hits,'axialMargin':margin,'gridStep':.01,'neighborhoodCells':1,'panIsNotCutByUpperRelief':True,
            'claimBoundary':'真实三角材料驱动的有限角度保守减材；完整独立姿态检查另验，不宣称连续碰撞或制造公差证明'}
    _MOVING_ENVELOPES[side]=report
    if os.environ.get('TRANSWING_DEBUG_DIR'):
        import json
        json.dump(report,open(os.path.join(os.environ['TRANSWING_DEBUG_DIR'],'swept-envelope-'+str(side)+'.json'),'w'))
    print('完成活动翼扫掠开口',side,hits,flush=True)
    return report


def _triangulate(bm):
    """与翼腹采样一致地择优剖分四边面，避免固定对角线制造零面积耳片。"""
    bmesh.ops.triangulate(bm,faces=list(bm.faces),quad_method='BEAUTY',ngon_method='EAR_CLIP')


def _closed(obj):
    source=bmesh.new();source.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(source,faces=list(source.faces))
    bm=None;triangulation=None
    # 同一闭合多边面只选择合法的三角剖分，不改顶点、孔腔或检测门槛。
    for quad,ngon in [('BEAUTY','EAR_CLIP'),('ALTERNATE','EAR_CLIP'),('SHORT_EDGE','EAR_CLIP'),('BEAUTY','BEAUTY'),('ALTERNATE','BEAUTY'),('FIXED','EAR_CLIP')]:
        trial=source.copy();bmesh.ops.triangulate(trial,faces=list(trial.faces),quad_method=quad,ngon_method=ngon)
        if all(e.is_manifold for e in trial.edges) and all(face_area(f)>1e-18 for f in trial.faces):
            bm=trial;triangulation={'quad':quad,'ngon':ngon,'existingVertexCoordinatesUnchanged':True};break
        trial.free()
    if bm is None:bm=source.copy();_triangulate(bm)
    source.free()
    bad=sum(not e.is_manifold for e in bm.edges)
    zero=sum(face_area(f)<=1e-18 for f in bm.faces)
    volume=bm.calc_volume(signed=True)
    cleanup=None
    if not bad and zero:
        # 只对当前严格零面积面邻边使用既有1e−7构造合并尺度。
        # 必须保持闭合、无新增退化且体积差≤1e−13，不能用它吞掉实体薄壁。
        trial=bm.copy();faces=[f for f in trial.faces if face_area(f)<=1e-18]
        trial.verts.ensure_lookup_table();trial.verts.index_update()
        edges=sorted({e for f in faces for e in f.edges},key=lambda e:tuple(sorted(v.index for v in e.verts)))
        bmesh.ops.dissolve_degenerate(trial,edges=edges,dist=1e-7)
        _triangulate(trial)
        after=trial.calc_volume(signed=True)
        if all(e.is_manifold for e in trial.edges) and all(face_area(f)>1e-18 for f in trial.faces) and abs(after-volume)<=1e-13:
            cleanup={'zeroAreaFacesBefore':zero,'beforeVolume':volume,'afterVolume':after,'maximumConstructionDistance':1e-7,'maximumPermittedVolumeChange':1e-13}
            bm.free();bm=trial;zero=0;volume=after
        else:trial.free()
    if bad or zero or volume<=1e-10:
        if os.environ.get('TRANSWING_DEBUG_DIR'):
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.environ['TRANSWING_DEBUG_DIR'],'layered-topology-debug.blend'))
        raise ValueError('分层翼根必须是正体积闭合实体：'+obj.name+str((bad,zero,volume)))
    bm.to_mesh(obj.data);bm.free();obj.data.update()
    obj.data.set_sharp_from_angle(angle=math.radians(42))
    return {'node':obj.name,'volume':volume,'nonManifoldEdges':bad,'zeroAreaFaces':zero,'triangulation':triangulation,'zeroAreaConstructionCleanup':cleanup}


def _replace(old,new):
    old.data=new.data
    old.matrix_basis=new.matrix_basis.copy()
    bpy.data.objects.remove(new,do_unlink=True)
    return old


def _boolean(target,cutter,operation):
    bpy.context.view_layer.update()
    mod=target.modifiers.new('局部实体与原外翼保持相同连续材料','BOOLEAN')
    mod.operation=operation;mod.solver='EXACT';mod.object=cutter
    bpy.context.view_layer.objects.active=target;bpy.ops.object.modifier_apply(modifier=mod.name)


def _orient(obj):
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    if bm.calc_volume(signed=True)<0:bmesh.ops.reverse_faces(bm,faces=list(bm.faces))
    # 非平面翼型四边面与刀具网格先确定三角剖分，布尔后不得把折面重解为重叠扇面。
    _triangulate(bm)
    bm.to_mesh(obj.data);bm.free();obj.data.update()


def _keep_outer_wing(ctx,new,original,side):
    """仅重建翼根；外侧舵面切口与原远端三角材料保持。"""
    origin=kinematics.pivot_position(side)
    # 在既有共用翼型站位接合两个开放环，避免对完全共面的蒙皮再布尔。
    # 仅此截面的理论共同节点可合并，不能清理或放宽真实薄壁的判定门槛。
    cut_x=side*1.83-origin.x;normal=Vector((side,0,0))
    root=bmesh.new();root.from_mesh(new.data)
    far=bmesh.new();far.from_mesh(original.data)
    transform=new.matrix_basis.inverted()@original.matrix_basis
    bmesh.ops.transform(far,matrix=transform,verts=list(far.verts))
    for bm,inside in [(root,True),(far,False)]:
        bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
            dist=1e-7,plane_co=(cut_x,0,0),plane_no=normal,
            clear_outer=inside,clear_inner=not inside)
    old_ring=[v.co.copy() for v in far.verts if abs(v.co.x-cut_x)<1e-6]
    for vertex in root.verts:
        if abs(vertex.co.x-cut_x)>1e-6:continue
        closest=min(old_ring,key=lambda p:(p-vertex.co).length)
        if (closest-vertex.co).length>1e-6:raise ValueError('翼根共同截面环不匹配')
        vertex.co=closest
    data=bpy.data.meshes.new('翼外段实际材料');far.to_mesh(data);far.free()
    root.from_mesh(data);bpy.data.meshes.remove(data)
    seam=[v for v in root.verts if abs(v.co.x-cut_x)<1e-6]
    bmesh.ops.remove_doubles(root,verts=seam,dist=1e-7)
    bmesh.ops.recalc_face_normals(root,faces=list(root.faces))
    root.to_mesh(new.data);root.free();new.data.update()


def _make_lower_pan(ctx,side,stock,stations):
    """复用原翼腹的实际三角平面共同剖分，避免重采样跨面造成自交。

    可见下表面仅向材料内偏置1e-5，无旧下凹；上表面保留有限厚度。
    整个底面沿原翼腹；以顶部有限材料搭接，不再添加底面渐升。
    """
    from collections import namedtuple
    Point=namedtuple('PlanePoint','x y z')
    origin=kinematics.pivot_position(side);parent=stock.parent
    _orient(stock);stock.data.calc_loop_triangles()
    ys=sorted(set(round(y,10) for y in ([-1.86+.01*j for j in range(101)]+
        [-1.81+.0025*j for j in range(17)]+[-1.055+.0025*j for j in range(17)]+
        [FILLET_Y[0]+(FILLET_Y[1]-FILLET_Y[0])*j/32 for j in range(33)])))
    rows=[]
    for y in ys:
        curve=reference_curve(y)
        outer=max(curve+.13,max(boundary_x(y,z,False,side)for z in (-.28,-.26,-.24,-.22,-.20,-.18,-.16,-.14))+.055)
        if outer>1.80:raise ValueError('活动開口超出翼根接合域：'+str((side,y,outer)))
        full=smooth((y+1.795)/.015)*smooth((-1.015-y)/.035)
        rows.append({'y':y,'innerAbsX':INNER_EDGE_X+HALF_GAP+.020*(1-full),'outerAbsX':outer})
    def clip(poly,field):
        if not poly:return []
        out=[]
        for a,b in zip(poly,poly[1:]+poly[:1]):
            da,db=field(a),field(b);ia,ib=da>=0,db>=0
            if ia:out.append(a)
            if ia!=ib:
                t=da/(da-db);out.append(Point(*(a[i]+(b[i]-a[i])*t for i in range(3))))
        result=[]
        for p in out:
            if not result or math.dist(p,result[-1])>1e-11:result.append(p)
        if len(result)>1 and math.dist(result[0],result[-1])<=1e-11:result.pop()
        return result
    def planform(p,front):
        st=ctx['wing_station'](stations,side*p.x-origin.x)
        le=st[1]+origin.y
        return p.y-le-.020 if front else le+st[2]-.015-p.y
    vertices=[];faces=[];lookup={};max_residual=0.;source_triangles=0
    def add(p,j):
        a,b=rows[j],rows[j+1];t=(p.y-a['y'])/(b['y']-a['y'])
        outer=a['outerAbsX']+(b['outerAbsX']-a['outerAbsX'])*t
        full=smooth((p.y+1.795)/.015)*smooth((-1.015-p.y)/.035)
        wall=.003+(PAN_WALL-.003)*full
        # 固定自然底面，仅顶层进入原翼有限材料；无外接凸坡。
        lift=.00001
        q=(side*p.x-origin.x,p.y-origin.y,p.z-origin.z+lift,wall)
        key=tuple(round(v,10)for v in q)
        if key not in lookup:lookup[key]=len(vertices);vertices.append(q)
        return lookup[key]
    for triangle in stock.data.loop_triangles:
        if triangle.normal.z>=-1e-9:continue
        base=[Point(side*(stock.data.vertices[i].co.x+origin.x),stock.data.vertices[i].co.y+origin.y,stock.data.vertices[i].co.z+origin.z)for i in triangle.vertices]
        if max(p.y for p in base)<ys[0] or min(p.y for p in base)>ys[-1]:continue
        source_triangles+=1
        for j,(a,b)in enumerate(zip(rows,rows[1:])):
            if max(p.y for p in base)<a['y'] or min(p.y for p in base)>b['y']:continue
            poly=clip(base,lambda p:p.y-a['y']);poly=clip(poly,lambda p:b['y']-p.y)
            def bound(p,kind):
                t=(p.y-a['y'])/(b['y']-a['y']);v=a[kind]+(b[kind]-a[kind])*t
                return p.x-v if kind=='innerAbsX' else v-p.x
            poly=clip(poly,lambda p:bound(p,'innerAbsX'));poly=clip(poly,lambda p:bound(p,'outerAbsX'))
            poly=clip(poly,lambda p:planform(p,True));poly=clip(poly,lambda p:planform(p,False))
            if len(poly)<3:continue
            indices=[add(p,j)for p in poly]
            if len(set(indices))>=3:faces.append(tuple(indices))
    n=len(vertices);vv=[p[:3]for p in vertices]+[(x,y,z+wall)for x,y,z,wall in vertices]
    ff=faces+[tuple(n+i for i in reversed(f))for f in faces]
    edges={}
    for f in faces:
        for a,b in zip(f,f[1:]+f[:1]):edges.setdefault(tuple(sorted((a,b))),[]).append((a,b))
    if any(len(v)>2 for v in edges.values()):raise ValueError('原翼腹共同剖分不是流形')
    for edge,uses in edges.items():
        if len(uses)==1:
            a,b=uses[0];ff.append((b,a,n+a,n+b))
    pan=ctx['mesh_object']('Temporary_continuous_lower_pan',vv,ff,ctx['body'],parent)
    _orient(pan);_closed(pan)
    return pan,{'nominalWallThickness':PAN_WALL,'nominalCruiseVerticalGap':PAN_GAP,
        'lowerSurface':'exact original underside triangle planes plus 0.00001 inward offset; no downward relief',
        'inwardConstructionOffset':.00001,'centralWingVerticalLift':CENTRAL_WING_LIFT,
        'innerAbsX':INNER_EDGE_X+HALF_GAP,'maximumOuterAbsX':max(r['outerAbsX']for r in rows),
        'fullMaterialDomainY':[-1.78,-1.05],'targetCoveredOuterX':'reference_curve(Y)−.015，原真实翼平面轮廓及主轴孔除外',
        'connection':'原翼腹真实三角平面共同剖分；底面恒定自然曲面，顶部有限搭接并为同一闭合实体',
        'sourceUndersideTriangles':source_triangles,'outerJoinRowsBlender':rows,
        'streamlinedEnds':{'fullThicknessY':[-1.78,-1.05],'frontBlendY':[-1.795,-1.78],'aftBlendY':[-1.05,-1.015],
            'minimumEndWall':.003,'minimumEndVerticalGap':.006,'planformEdgeSetback':{'front':.020,'rear':.015},'maximumInnerCornerRetreat':.020,
            'construction':'C1厚度/内缘渐收，底面沿同一原翼腹真实平面；闭合收边'}}


def _cutter(ctx,side,fixed,parent=None):
    # 固定上层按名义平面曲线收边；活动上部用实际扫掠开口，网格覆盖整个翼根。
    ys=sorted(set([-3.0]+[-1.92+i*.01 for i in range(111)]+[FILLET_Y[0]+(FILLET_Y[1]-FILLET_Y[0])*j/32 for j in range(33)]+[1.0]))
    zs=[-2.0]+[-.40+i*.01 for i in range(37)]+[2.0]
    origin=kinematics.pivot_position(side) if parent else Vector()
    vertices=[]
    for inner in (False,True):
        for y in ys:
            for z in zs:
                x=.15 if inner else max(.16,boundary_x(y,z,fixed,side))
                vertices.append(tuple(Vector((side*x,y,z))-origin))
    ny,nz=len(ys),len(zs);n=ny*nz;faces=[]
    for j in range(ny-1):
        for k in range(nz-1):
            a=j*nz+k;b=a+nz
            faces.extend([(a,a+1,b+1,b),(n+a,n+b,n+b+1,n+a+1)])
    edge=list(range(nz))+[j*nz+nz-1 for j in range(1,ny)]+[(ny-1)*nz+k for k in range(nz-2,-1,-1)]+[j*nz for j in range(ny-2,0,-1)]
    for a,b in zip(edge,edge[1:]+edge[:1]):faces.append((a,b,n+b,n+a))
    cut=ctx['mesh_object']('Temporary_layered_joint_cutter',vertices,faces,None,parent,False)
    _orient(cut)
    return cut


def _clip(ctx,obj,side,fixed,cap=True):
    if not cap:
        # 开放涂层逐面裁切，保持真实表面而不添封口或悬浮厚片。
        origin=kinematics.pivot_position(side) if obj.parent else Vector()
        bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.triangulate(bm,faces=list(bm.faces))
        vertices=[];faces=[]
        def inside(p):
            q=p+origin
            d=side*q.x-boundary_x(q.y,q.z,fixed,side)
            return d<=0 if fixed else d>=0
        for face in bm.faces:
            poly=[v.co.copy() for v in face.verts];out=[]
            for a,b in zip(poly,poly[1:]+poly[:1]):
                aa,bb=inside(a),inside(b)
                if aa:out.append(a)
                if aa!=bb:
                    lo,hi=a.copy(),b.copy()
                    for _ in range(28):
                        mid=(lo+hi)/2
                        if inside(mid)==aa:lo=mid
                        else:hi=mid
                    out.append((lo+hi)/2)
            if len(out)>=3:
                start=len(vertices);vertices.extend(out);faces.append(tuple(range(start,start+len(out))))
        bm.free();obj.data.clear_geometry();obj.data.from_pydata(vertices,[],faces);obj.data.update()
        bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7);bm.normal_update();bm.to_mesh(obj.data);bm.free()
        return obj
    # 展向镜像改变原始环序。布尔前统一实体向外绕序，不能把左翼当补集。
    _orient(obj)
    cut=_cutter(ctx,side,fixed,obj.parent)
    bpy.context.view_layer.update()
    mod=obj.modifiers.new('连续曲面形成真实上下错层实体','BOOLEAN');mod.operation='INTERSECT' if fixed else 'DIFFERENCE';mod.solver='EXACT';mod.object=cut
    bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cut,do_unlink=True)
    return obj



def _orient_open_paint(obj,host):
    """仅翻转开放蓝皮的真实面绕序；原顶点、三角区域和开放边界严格不变。"""
    obj.data.calc_loop_triangles()
    vertices=[tuple(v.co)for v in obj.data.vertices]
    original=[tuple(t.vertices)for t in obj.data.loop_triangles]
    materials=[obj.data.polygons[t.polygon_index].material_index for t in obj.data.loop_triangles]
    smooth_faces=[obj.data.polygons[t.polygon_index].use_smooth for t in obj.data.loop_triangles]
    # 用完全相同的实际坐标建立邻接，可跨原上下皮的重复索引；不移动或合并顶点。
    edges={}
    for index,face in enumerate(original):
        for a,b in zip(face,face[1:]+face[:1]):
            pa,pb=vertices[a],vertices[b];key=tuple(sorted((pa,pb)))
            edges.setdefault(key,[]).append((index,pa==key[0]))
    if any(len(rows)>2 for rows in edges.values()):raise ValueError('蓝皮存在非流形边：'+obj.name)
    adjacency=[[]for _ in original];inconsistent_before=0
    for rows in edges.values():
        if len(rows)!=2:continue
        (a,da),(b,db)=rows;same=da==db
        inconsistent_before+=int(same)
        adjacency[a].append((b,same));adjacency[b].append((a,same))
    flips={0:False};pending=[0]
    while pending:
        a=pending.pop()
        for b,same in adjacency[a]:
            value=flips[a]^same
            if b in flips:
                if flips[b]!=value:raise ValueError('蓝皮不可连续定向：'+obj.name)
            else:flips[b]=value;pending.append(b)
    if len(flips)!=len(original):raise ValueError('蓝皮必须为单一连续面：'+obj.name)
    faces=[tuple(reversed(face))if flips[i]else face for i,face in enumerate(original)]
    bpy.context.view_layer.update();host.data.calc_loop_triangles()
    transform=obj.matrix_world.inverted()@host.matrix_world
    tree=BVHTree.FromPolygons([transform@v.co for v in host.data.vertices],
        [tuple(t.vertices)for t in host.data.loop_triangles],all_triangles=True)
    agreement=0.;area=0.
    for face in faces:
        a,b,c=(Vector(vertices[i])for i in face);normal=(b-a).cross(c-a)
        hit,outward,_,_=tree.find_nearest((a+b+c)/3)
        if hit is None:raise ValueError('蓝皮缺少真实翼皮法线参照：'+obj.name)
        agreement+=normal.dot(outward);area+=normal.length
    if abs(agreement)<area*.5:
        if os.environ.get('TRANSWING_DEBUG_DIR'):bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.environ['TRANSWING_DEBUG_DIR'],'paint-orientation-debug.blend'))
        raise ValueError('蓝皮外向参照不明确：'+obj.name+str((agreement,area,agreement/area)))
    if agreement<0:faces=[tuple(reversed(face))for face in faces]
    final_edges={}
    for face in faces:
        for a,b in zip(face,face[1:]+face[:1]):
            pa,pb=vertices[a],vertices[b];key=tuple(sorted((pa,pb)))
            final_edges.setdefault(key,[]).append(pa==key[0])
    inconsistent_after=sum(len(values)==2 and values[0]==values[1]for values in final_edges.values())
    if inconsistent_after:raise ValueError('蓝皮定向后仍有反向共享边：'+obj.name)
    obj.data.clear_geometry();obj.data.from_pydata(vertices,[],faces);obj.data.update()
    for face,material,is_smooth in zip(obj.data.polygons,materials,smooth_faces):
        face.material_index=material;face.use_smooth=is_smooth
    # 原自定义法线可能继承错误面向；先使用正确自动外法线，再由既有外皮采样整理。
    obj.data.normals_split_custom_set([(0.,0.,0.)for _ in obj.data.loops])
    obj.data.update();obj.data.calc_loop_triangles()
    assert vertices==[tuple(v.co)for v in obj.data.vertices],'蓝皮定向不得移动顶点'
    assert sorted(tuple(sorted(t))for t in original)==sorted(tuple(sorted(t.vertices))for t in obj.data.loop_triangles),'蓝皮定向不得改变真实三角区域'
    return {'node':obj.name,'inconsistentInteriorEdgesBefore':inconsistent_before,
        'inconsistentInteriorEdgesAfter':inconsistent_after,'verticesUnchanged':True,'unorientedTrianglesUnchanged':True,
        'openBoundaryUnchanged':True,'outwardHost':host.name,'areaWeightedOutwardAgreement':abs(agreement)/area,
        'method':'按实际相同坐标边传播一致绕序，再以闭合宿主翼皮真实外法线选择整体面向；不新增厚度或封口'}


def _rebase_child(obj,shift):
    # 只重基直属子节点；子树的局部关系、折桨和舵轴均保持。
    if obj.type=='MESH' and obj.matrix_basis==Matrix.Identity(4):
        obj.data.transform(Matrix.Translation(shift));obj.data.update()
    else:obj.location+=shift


def build_layered_wing_joint(ctx):
    print('开始重建连续分层翼根',flush=True)
    old_pivots={s:kinematics.pivot_position(s) for s in (-1,1)}
    old_anchor={s:kinematics.brace_wing_local(s) for s in (-1,1)}
    old_length=kinematics.brace_length(1)
    kinematics.use_authoring_reference(False)
    rows=[];rebased=[];moved=[];pans=[];paint_orientation=[]
    for side,sign in [('L',-1),('R',1)]:
        pivot=bpy.data.objects['WingPivot_'+side]
        origin=kinematics.pivot_position(sign);shift=old_pivots[sign]-origin
        for child in list(pivot.children):
            if child.name.startswith(('RootCarrier','BraceBall_','BraceBallPin_')) or child.name=='BraceWing_'+side:continue
            child_shift=shift.copy()
            if is_nacelle_root(child.name):child_shift.z=0.0
            _rebase_child(child,child_shift);rebased.append(child.name)
        pivot.location=origin
        fixed_axis_names={'RootAxisStart_'+side,'RootAxisEnd_'+side,'RootHingeShaft_'+side,'RootFixedBearingPedestal_'+side,
            *('RootHingeEndcap_'+side+value for value in ('-0.148','0.148')),
            *(prefix+side+'_'+end for prefix in ('RootBearingCenter_','RootBearingFixed_','RootBearingSeal_')for end in ('Front','Rear'))}
        if any(name not in bpy.data.objects or bpy.data.objects[name].parent is not None for name in fixed_axis_names):
            raise ValueError('固定主轴精确节点集合缺失或父级不符：'+side)
        for obj in bpy.data.objects:
            if obj.parent is None and obj.name in fixed_axis_names:
                obj.location-=shift;moved.append(obj.name)
        # 重建闭合主翼实体，原远端翼型、吊舱和所有舵面巡航外廓不位移。
        fixed=ctx['V12_FIXED_STATIONS'][side]
        stations=[(a+shift.x,b+shift.y,c,d+shift.z,e) for a,b,c,d,e in ctx['DETAIL_WING_STATIONS'][side]]
        ctx['DETAIL_WING_STATIONS'][side]=stations
        for name,st,parent,is_fixed in [('Fixed_root_'+side,fixed,None,True),('Composite_wing_'+side,stations,pivot,False)]:
            new=ctx['wing'](name+'生成临时实体',st,ctx['body'],parent)
            # 临时名字保留实际主翼采样规则，不依赖视觉细分掩盖折面。
            new.name=name+'__temporary'
            pan=None
            if not is_fixed:
                if os.environ.get('TRANSWING_DEBUG_DIR'):
                    import json
                    json.dump(st,open(os.path.join(os.environ['TRANSWING_DEBUG_DIR'],'pan-stations-'+side+'.json'),'w'))
                    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.environ['TRANSWING_DEBUG_DIR'],'before-pan-build-'+side+'.blend'))
                pan,pan_report=_make_lower_pan(ctx,sign,new,st);pans.append({'side':side,**pan_report})
            _clip(ctx,new,sign,is_fixed)
            if not is_fixed:_keep_outer_wing(ctx,new,bpy.data.objects[name],sign)
            if pan:
                _closed(new)
                if os.environ.get('TRANSWING_DEBUG_DIR'):
                    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.environ['TRANSWING_DEBUG_DIR'],'before-pan-union-'+side+'.blend'))
                _boolean(new,pan,'UNION');bpy.data.objects.remove(pan,do_unlink=True)
                _closed(new)
            ctx['shaft_bore'](new,origin-Vector((0,0,CENTRAL_WING_LIFT)) if is_fixed else Vector(),kinematics.wing_axis(sign))
            obj=_replace(bpy.data.objects[name],new)
            obj['layeredWingJoint']=True
            obj['jointRevision']=24
            obj['jointConstruction']='当前连续闭合错层翼根、真实轴孔与实际移轴；上下材料顺序须按当前三角面验证'
            obj['surfaceRefinementVersion']=24
            obj['normalMethod']='当前实体几何的定向平滑与独立孔缘、分缝法线；旧预构造解析统计失效'
            if is_fixed:
                from central_wing_attachment import _trim_root
                _trim_root(obj,sign)
                lift_fixed_wing(obj)
            cleanup=None;row=None
            if not is_fixed:
                from wing_seam import finish_wing_seam_topology
                row=_closed(obj)
                try:cleanup=finish_wing_seam_topology((obj.name,))
                except Exception:
                    if os.environ.get('TRANSWING_DEBUG_DIR'):
                        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.environ['TRANSWING_DEBUG_DIR'],'layered-topology-debug.blend'))
                    raise
            if row is None:row=_closed(obj)
            if cleanup:row['numericalShellCleanup']=cleanup
            rows.append(row)
            if is_fixed:_build_swept_relief(sign,obj)
        for name,st,parent,is_fixed,width in [('Fixed_root_blue_'+side,fixed,None,True,.12),('Wing_blue_leading_'+side,stations[:-2],pivot,False,.105)]:
            new=ctx['skin_band'](name+'__temporary',st,0,width,ctx['blue'],parent)
            _clip(ctx,new,sign,is_fixed,False)
            if is_fixed:lift_fixed_wing(new)
            obj=_replace(bpy.data.objects[name],new)
            obj['layeredWingJoint']=True
            if is_fixed:
                from central_wing_attachment import _taper_paint
                _taper_paint(obj,sign,ctx)
            host=bpy.data.objects[('Fixed_root_'if is_fixed else 'Composite_wing_')+side]
            paint_orientation.append(_orient_open_paint(obj,host))
        anchor=kinematics.brace_wing_local(sign)
        bpy.data.objects['BraceWing_'+side].location=anchor
        bpy.data.objects['BraceBall_'+side+'_Wing'].location=anchor
        pin=bpy.data.objects['BraceBallPin_'+side+'_Wing']
        pin.location+=anchor-old_anchor[sign]
        # 杆是单个定长刚体：更换实际端点间长度，不使用运行时拉伸。
        length=kinematics.brace_length(sign);delta=length-old_length
        for obj in bpy.data.objects['BraceRod_'+side].children:
            if obj.name=='BraceRod_mesh_'+side:
                local=obj.matrix_basis.inverted()
                for vertex in obj.data.vertices:
                    p=obj.matrix_basis@vertex.co
                    p.z=.034+(p.z-.034)*(length-.068)/(old_length-.068)
                    vertex.co=local@p
                obj.data.update()
            elif obj.name.endswith('_Root'):obj.location.z+=delta
        ctx['DETAIL_MANIFEST'].setdefault('layeredWingRebase',{})[side]=list(shift)
    bpy.context.view_layer.update()
    if len(moved)!=len(set(moved)):raise ValueError('同一固定轴部件不得重复移轴')
    # 这里还未生成内部驱动，先按实际球心求滑架和刚杆变换。
    yr=kinematics.slider_at(0)
    bpy.data.objects['BraceSpreader'].location=(0,yr,kinematics.SLIDER_Z)
    bpy.context.view_layer.update()
    for side in ('L','R'):
        a=bpy.data.objects['BraceBody_'+side].matrix_world.translation
        b=bpy.data.objects['BraceWing_'+side].matrix_world.translation
        rod=bpy.data.objects['BraceRod_'+side];rod.location=a;rod.rotation_mode='QUATERNION'
        rod.rotation_quaternion=kinematics.rod_rotation(b-a,bpy.data.objects['WingPivot_'+side].matrix_world.to_3x3()@Vector((0,0,1)))
        rod.scale=(1,1,1)
    return {'conceptOnly':True,'source':'用户标注的连续红色边界、黄色移轴箭头及蓝色杆端内移指示；未使用原厂CAD或尺寸推断',
            'construction':'固定中央翼上下皮同量上移，活动翼底沿原自然翼腹三角共同剖分、取消下凹；上部按固定翼真实扫掠让位，真实主轴与固定翼同量抬升保持原通孔关系',
            'boundaryFunction':'boundary_x(y,z,fixed)，实际采样和导出三角面另验',
            'parameters':{'frontRetreat':FRONT_RETREAT,'reliefStartY':RELIEF_START_Y,'reliefEndY':RELIEF_END_Y,'upperReferenceZ':UPPER_REFERENCE_Z,'referenceRadialBlend':[.16,.30],'curveReferencePivot':list(SEAM_REFERENCE_PIVOT),'filletRadius':FILLET_RADIUS,'filletY':list(FILLET_Y),'filletCenter':list(FILLET_CENTER),'upperRecess':UPPER_RECESS,'movingInnerEdgeAbsX':INNER_EDGE_X+HALF_GAP,'innerEdgeTransitionWidth':.04},
            'lowerPans':pans,'openPaintOrientation':paint_orientation,
            'design':{'curveKnotsBlender':[{'y':y,'absX':reference_curve(y)}for y in sorted(set([-1.86+.005*j for j in range(201)]+list(FILLET_Y)+[FILLET_CENTER[1]]))],
                'panDomainBlender':{'y':[-1.78,-1.05],'innerAbsX':INNER_EDGE_X+HALF_GAP,'outerInsetFromCurve':.015},
                'nominalPanThickness':PAN_WALL,'nominalCruiseVerticalGap':PAN_GAP,'actualBoreRadius':.045,'unitBoundary':'全部为模型单位，不代表经认证CAD尺寸或制造公差'},
            'oldPivotBlender':list(kinematics.REFERENCE_PIVOT),'newRightPivotBlender':list(kinematics.pivot_position(1)),
            'wingAnchorCruiseBlender':list(kinematics.WING_ANCHOR_CRUISE),'braceLength':kinematics.brace_length(1),
            'sliderTravel':[kinematics.slider_at(0),kinematics.slider_at(1)],'rebasedDirectChildren':rebased,'translatedFixedAxisNodes':moved,'closedWingSolids':rows,'sweptUpperRelief':{str(side):data for side,data in _MOVING_ENVELOPES.items()},
            'cruiseOuterAssemblyPreserved':True,'cruiseOuterAssemblyPreservedScope':'仅layeredWingJoint本构造步骤前后；最终动力节点再按nacelleLayout成组位移','fullStrokeRequiresNewCollisionEvidence':True,
            'claimBoundary':'有限样本概念机构；不证明连续碰撞、制造公差、强度或适航'}
