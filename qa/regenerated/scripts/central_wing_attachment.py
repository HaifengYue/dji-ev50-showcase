"""V13 固定中翼／机腹连续接合：依据可见外观进行原创重建。
浅鞍面与已有空心机身作实体合并，不添加不可见翼梁或新机构。
保留的固定翼通过完全相同的翼型截面相接，不用实体穿插掩盖接缝。
"""
import math
import bpy
import bmesh
from mathutils import Vector
from wing_surfaces import ROOT_LOFT, densify_root, nose_section

JOIN_X = .62
PAINT_INNER_X = .44
CENTER_LOFT = [(0., -.520, .960, .043, .112), (.135, -.530, .976, .038, .122)] + [r for r in ROOT_LOFT if r[0] <= JOIN_X]


def _key(v):
    return tuple(round(float(x), 8) for x in v)


def _corner_snapshot(obj):
    """保留未修改三角面的原角点法线，包括真实锐边的独立分支。"""
    normals = [n.vector.copy() for n in obj.data.corner_normals]
    return {tuple(sorted(_key(obj.data.vertices[i].co) for i in f.vertices)):
            {_key(obj.data.vertices[obj.data.loops[j].vertex_index].co): normals[j]
             for j in f.loop_indices} for f in obj.data.polygons}


def _restore_untouched_normals(obj, saved):
    current = [n.vector.copy() for n in obj.data.corner_normals]
    changed = 0
    for f in obj.data.polygons:
        old = saved.get(tuple(sorted(_key(obj.data.vertices[i].co) for i in f.vertices)))
        if old is None:
            continue
        for j in f.loop_indices:
            current[j] = old[_key(obj.data.vertices[obj.data.loops[j].vertex_index].co)]
            changed += 1
    obj.data.normals_split_custom_set(current)
    obj.data.update()
    return changed


def _boolean(target, cutter, operation, label):
    bpy.context.view_layer.update()
    mod = target.modifiers.new(label, 'BOOLEAN')
    mod.operation = operation
    mod.solver = 'EXACT'
    mod.object = cutter
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=mod.name)


def _trim_root(obj, sign):
    old = _corner_snapshot(obj)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    result = bmesh.ops.bisect_plane(bm, geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
                                  dist=1e-7, plane_co=(sign*JOIN_X, 0, 0),
                                  plane_no=(sign, 0, 0), clear_inner=True, clear_outer=False)
    edges = [e for e in result['geom_cut'] if isinstance(e, bmesh.types.BMEdge) and e.is_boundary]
    if edges:
        bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    restored = _restore_untouched_normals(obj, old)
    return {'node': obj.name, 'sharedSectionAbsX': JOIN_X, 'restoredUnchangedCorners': restored,
            'method': 'remove inward geometry and close exact original airfoil section; zero intentional overlap'}


def _taper_paint(obj, sign, context):
    """将已有开放涂层裁为平顺收尖的色边，不制造横贯机腹的蓝条。"""
    old = _corner_snapshot(obj)
    stations = context['V12_FIXED_STATIONS'][obj.name[-1]]
    obj.data.calc_loop_triangles()
    old_normals=[n.vector.copy() for n in obj.data.corner_normals]
    source_triangles=[]
    for triangle in obj.data.loop_triangles:
        points=[obj.data.vertices[i].co.copy() for i in triangle.vertices]
        source_triangles.append(points)
        old[tuple(sorted(_key(p) for p in points))]={_key(p):old_normals[li] for p,li in zip(points,triangle.loops)}
    verts, faces = [], []
    def signed(p):
        if sign*p.x>=JOIN_X-1e-8:return 1.
        st = context['wing_station'](stations, p.x)
        u = (p.y-st[1])/st[2]
        t = max(0., min(1., (sign*p.x-PAINT_INNER_X)/(JOIN_X-PAINT_INNER_X)))
        # 保留原前缘涂层偏移，将内端收成连续的尖圆色边。
        width = .12*t*t*(3-2*t)
        return min(sign*p.x-PAINT_INNER_X, width-max(0.,u))
    for poly in source_triangles:
        out = []
        for a,b in zip(poly, poly[1:]+poly[:1]):
            ia,ib = signed(a)>=-1e-12, signed(b)>=-1e-12
            if ia: out.append(a)
            if ia != ib:
                lo,hi = a.copy(),b.copy()
                for _ in range(34):
                    mid=(lo+hi)/2
                    if (signed(mid)>=-1e-12)==ia: lo=mid
                    else: hi=mid
                out.append((lo+hi)/2)
        if len(out)>=3:
            start=len(verts);verts.extend(out);faces.append(tuple(range(start,start+len(out))))
    obj.data.clear_geometry();obj.data.from_pydata(verts,[],faces);obj.data.update()
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-7)
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    bm.to_mesh(obj.data);bm.free()
    for f in obj.data.polygons: f.use_smooth=True
    _restore_untouched_normals(obj,old)
    return {'node':obj.name,'innerAbsX':PAINT_INNER_X,'fullBandAbsX':JOIN_X,
            'colorBoundary':'u=.12*smoothstep((abs(x)-.44)/.18); no center blue crossbar',
            'sameExistingSurfacePositions':True}


