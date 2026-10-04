"""V10有来源边界的外形细化：六片柔性铰接舵面、空心前罩及单侧空速探头。
原厂资料只约束组成和可见外观；尺寸、舵角、舱盖轴为受限可视化重建。
"""
import bpy, bmesh, math, os, json, hashlib, shutil
from mathutils import Vector, Matrix


def boolean(target, cutter, operation, name):
    bpy.context.view_layer.update()
    mod=target.modifiers.new(name,'BOOLEAN');mod.operation=operation;mod.solver='EXACT';mod.object=cutter
    bpy.context.view_layer.objects.active=target
    bpy.ops.object.modifier_apply(modifier=mod.name)
    target.data.update()
    return target


def erase(name):
    obj=bpy.data.objects.get(name)
    if obj:bpy.data.objects.remove(obj,do_unlink=True)


def copy_mesh(obj,name):
    result=obj.copy();result.data=obj.data.copy();result.name=name
    bpy.context.collection.objects.link(result)
    return result


def local_box(name, origin, axes, bounds, parent):
    a,b,c=axes;lo,hi=bounds
    vertices=[tuple(origin+a*x+b*y+c*z) for z in (lo[2],hi[2]) for y in (lo[1],hi[1]) for x in (lo[0],hi[0])]
    faces=[(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)]
    return mesh_object(name,vertices,faces,None,parent,False)


def move_to_pivot(obj,pivot,origin):
    # 新节点不使用隐含parent-inverse；本地顶点直接回到轴原点。
    for v in obj.data.vertices:v.co-=origin
    obj.location=(0,0,0);obj.rotation_euler=(0,0,0);obj.scale=(1,1,1);obj.parent=pivot
    obj.data.update()


def make_control(key, fixed, stations, sign, x0, x1, group):
    parent=fixed.parent
    p0=Vector(airfoil_point(wing_station(stations,sign*x0),.78,True))
    p1=Vector(airfoil_point(wing_station(stations,sign*x1),.78,True))
    # 柔性铰接参考线取原创翼型中面，避免把表面偏移误作旋转轴。
    p0.z=wing_station(stations,sign*x0)[3];p1.z=wing_station(stations,sign*x1)[3]
    axis=(p1-p0).normalized();aft=Vector((0,1,0));aft=(aft-axis*aft.dot(axis)).normalized();normal=axis.cross(aft).normalized()
    length=(p1-p0).length;gap=.007
    surface=copy_mesh(fixed,'ControlSurface_'+key)
    cutter=local_box('Temporary_control_extract',p0,(axis,aft,normal),((0,gap,-2),(length,2,2)),parent)
    boolean(surface,cutter,'INTERSECT','实际独立舵面厚度');bpy.data.objects.remove(cutter,do_unlink=True)
    cutter=local_box('Temporary_control_relief',p0,(axis,aft,normal),((-.012,-gap,-2),(length+.012,2,2)),parent)
    boolean(fixed,cutter,'DIFFERENCE','舵面前缘和端面活动间隙');bpy.data.objects.remove(cutter,do_unlink=True)
    pivot=empty('ControlPivot_'+key,p0,parent)
    pivot['detailGroup']=group;pivot['detailAxis']=gltf_vector(axis);pivot['detailRange']=[-12.,12.]
    pivot['detailSign']=1 if sign<0 else -1
    pivot['detailEvidence']='UAFM 2.4.6 confirms living-hinge surfaces; axis and +/-12deg inspection travel are visual approximations'
    empty('ControlAxisStart_'+key,p0,parent);empty('ControlAxisEnd_'+key,p1,parent)
    move_to_pivot(surface,pivot,p0)
    surface['detailView']='tail' if group=='tail' else 'wing'
    # 不加不存在的外露金属铰链。极薄柔性边保留0.0006检視微隙，刚体近似不宣称真实柔性材料连续。
    def flexure(name, moving):
        # 封闭三角截面薄唇；两尖边分列轴线两侧，厚度向蒙皮渐增。
        sign_y=1 if moving else -1
        cross=[(sign_y*.0003,0),(sign_y*(gap+.001),-.00065),(sign_y*(gap+.001),.00065)]
        vv=[tuple(p0+axis*t+aft*y+normal*z) for t in (0,length) for y,z in cross]
        ff=[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)]
        part=mesh_object(name,vv,ff,body,parent,False)
        if moving:move_to_pivot(part,pivot,p0)
        part['detailEvidence']='两段极薄封闭柔性边的接触示意，并非实测柔性材料或弹性仿真'
        return part
    flexure('ControlFlexureMoving_'+key,True)
    flexure('ControlFlexureFixed_'+key,False)
    for part in (surface,fixed):part.data.set_sharp_from_angle(angle=math.radians(42))
    # 舵角是有厚度的短三角板，固连舵面；不再用折线细管假装拉杆。
    if group!='tail':
        x=sign*(x0+.15);st=wing_station(stations,x);q=Vector(airfoil_point(st,.88,False));q.z-=.003
        vs=[tuple(q+Vector((xx,yy,zz))-p0) for xx in (-.004,.004) for yy,zz in [(-.018,0),(.025,0),(.015,-.031)]]
        fs=[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)]
        horn=mesh_object('ControlHorn_'+key,vs,fs,metal,pivot,False)
        # 小销孔确实贯穿薄板，而不是叠一个黑点。
        center=q+Vector((0,.012,-.021))-p0
        drill=cylinder_between('Temporary_horn_bore',center+Vector((-.015,0,0)),center+Vector((.015,0,0)),.003,metal,pivot,vertices=16,bevel_width=0)
        boolean(horn,drill,'DIFFERENCE','舵角实际穿销孔');bpy.data.objects.remove(drill,do_unlink=True)
    return {'key':key,'pivot':pivot.name,'surface':surface.name,'axisStart':'ControlAxisStart_'+key,'axisEnd':'ControlAxisEnd_'+key,'axis':gltf_vector(axis),'rangeDegrees':[-12,12],'group':group,'sign':pivot['detailSign'],'hingeType':'thin living-hinge visual approximation','fixedGapEachSide':gap,'endGap':.012}


