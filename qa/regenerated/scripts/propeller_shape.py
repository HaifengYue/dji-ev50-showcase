"""V12紧凑折桨：受外观证据约束的重建，并非原厂CAD。

同时替换旧版半径0.230的铰点与长矩形悬臂。平面内后掠桨叶与适度收窄的
动力罩肩部相配合，在完整90度折叠时保留间隙；展开桨叶中心线不沿轴向弯曲。
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix

HINGE_RADIUS=.170
OLD_HINGE_RADIUS=.230
PIN_RADIUS=.006
BORE_RADIUS=.0085
ROTOR_RADIUS=.78


def _erase(name):
    obj=bpy.data.objects.get(name)
    if obj:bpy.data.objects.remove(obj,do_unlink=True)


def _boolean(target, cutter, operation):
    bpy.context.view_layer.update()
    mod=target.modifiers.new('Actual compact hub solid '+operation,'BOOLEAN')
    mod.operation=operation;mod.solver='EXACT';mod.object=cutter
    bpy.context.view_layer.objects.active=target
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter,do_unlink=True)


def _clean(obj):
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-9)
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-9)
    for _ in range(3):
        bmesh.ops.triangulate(bm,faces=list(bm.faces))
        bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-9)
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    assert all(e.is_manifold for e in bm.edges),obj.name+' must remain closed'
    assert all(f.calc_area()>1e-18 for f in bm.faces),obj.name+' has zero-area triangles'
    bm.to_mesh(obj.data);bm.free();obj.data.update()
    obj.data.set_sharp_from_angle(angle=math.radians(42))


def _extrude_xz(ctx,name,outline,y0,y1,material,parent):
    vv=[(x,y,z) for y in (y0,y1) for x,z in outline];n=len(outline)
    ff=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]
    ff += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    obj=ctx['mesh_object'](name,vv,ff,material,parent,True)
    bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free()
    return obj


def _make_spinner(ctx,name,parent):
    # 直接构造带轴向盲孔的回转壳体，避免布尔运算产生极细碎片。
    n=48;vv=[(0,0,.039)];ff=[]
    sections=[]
    theta_max=math.acos((-.033-.001)/.038)
    for i in range(1,25):
        a=theta_max*i/24
        sections.append((.104*math.sin(a),.001+.038*math.cos(a)))
    sections.extend([(.017,-.033),(.017,.003)])
    for r,z in sections:
        for k in range(n):
            a=k*2*math.pi/n;vv.append((r*math.cos(a),r*math.sin(a),z))
    for k in range(n):ff.append((0,1+k,1+(k+1)%n))
    for j in range(len(sections)-1):
        for k in range(n):
            a=1+j*n+k;b=1+j*n+(k+1)%n;ff.append((a,b,b+n,a+n))
    end=len(vv);vv.append((0,0,.003));base=1+(len(sections)-1)*n
    for k in range(n):ff.append((base+k,base+(k+1)%n,end))
    obj=ctx['mesh_object'](name,vv,ff,ctx['carbon'],parent,True);_clean(obj)
    return obj


def _make_fork(ctx,name,sign,parent):
    # 必须采用有序截面放样；若直接弯曲整块多边形叉耳，内部三角形会以直弦
    # 跨越曲面，导致轮廓虽正确、实体却向叶根侵入。
    sections=[(.073,.008),(.085,.0085),(.095,.009),(.107,.010),(.118,.011),(.130,.012),(.140,.013),(.150,.015),(.158,.016),(.165,.017),(.170,.017),(.176,.016),(.181,.013),(.185,.008),(.187,.001)]
    def cheek(name,side):
        vv=[];ff=[]
        for x,h in sections:
            t=max(0.,min(1.,(x-.073)/.060));t=t*t*(3-2*t)
            inner=.011+.025*t;outer=.027+.023*t
            # 销孔承载区域外侧采用短圆头，俯视轮廓也连续收束。
            if x>.176:
                q=(x-.176)/.011;mid=(inner+outer)/2
                half=(outer-inner)/2*math.sqrt(max(.005,1-q*q))
                inner=mid-half;outer=mid+half
            vv.extend([(x,side*inner,-h),(x,side*outer,-h),(x,side*outer,h),(x,side*inner,h)])
        ff=[(3,2,1,0)]
        for j in range(len(sections)-1):
            for k in range(4):ff.append((4*j+k,4*j+(k+1)%4,4*(j+1)+(k+1)%4,4*(j+1)+k))
        ff.append(tuple(4*(len(sections)-1)+k for k in range(4)))
        o=ctx['mesh_object'](name,vv,ff,ctx['carbon'],parent,True)
        bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
        return o
    a=cheek(name,-1);b=cheek('Temporary_compact_fork_cheek',1)
    web=_extrude_xz(ctx,'Temporary_compact_fork_web',[(.073,-.008),(.086,-.0085),(.086,.0085),(.073,.008)],-.022,.022,ctx['carbon'],parent)
    _boolean(a,web,'UNION');_boolean(a,b,'UNION')
    drill=ctx['cylinder_between']('Temporary_compact_fork_pin_hole',(HINGE_RADIUS,-.07,0),(HINGE_RADIUS,.07,0),.0068,ctx['metal'],parent,vertices=36,bevel_width=0)
    # 孔截面错开半个角度采样步长，避开放样站位与刀具顶点重合；
    # 不通过增大合并容差删去细小几何。
    drill.data.transform(Matrix.Rotation(math.pi/36,4,'Z'))
    _boolean(a,drill,'DIFFERENCE')
    mod=a.modifiers.new('Short clevis soft edge','BEVEL');mod.width=.0012;mod.segments=3
    bpy.context.view_layer.objects.active=a;bpy.ops.object.modifier_apply(modifier=mod.name)
    if sign<0:
        for v in a.data.vertices:v.co.x*=-1;v.co.y*=-1
    _clean(a)
    return a


def _make_blade(ctx,name,parent):
    # 平面内后掠中心线：每个截面中点仍保持z=0。适度切向后掠使折叠叶片
    # 沿收窄的罩肩外侧放置。元组为（距铰点展长、弦中心、弦长），桨尖受
    # 原旋翼外包络约束。
    tip_x=math.sqrt(ROTOR_RADIUS**2-.149**2)-HINGE_RADIUS
    stations=[(.002,0,.055),(.080,.014,.098),(.240,.057,.123),(.395,.100,.108),(.515,.129,.058),(tip_x,.140,.018)]
    sections=[(r,center-chord/2,chord,0,.10 if i<2 else .065) for i,(r,center,chord) in enumerate(stations)]
    blade=ctx['wing'](name,sections,ctx['carbon'],parent)
    pitch=math.radians(6)
    for v in blade.data.vertices:
        st=ctx['wing_station'](sections,v.co.x);center=st[1]+st[2]/2
        dy=v.co.y-center;zz=v.co.z
        v.co.y=center+dy*math.cos(pitch)-zz*math.sin(pitch)
        v.co.z=dy*math.sin(pitch)+zz*math.cos(pitch)
    sleeve=ctx['ring_axis']('Temporary_compact_blade_sleeve',(0,0,0),(0,1,0),.022,BORE_RADIUS,.058,ctx['carbon'],parent)
    _boolean(blade,sleeve,'UNION')
    bore=ctx['cylinder_between']('Temporary_compact_root_bore',(0,-.09,0),(0,.09,0),BORE_RADIUS,ctx['metal'],parent,vertices=36,bevel_width=0)
    _boolean(blade,bore,'DIFFERENCE');_clean(blade)
    return blade


def _nose_scale(y):
    # 仅在短前段内变形，区域外位移为零；保留吊舱最大宽度和后部轮廓。
    # 同一缩放场同时作用于附着的蒙皮、检修线和罩体边界。
    knots=[(-1.30,1.),(-1.17,.97),(-1.05,.88),(-.91,.88),(-.82,.91),(-.65,1.),(-.55,1.)]
    for a,b in zip(knots,knots[1:]):
        if a[0]<=y<=b[0]:
            t=(y-a[0])/(b[0]-a[0]);t=t*t*(3-2*t)
            return a[1]+t*(b[1]-a[1])
    return 1.


def build_propeller_refinements(context):
    ctx=context
    changed=[]
    for side in ('L','R'):
        for which in ('Front','Rear'):
            key=side+'_'+which;motor=bpy.data.objects['Prop_'+key]
            x=motor.location.x;pod_y=motor.location.y+1.30
            # 真实罩体轴孔顶点也接受同一物理变形；不为规避碰撞而放大
            # 轴或轴承的孔腔。
            for prefix in ('Motor_cowl_','Nacelle_','Pod_U_access_panel_','Cowl_boundary_'):
                for obj in [o for o in bpy.data.objects if o.name==prefix+key or o.name.startswith(prefix+key+'.') or o.name.startswith(prefix+key+'0')]:
                    if obj.type!='MESH':continue
                    for v in obj.data.vertices:
                        factor=_nose_scale(v.co.y-pod_y)
                        v.co.x=x+(v.co.x-x)*factor;v.co.z*=factor
                    obj.data.update();changed.append(obj.name)
            _erase('Spinner_'+key)
            spinner=_make_spinner(ctx,'Spinner_'+key,motor);changed.append(spinner.name)
            leaves={}
            for sign,letter in [(-1,'A'),(1,'B')]:
                fold=bpy.data.objects['BladeFold_'+key+'_'+letter]
                fold.location=(sign*HINGE_RADIUS,0,0)
                for prefix in ('Blade_','Blade_hinge_arm_','Blade_hinge_pin_'):_erase(prefix+key+'_'+letter)
                arm=_make_fork(ctx,'Blade_hinge_arm_'+key+'_'+letter,sign,motor)
                pin=ctx['cylinder_between']('Blade_hinge_pin_'+key+'_'+letter,(sign*HINGE_RADIUS,-.054,0),(sign*HINGE_RADIUS,.054,0),PIN_RADIUS,ctx['metal'],motor,vertices=24,bevel_width=.0007)
                _clean(pin);changed.extend([fold.name,arm.name,pin.name])
                leaves[letter]=fold
            master=_make_blade(ctx,'Blade_'+key+'_B',leaves['B'])
            other=master.copy();other.data=master.data.copy();other.name='Blade_'+key+'_A';other.parent=leaves['A'];bpy.context.collection.objects.link(other)
            for v in other.data.vertices:v.co.x*=-1;v.co.y*=-1
            other.data.update();changed.extend([master.name,other.name])
    return {'version':12,'reconstructedNotMeasured':True,'oldHingeRadius':OLD_HINGE_RADIUS,'hingeRadius':HINGE_RADIUS,'hingeRadiusReductionPercent':100*(1-HINGE_RADIUS/OLD_HINGE_RADIUS),'maxDeployedRotorRadius':ROTOR_RADIUS,'spinnerRadialRadius':.104,'spinnerAxialHalfLength':.038,'bladeCenterlinePlanar':True,'bladePitchDegrees':6,'foldAnglesDegrees':[-90,90],'pinRadius':PIN_RADIUS,'bladeBoreRadius':BORE_RADIUS,'forkBoreRadius':.0068,'rootSleeveRadius':.022,'rootSleeveHalfWidth':.029,'forkInnerHalfWidth':.036,'bladeRadialBoreClearance':BORE_RADIUS-PIN_RADIUS,'axialSideClearance':.007,'cowlLocalRadialScaleMinimum':.88,'changedNodes':changed,'sourceBoundary':'User model-correction screenshots identify oversized outriggers; photos 1/2/4/7 and existing video 00:19 support compact root/cowl silhouette only. Dimensions and swept blade planform are constrained reconstruction, not measured hardware.'}