def build_central_attachment(context):
    hull=bpy.data.objects['Fuselage']
    hull_old=_corner_snapshot(hull)
    st=[(-x,context['PIVOT_Y']+l,c,context['PIVOT_Z']+z,r) for x,l,c,z,r in reversed(CENTER_LOFT[1:])]
    st += [(x,context['PIVOT_Y']+l,c,context['PIVOT_Z']+z,r) for x,l,c,z,r in CENTER_LOFT]
    # 名称前缀令弦向仍使用与保留翼根完全相同的 28 段采样。
    saddle=context['wing']('Fixed_root_V13_center',st,context['body'])
    saddle.name='Temporary_V13_saddle'
    bm=bmesh.new();bm.from_mesh(saddle.data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(saddle.data);bm.free()
    # 将鞍面隐藏顶面限制在已有 0.026 厚度外壳内。
    # 对已切出的内腔再作重合布尔运算会产生碎面；
    # 此解析顶面包络从构建阶段就不进入内腔。
    clipped=0
    for vertex in saddle.data.vertices:
        x,y,z=vertex.co
        _,w,h,zc=context['section_at'](context['body_dense'],y)
        shoulder=max(0.,min(1.,(y+2.60)/.90))
        if abs(x)>=w:continue
        c=(abs(x)/w)**(1/(1-.17*shoulder))
        v=-math.sqrt(max(0.,1-c*c))
        belly=zc-h*abs(v)**(1-.35*shoulder)
        maximum=belly+.010
        if z>maximum:
            # 上下两面均藏入外壳时，仍保留微小实际厚度。
            st_here=context['wing_station'](st,x)
            upper=z>=st_here[3]
            vertex.co.z=maximum if upper else maximum-.002
            clipped+=1
    saddle.data.update()
    # 临时材质标签仅用于追踪布尔后各皮面的来源，导出前移除。
    saddle.data.materials.clear();saddle.data.materials.append(context['body'])
    tag=context['body'].copy();tag.name='Temporary_V13_fillet_surface'
    saddle.data.materials.append(tag)
    hull.data.materials.append(tag)
    for f in saddle.data.polygons:f.material_index=1
    _boolean(hull,saddle,'UNION','Continuous fixed wing belly shoulder')
    bpy.data.objects.remove(saddle,do_unlink=True)
    bm=bmesh.new();bm.from_mesh(hull.data);bm.normal_update()
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-7)
    # 精确合并可能残留位置完全重合、方向相反的一对三角面。
    # 成对删除冗余内面，不删除外露皮肤，也不提高数值清理阈值。
    bm.verts.ensure_lookup_table();bm.verts.index_update()
    seen={};duplicates=[]
    for face in bm.faces:
        key=tuple(sorted(v.index for v in face.verts))
        if key in seen:duplicates.extend([seen[key],face])
        else:seen[key]=face
    if duplicates:bmesh.ops.delete(bm,geom=list(set(duplicates)),context='FACES_ONLY')
    wires=[e for e in bm.edges if not e.link_faces]
    if wires:bmesh.ops.delete(bm,geom=wires,context='EDGES')
    assert all(e.is_manifold for e in bm.edges),'V13 belly union must be closed and manifold'
    assert all(f.calc_area()>1e-18 for f in bm.faces),'V13 belly union has a degenerate face'
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.normal_update()
    bm.to_mesh(hull.data);bm.free()
    provenance={f.index:f.material_index for f in hull.data.polygons}
    for f in hull.data.polygons:f.use_smooth=True
    hull.data.update()
    restored=_restore_untouched_normals(hull,hull_old)
    # 新鞍面使用解析翼型法线；未修改的原外壳保留原角点法线。
    normals=[n.vector.copy() for n in hull.data.corner_normals]
    def height(x,y,up):
        stations=st if abs(x)<=JOIN_X else context['V12_FIXED_STATIONS']['R' if x>0 else 'L']
        q=context['wing_station'](stations,x)
        # 新中线鞍面按严格区间插值，避免容差与差分步长相同引入左右偏置。
        if abs(x)<.44:
            for a,b in zip(stations[:-1],stations[1:]):
                if min(a[0],b[0])<=x<=max(a[0],b[0]):
                    t=(x-a[0])/(b[0]-a[0]);q=tuple(a[i]+t*(b[i]-a[i]) for i in range(5));break
        u=max(1e-7,min(1-1e-7,(y-q[1])/q[2]))
        return context['airfoil_point'](q,u,up)[2]
    def body_normal(p):
        y=p.y
        _,w,h,z=context['section_at'](context['body_dense'],y)
        shoulder=max(0.,min(1.,(y+2.60)/.90))
        x=p.x/max(w,1e-8);zz=(p.z-z)/max(h,1e-8)
        xx=math.copysign(abs(x)**(1/(1-.17*shoulder)),x)
        zv=math.copysign(abs(zz)**(1/(1-(.16 if zz>=0 else .35)*shoulder)),zz)
        angle=math.atan2(zv,xx)
        if (p-Vector(context['fuselage_point'](y,angle))).length>.008:return None
        def surface(yy,aa):
            _,ww,hh,zc=nose_section(context['body_sections'],yy)
            sh=max(0.,min(1.,(yy+2.60)/.90));cc=math.cos(aa);ss=math.sin(aa)
            return Vector((ww*math.copysign(abs(cc)**(1-.17*sh),cc),yy,zc+hh*math.copysign(abs(ss)**(1-(.16 if ss>=0 else .35)*sh),ss)))
        ty=surface(y+.0001,angle)-surface(y-.0001,angle)
        ta=surface(y,angle+.0002)-surface(y,angle-.0002)
        return ty.cross(ta).normalized()
    for f in hull.data.polygons:
        if tuple(sorted(_key(hull.data.vertices[i].co) for i in f.vertices)) in hull_old:continue
        for li in f.loop_indices:
            p=hull.data.vertices[hull.data.loops[li].vertex_index].co
            if abs(p.x)>JOIN_X+1e-6:continue
            if provenance[f.index]==0:
                normal=body_normal(p)
                if normal is not None and normal.dot(f.normal)>.2:normals[li]=normal
                continue
            if all(abs(abs(hull.data.vertices[i].co.x)-JOIN_X)<1e-6 for i in f.vertices):
                normals[li]=f.normal.copy()
                continue
            if abs(f.normal.z)>1e-6:
                # 布尔交点位于离散三角平面，不要求它精确落在解析曲面上。
                # 依据来源面与朝向赋整张皮面的法线，避免只修旧采样点。
                up=f.normal.z>0
                e=.0001;dx=(height(p.x+e,p.y,up)-height(p.x-e,p.y,up))/(2*e);dy=(height(p.x,p.y+e,up)-height(p.x,p.y-e,up))/(2*e)
                normal=Vector((-dx,-dy,1)).normalized()*(1 if up else -1)
                if normal.dot(f.normal)>.2:normals[li]=normal
    hull.data.normals_split_custom_set(normals);hull.data.update()
    for f in hull.data.polygons:f.material_index=0
    hull.data.materials.clear();hull.data.materials.append(context['body'])
    bpy.data.materials.remove(tag)
    roots=[_trim_root(bpy.data.objects['Fixed_root_'+side],sign) for side,sign in [('L',-1),('R',1)]]
    paint=[_taper_paint(bpy.data.objects['Fixed_root_blue_'+side],sign,context) for side,sign in [('L',-1),('R',1)]]
    hull['centralAttachmentRevision']=13
    hull['centralAttachmentMethod']='Closed saddle unioned into Fuselage, original cargo cavity retained, exact butt sections at x=+/-.62'
    return {'version':13,'changedNodes':['Fuselage','Fixed_root_L','Fixed_root_R','Fixed_root_blue_L','Fixed_root_blue_R'],
            'construction':'single connected hollow fuselage and gray center saddle; closed fixed root butt sections',
            'centerLoft':CENTER_LOFT,'sharedSectionAbsX':JOIN_X,'paintTaper':paint,'fixedRoots':roots,
            'taggedSaddleFaces':sum(v==1 for v in provenance.values()),'saddleVerticesConfinedToShell':clipped,'unchangedHullCornersRestored':restored,'exteriorFilletUsed':False,'newIntersectionNormals':'separate analytic fuselage and wing skin fields by original surface provenance',
            'localBlenderBounds':{'absXMax':.62,'yMin':-1.9,'yMax':-.82,'zMax':.05},
            'preserved':['CargoHoodShell','cargo cavity','0–55 degree hood travel','all moving meshes and transforms','two ventral probes','V12 compact propellers','V12 .21/.42 rotating root interface'],
            'probes':'Original probe geometry unchanged; fixed saddle can enclose more of existing attachment stem',
            'visualReconstructionNotFactoryDimensions':True,
            'evidence':'User V13 defect crop; original N273PD belly/front photographs; no copied media or hidden structural claims'}