def make_cargo_shell():
    hull=bpy.data.objects['Fuselage']
    # 在旧机身内部扣出前部空腔，保留后机身、V9输出槽和原外表面。
    ys=[-2.59+i*(-.82+2.59)/42 for i in range(43)];n=64
    vv=[fuselage_point(y,2*math.pi*j/n,-.026) for y in ys for j in range(n)]
    ff=[]
    for i in range(len(ys)-1):
        for j in range(n):k=(j+1)%n;ff.append((i*n+j,i*n+k,(i+1)*n+k,(i+1)*n+j))
    ff.extend([tuple(range(n-1,-1,-1)),tuple((len(ys)-1)*n+j for j in range(n))])
    void=mesh_object('Temporary_cargo_void',vv,ff,None,None,False)
    bm=bmesh.new();bm.from_mesh(void.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(void.data);bm.free()
    boolean(hull,void,'DIFFERENCE','前部真实货舱空腔');bpy.data.objects.remove(void,do_unlink=True)
    hood=copy_mesh(hull,'CargoHoodShell')
    def divider(offset):
        vv=[];ff=[];rs=[.001,.05,.2,.5,.85,1,1.12,1.5,2.8,5]
        for r in rs:
            for j in range(n):
                a=2*math.pi*j/n;y=cargo_seam_y(a)+offset;p=Vector(fuselage_point(y,a))
                vv.append((p.x*r,(-1.76+(y+1.76)*min(r/.2,1)),.25+(p.z-.25)*r))
        for k in range(len(rs)-1):
            for j in range(n):q=(j+1)%n;ff.append((k*n+j,k*n+q,(k+1)*n+q,(k+1)*n+j))
        ff.append(tuple(range(n-1,-1,-1)))
        front=len(vv)
        for j in range(n):
            p=vv[(len(rs)-1)*n+j];vv.append((p[0],-4,p[2]))
        outer=(len(rs)-1)*n
        for j in range(n):q=(j+1)%n;ff.append((outer+j,front+j,front+q,outer+q))
        ff.append(tuple(front+j for j in range(n)))
        o=mesh_object('Temporary_hood_split',vv,ff,None,None,False)
        bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
        return o
    cut=divider(-.008);boolean(hood,cut,'INTERSECT','独立有厚度前罩');bpy.data.objects.remove(cut,do_unlink=True)
    cut=divider(.008);boolean(hull,cut,'DIFFERENCE','前罩真实开口');bpy.data.objects.remove(cut,do_unlink=True)
    erase('Cargo_hood_stepped_seam')
    # 后下缘横轴仅用于可视化开合；照片证明下翻姿态，不证明轴承内部。
    hinge=Vector(fuselage_point(cargo_seam_y(3*math.pi/2),3*math.pi/2));hinge.y-=.012;hinge.z-=.010
    pivot=empty('CargoHoodPivot',hinge)
    pivot['detailGroup']='hatch';pivot['detailAxis']=[1.,0.,0.];pivot['detailRange']=[0.,55.];pivot['detailSign']=1
    pivot['detailEvidence']='N27-series photograph supports downward opening hood; exact hinge and 55deg travel are reconstructed'
    empty('CargoHoodAxisStart',hinge+Vector((-.18,0,0)));empty('CargoHoodAxisEnd',hinge+Vector((.18,0,0)))
    move_to_pivot(hood,pivot,hinge);hood['detailView']='cargo'
    for o in (hood,hull):o.data.set_sharp_from_angle(angle=math.radians(42))
    # 压边为独立有厚度闭合环，沿已核实的曲折开口，不伪造内部设备。
    vv=[];ff=[]
    for dy,inflate in [(.010,-.025),(.070,-.025),(.010,-.040),(.070,-.040)]:
        for j in range(n):
            a=2*math.pi*j/n;vv.append(fuselage_point(cargo_seam_y(a)+dy,a,inflate))
    for j in range(n):k=(j+1)%n;ff.extend([(j,k,n+k,n+j),(2*n+k,2*n+j,3*n+j,3*n+k),(k,j,2*n+j,2*n+k),(n+j,n+k,3*n+k,3*n+j)])
    lip=mesh_object('CargoOpeningLip',vv,ff,carbon,None,True);lip['detailView']='cargo'
    # 搭扣分成固定座、活动拉片和销，外观位置沿用V6照片约束。
    for side,a in [('R',-.30),('L',math.pi+.30)]:
        erase('Cargo_latch_'+side);erase('Cargo_latch_handle_'+side)
        y=cargo_seam_y(a);p=Vector(fuselage_point(y,a,.017))
        along=(Vector(fuselage_point(y+.002,a))-Vector(fuselage_point(y-.002,a))).normalized()
        around=(Vector(fuselage_point(y,a+.002))-Vector(fuselage_point(y,a-.002))).normalized()
        normal=along.cross(around).normalized();wide=normal.cross(along).normalized()
        rotation=Matrix((wide,along,normal)).transposed().to_quaternion()
        fixed=plate('CargoLatchFixed_'+side,p+along*.037,(.032,.040,.009),metal,bevel=.004);fixed.rotation_mode='QUATERNION';fixed.rotation_quaternion=rotation
        moving=plate('CargoLatchMoving_'+side,p-along*.033,(.022,.048,.010),metal,bevel=.003);moving.rotation_mode='QUATERNION';moving.rotation_quaternion=rotation
        # 先应用局部旋转到网格，再统一回到舱盖轴下，防止重设父节点丢失姿态。
        bpy.context.view_layer.objects.active=moving;moving.select_set(True);bpy.ops.object.transform_apply(location=False,rotation=True,scale=False);moving.select_set(False)
        loc=moving.location.copy();moving.location=loc-hinge;moving.parent=pivot
        cylinder_between('CargoLatchPin_'+side,p+along*.037-wide*.018,p+along*.037+wide*.018,.004,carbon,vertices=16,bevel_width=.001)
    return {'pivot':pivot.name,'surface':hood.name,'axisStart':'CargoHoodAxisStart','axisEnd':'CargoHoodAxisEnd','axis':[1,0,0],'rangeDegrees':[0,55],'shellNominalThickness':.026,'openingGap':.016,'source':'Photograph 2; Bilibili 04:12/09:11 crosschecked with N273PD exterior','limitation':'Exact hinge, rim construction and travel reconstructed, no interior equipment claim'}


def make_probe():
    for side in ('L','R'):erase('Tail_tip_antenna_'+side)
    st=DETAIL_TAIL_STATIONS['L'][-2];p=Vector(airfoil_point(st,.30,True));p.z+=.009
    root=empty('PitotStaticProbe')
    root['detailView']='sensors';root['detailEvidence']='UAFM 2.7.2.1 locates probe on left ruddervator tip; photos constrain forward-facing exterior. Exact ports and mounting are reconstructed.'
    start=p;end=p+Vector((0,-.31,.005));axis=(end-start).normalized()
    ring_axis('Pitot_probe_tube',(start+end)/2,axis,.006,.0034,(end-start).length,metal,root)
    # 真实开口只表达空速探头功能；侧静压孔数和原厂管径没有证据，不冒造。
    ring_axis('Pitot_probe_mount',start+axis*.022,axis,.010,.0064,.042,carbon,root)
    cylinder_between('Pitot_probe_foot',p+Vector((0,0,-.014)),p+Vector((0,0,-.006)),.012,body,root,vertices=16,bevel_width=.001)
    for child in root.children:child['detailView']='sensors'
    empty('PitotProbeTip',end)
    return {'node':root.name,'tipNode':'PitotProbeTip','side':'left','location':'forward-facing left V-tail tip, kept fixed because attachment to actual moving surface cannot be resolved from imagery','probeOuterRadius':.006,'probeMouthRadius':.0034,'internalSensor':'UAFM confirms PitotNode in tailcone; no unsupported electronics modeled'}


def refine_motor_exterior():
    for side in ('L','R'):
        pivot=bpy.data.objects['WingPivot_'+side]
        for which in ('Front','Rear'):
            spindle=bpy.data.objects['Motor_spindle_'+side+'_'+which];origin=bpy.data.objects['Prop_'+side+'_'+which].location.copy()
            cowl=bpy.data.objects['Motor_cowl_'+side+'_'+which]
            # 固定动力罩鼻端也挖真实轴孔，不能让实心壳体吞没电机轴。
            cutter=cylinder_between('Temporary_motor_cowl_bore',origin+Vector((0,-.03,0)),origin+Vector((0,.17,0)),.018,metal,pivot,vertices=32,bevel_width=0)
            boolean(cowl,cutter,'DIFFERENCE','动力罩轴端实际通孔');bpy.data.objects.remove(cutter,do_unlink=True)
            ring_axis('MotorFrontBearing_'+side+'_'+which,origin+Vector((0,.115,0)),(0,1,0),.028,.0185,.018,metal,pivot)
            for obj in (spindle,cowl):obj['detailView']='motors' if side=='R' and which=='Front' else 'motor-other'
            cowl['detailEvidence']='Visible carbon-dark cowl and shaft; internal motor type not inferred from the fairing shape'
    return {'visible':'four dark motor cowls, actual shaft openings, bearing collars and existing folding props','configurationSource':'UAFM 2.5.1.1: one ESC and one brushless motor per nacelle','internalModel':'nacelle-system-concept.glb (separate, opt-in generic functional module)'}


def make_concept_module():
    before=set(bpy.data.objects)
    root=empty('ConceptNacelleSystems')
    root['detailConcept']=True;root['detailEvidence']='每吊舱配置1电机+1电调有UAFM依据；以下形状、尺寸、安装位置仅通用功能示意，不代表N273PD拆机。'
    # 模块以自身坐标独立导出，绝不进入默认机体资产。
    ring_axis('ConceptBrushlessMotor',(0,-.30,0),(0,1,0),.14,.045,.28,metal,root)
    ring_axis('ConceptMotorFrontPlate',(0,-.455,0),(0,1,0),.13,.021,.020,carbon,root)
    cylinder_between('ConceptMotorShaft',(0,-.64,0),(0,-.15,0),.016,metal,root,vertices=20,bevel_width=.001)
    esc=plate('ConceptESC',(0,.24,0),(.25,.34,.065),carbon,root,bevel=.018)
    esc['detailEvidence']='通用封装方块表示电调功能，不宣称PCB、散热形式、原厂尺寸或精确吊舱安装位置'
    # 通用底板/散热条表示热管理，不是对原厂散热形式或具体产品的逆向确认。
    plate('ConceptESCHeatSpreader',(0,.24,-.045),(.29,.38,.025),metal,root,bevel=.012)
    for x in (-.105,-.0525,0,.0525,.105):
        plate('ConceptESCHeatRib_'+str(x),(x,.24,-.073),(.010,.30,.033),metal,root,bevel=.004)
    # DC输入与三相输出使用功能分色。不给端口添加虚构厂牌、针脚数或规格。
    dc_red=material('Concept DC positive red',(.68,.018,.025),.05,.43)
    dc_black=material('Concept DC return charcoal',(.023,.028,.035),.05,.46)
    phase=material('Concept three-phase amber',(.88,.40,.045),.08,.42)
    for k,mat in [(-1,dc_red),(1,dc_black)]:
        x=k*.055
        ring_axis('ConceptDCPort_'+str(k),(x,.417,0),(0,1,0),.013,.0065,.022,metal,root)
        lead=line('ConceptDCLead_'+str(k),[(x,.414,0),(x,.58,.024),(x,.77,.024)],.006,mat,root,sides=8)
        lead['functionalLabel']='直流输入正极' if k<0 else '直流输入回路'
    for k in (-1,0,1):
        ring_axis('ConceptPhasePort_'+str(k),(k*.045,.065,0),(0,1,0),.011,.0057,.018,metal,root)
        wire=line('ConceptMotorPhaseWire_'+str(k),[(k*.045,-.145,0),(k*.045,-.015,.018),(k*.045,.068,.018)],.0045,phase,root,sides=6)
        wire['functionalLabel']='三相输出至无刷电机'
    root['functionalFlow']='直流输入 → 电调 → 三相输出 → 无刷电机 → 轴端；功能连接示意，非真实线束走向'

    empty('ConceptMotorFocus',(0,-.30,0),root);empty('ConceptESCFocus',(0,.24,0),root)
    bpy.ops.object.select_all(action='DESELECT')
    created=[o for o in bpy.data.objects if o not in before]
    for o in created:o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(MODELS,'nacelle-system-concept.glb'),export_format='GLB',use_selection=True,export_yup=True,export_extras=True,export_animations=False,export_cameras=False,export_lights=False)
    if not globals().get('CONCEPT_KEEP',False):
        for o in created:bpy.data.objects.remove(o,do_unlink=True)
    asset=os.path.join(MODELS,'nacelle-system-concept.glb')
    os.makedirs(os.path.join(ROOT,'assets/blender'),exist_ok=True)
    shutil.copy2(asset,os.path.join(ROOT,'assets/blender/nacelle-system-concept-source.glb'))
    return {'file':'nacelle-system-concept.glb','separateAsset':True,'defaultVisible':False,'source':'UAFM 2.5.1.1 confirms function/count only','label':'每吊舱配置有手册依据；形状与布置细节为概念示意','runtimeBytes':os.path.getsize(asset),'sha256':hashlib.sha256(open(asset,'rb').read()).hexdigest(),'editableSource':'assets/blender/nacelle-system-concept.blend','functionalFlow':'直流输入 → 电调 → 三相输出 → 无刷电机 → 轴端；功能示意'}


def build_details(context,concept_manifest=None):
    globals().update(context)
    controls=[]
    for side,sign in [('L',-1),('R',1)]:
        for obj in list(bpy.data.objects):
            if obj.name.startswith(('Aileron_seam_'+side,'Aileron_horn_'+side,'Tail_control_seam_'+side)):
                bpy.data.objects.remove(obj,do_unlink=True)
        stations=DETAIL_WING_STATIONS[side]
        fixed=bpy.data.objects['Composite_wing_'+side]
        for label,x0,x1 in [('Inboard',1.035,2.115),('Outboard',2.685,3.63)]:
            controls.append(make_control(side+'_'+label,fixed,stations,sign,x0,x1,label.lower()))
        controls.append(make_control('Tail_'+side,bpy.data.objects['V_tail_'+side],DETAIL_TAIL_STATIONS[side],sign,.33,1.56,'tail'))
        # 蓝色后缘短块随外副翼一起运动；原来静态贴面不能留在活动扫掠区。
        patch=bpy.data.objects.get('Wing_blue_aileron_accent_'+side)
        if patch:
            # 原短块横跨外吊舱边界，照片不足以确定标签几何；移除旧贴面，保留前缘主蓝块。
            bpy.data.objects.remove(patch,do_unlink=True)
    cargo=make_cargo_shell();probe=make_probe();motors=refine_motor_exterior();concept=concept_manifest or make_concept_module()
    # 新布尔交线先明确三角化，合并1e-7级数值碎点，不能留退化面遮掩孔洞。
    clean_names=['Fuselage','CargoHoodShell','Composite_wing_L','Composite_wing_R','V_tail_L','V_tail_R']
    for name in clean_names:
        o=bpy.data.objects[name];bm=bmesh.new();bm.from_mesh(o.data)
        bmesh.ops.triangulate(bm,faces=list(bm.faces))
        bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
        bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-7)
        bm.verts.ensure_lookup_table();bm.verts.index_update();seen={};duplicate=[]
        for f in bm.faces:
            key=tuple(sorted(v.index for v in f.verts))
            if key in seen:duplicate.extend([seen[key],f])
            else:seen[key]=f
        if duplicate:bmesh.ops.delete(bm,geom=list(set(duplicate)),context='FACES_ONLY')
        wires=[e for e in bm.edges if not e.link_faces]
        if wires:bmesh.ops.delete(bm,geom=wires,context='EDGES')
        bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.normal_update();bm.to_mesh(o.data);bm.free()
        o.data.set_sharp_from_angle(angle=math.radians(42))
    return {'version':10,'controlSurfaces':controls,'cargoHood':cargo,'airspeedProbe':probe,'motors':motors,'conceptModule':concept,'flexureApproximation':{'rigidVisualSegments':True,'tipMicrogap':.0006,'notElasticSimulation':True,'noMeasuredFlightTravel':True},'evidenceBoundary':'N273PD exterior retained; no copied imagery, unmeasured ranges are inspection-only, hidden installation details are not claimed'}
