"""连续分层翼根、实际移轴及翼上球心内移；保留真实机腹直槽、低置驱动和单直斜输出。
原创概念几何与定长闭环机构，不是原厂CAD、制造图纸或适航模型。
运行：blender -b -t 4 --python scripts/generate_transwing.py
仅独立构建几何；不复制官方网格、纹理、标识或摄影图像。
"""
import bpy, bmesh, math, os, json, shutil, sys, hashlib
# The exact CSG/triangulation lineage is verified using Blender's four-worker scheduler.
# Refuse a different/default worker count rather than silently change protected raw geometry.
_thread_args=[sys.argv[i+1]for i,a in enumerate(sys.argv[:-1])if a in ('-t','--threads')]
_thread_args += [a.split('=',1)[1]for a in sys.argv if a.startswith('--threads=')]
if not _thread_args or any(a!='4'for a in _thread_args):
    raise RuntimeError('Deterministic generation requires: blender -b -t 4 --python-exit-code 1 --python scripts/generate_transwing.py')
bpy.context.preferences.filepaths.save_version=0
from mathutils import Vector, Quaternion, Matrix
from mathutils.geometry import tessellate_polygon
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from annotated_native_stage import require_authoring_ready, run_stage, install_native_diagnostics, prepare_native_outer_paint
ANNOTATED_STAGE_PREFLIGHT=require_authoring_ready(ROOT)
if bpy.context.scene.get('annotatedMechanismJSON') is not None:
    raise RuntimeError('Start a fresh native scene; do not regenerate over a loaded finished aircraft')
from kinematics import *
use_authoring_reference(True)
PIVOT_X,PIVOT_Y,PIVOT_Z=REFERENCE_PIVOT
from embedded_joint_surfaces import joint_profile, lip_factor as root_lip_factor, finish_embedded_joints
from wing_surfaces import root_stations, moving_stations, build_surface_refinements, densify_root, roll_joint_skin, refined_body_sections
MODELS = os.path.join(ROOT, 'public/models')
SOURCES = os.path.join(ROOT, 'assets/build')
PREVIEWS = os.path.join(ROOT, 'assets/previews')
for path in (MODELS, SOURCES, PREVIEWS): os.makedirs(path, exist_ok=True)
# 独立概念资源无本轮改动时保留已压缩资产，避免主机重建覆盖它。
PRESERVED_CONCEPT_MANIFEST=None
manifest_path=os.path.join(MODELS,'manifest.json')
if os.path.isfile(manifest_path):
    old_manifest=json.load(open(manifest_path))
    candidate=old_manifest.get('airframeDetails',{}).get('conceptModule')
    if candidate:
        concept_path=os.path.join(MODELS,candidate['file'])
        if os.path.isfile(concept_path) and hashlib.sha256(open(concept_path,'rb').read()).hexdigest()==candidate.get('sha256'):
            PRESERVED_CONCEPT_MANIFEST=candidate


def material(name, color, metallic=0.0, roughness=.4):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1)
    result.use_nodes = True
    bsdf = result.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    return result

def mesh_object(name, vertices, faces, mat, parent=None, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    if mat: data.materials.append(mat)
    obj.parent = parent
    for face in data.polygons: face.use_smooth = smooth
    return obj

def empty(name, location=(0,0,0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.parent = parent
    return obj

def sphere(name, location, scale, mat, parent=None, segments=24, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    obj.parent = parent
    for face in obj.data.polygons: face.use_smooth = True
    return obj

def line(name, points, radius, mat, parent=None, sides=6, closed=False):
    # 低多边形细管用于细微接缝；不以悬浮黑色盒子模拟开口。
    points = [Vector(p) for p in points]
    vertices, faces = [], []
    for i, point in enumerate(points):
        tangent = points[(i+1)%len(points)] - points[i-1] if closed else points[min(i+1,len(points)-1)] - points[max(0,i-1)]
        tangent.normalize()
        basis = tangent.cross(Vector((0,0,1)))
        if basis.length < .1: basis = tangent.cross(Vector((0,1,0)))
        basis.normalize(); other = tangent.cross(basis).normalized()
        for j in range(sides): vertices.append(tuple(point + radius * (math.cos(j*2*math.pi/sides)*basis + math.sin(j*2*math.pi/sides)*other)))
    for i in range(len(points) if closed else len(points)-1):
        k=(i+1)%len(points)
        for j in range(sides): faces.append((i*sides+j,i*sides+(j+1)%sides,k*sides+(j+1)%sides,k*sides+j))
    return mesh_object(name, vertices, faces, mat, parent)

def catmull(stations, divisions=3):
    result=[]
    for i in range(len(stations)-1):
        a=stations[max(i-1,0)];b=stations[i];c=stations[i+1];d=stations[min(i+2,len(stations)-1)]
        for k in range(divisions):
            t=k/divisions
            result.append(tuple(.5*((2*b[j])+(-a[j]+c[j])*t+(2*a[j]-5*b[j]+4*c[j]-d[j])*t*t+(-a[j]+3*b[j]-3*c[j]+d[j])*t*t*t) for j in range(len(b))))
    result.append(stations[-1]);return result

def lathe_y(name, stations, mat, parent=None, radial=40, interpolate=3, offset=(0,0,0)):
    # （纵向、横半径、竖半径、中心高度），用更密的纵向截面保持圆钝头部和收束尾部。
    sections=catmull(stations,interpolate) if interpolate else stations
    vertices,faces=[],[]
    for y,w,h,z in sections:
        for i in range(radial):
            angle=i*2*math.pi/radial
            vertices.append((offset[0]+max(w,.001)*math.cos(angle),offset[1]+y,offset[2]+z+max(h,.001)*math.sin(angle)))
    for k in range(len(sections)-1):
        for i in range(radial):faces.append((k*radial+i,k*radial+(i+1)%radial,(k+1)*radial+(i+1)%radial,(k+1)*radial+i))
    faces.extend([tuple(range(radial-1,-1,-1)),tuple((len(sections)-1)*radial+i for i in range(radial))])
    return mesh_object(name, vertices, faces, mat, parent)

def thickness(u, chord, ratio):
    # NACA 对称翼型的原创参数化近似，后缘闭合；并非取得了真实 P4 翼型。
    return 5*ratio*chord*(.2969*math.sqrt(max(u,0))-.126*u-.3516*u*u+.2843*u**3-.1036*u**4)

def airfoil_point(station,u,upper=True):
    x,leading,chord,z,ratio=station
    return (x,leading+u*chord,z+(1 if upper else -1)*thickness(u,chord,ratio))

def wing(name, stations, mat, parent=None):
    # 余弦分布截面替代 v1 的椭圆透镜，保留钝圆前缘、薄后缘与真实翼尖收束。
    if name.startswith('Fixed_root_'):stations=densify_root(stations,2.1)
    if name.startswith('Composite_wing_'):stations=densify_root(stations,.62)
    intervals=28 if name.startswith(('Fixed_root_','Composite_wing_')) else 14
    samples=[.5*(1-math.cos(math.pi*i/intervals)) for i in range(intervals+1)]
    loop=[(u,True) for u in samples]+[(u,False) for u in reversed(samples[1:-1])]
    vertices=[airfoil_point(station,u,up) for station in stations for u,up in loop]
    n=len(loop);faces=[]
    for k in range(len(stations)-1):
        for i in range(n):faces.append((k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i))
    faces.extend([tuple(range(n-1,-1,-1)),tuple((len(stations)-1)*n+i for i in range(n))])
    return mesh_object(name,vertices,faces,mat,parent)

def skin_band(name,stations,u0,u1,mat,parent):
    vertices=[];faces=[];steps=24 if name.startswith(('Fixed_root_blue_','Wing_blue_leading_')) else 8
    if name.startswith('Fixed_root_blue_'):stations=densify_root(stations,2.1)
    if name.startswith('Wing_blue_leading_'):stations=densify_root(stations,.62)
    for upper in (True,False):
        base=len(vertices)
        for station in stations:
            for j in range(steps+1):
                u=u0+(u1-u0)*j/steps
                x,y,z=airfoil_point(station,u,upper)
                if name.startswith(('Fixed_root_blue_','Wing_blue_leading_')) and j==0 and u0==0:vertices.append((x,y-.004,z))
                else:
                    offset=.004 if name.startswith(('Fixed_root_blue_','Wing_blue_leading_')) else .003
                    vertices.append((x,y,z+(offset if upper else -offset)))
        for k in range(len(stations)-1):
            for j in range(steps):
                a=base+k*(steps+1)+j;b=a+steps+1
                faces.append((a,a+1,b+1,b))
    return mesh_object(name,vertices,faces,mat,parent)

def wing_station(stations,x):
    for a,b in zip(stations[:-1],stations[1:]):
        if min(a[0],b[0])-.0001<=x<=max(a[0],b[0])+.0001:
            t=(x-a[0])/(b[0]-a[0]);return tuple(a[i]+t*(b[i]-a[i]) for i in range(5))
    return stations[-1]

def wing_patch(name,stations,coords,mat,parent):
    # 三角细分后再投影到原创翼型，避免大多边形穿入曲面而丢失蓝色区域。
    vertices=[];faces=[];steps=10
    polygon=[Vector((x,u,0)) for x,u in coords]
    triangles=[tuple(polygon[int(v)] if isinstance(v,(int,float)) else v for v in tri) for tri in tessellate_polygon([polygon])]
    for upper in (True,False):
        for tri in triangles:
            indices={}
            for i in range(steps+1):
                for j in range(steps-i+1):
                    point=tri[0]+(tri[1]-tri[0])*i/steps+(tri[2]-tri[0])*j/steps
                    x,y,z=airfoil_point(wing_station(stations,point.x),point.y,upper)
                    indices[(i,j)]=len(vertices);vertices.append((x,y,z+(.0035 if upper else -.0035)))
            for i in range(steps):
                for j in range(steps-i):
                    faces.append((indices[(i,j)],indices[(i+1,j)],indices[(i,j+1)]))
                    if j<steps-i-1:faces.append((indices[(i+1,j)],indices[(i+1,j+1)],indices[(i,j+1)]))
    return mesh_object(name,vertices,faces,mat,parent)


def update_braces():
    update_linkage()

bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for mat in list(bpy.data.materials):bpy.data.materials.remove(mat)
body=material('Pearl gray composite',(.63,.67,.70),.12,.37)
blue=material('Reference cobalt blue',(.006,.095,.67),.14,.31)
carbon=material('Black carbon cowl',(.012,.016,.023),.18,.27)
seam=material('Panel recess',(.11,.14,.16),.12,.52)
metal=material('Small alloy hardware',(.36,.40,.43),.7,.3)
wear=material('Landing tip polymer',(.034,.046,.052),0,.68)

# 以用户提供的 N273PD 正侧/俯视/正前与三分之四照片校正；无图片投射或官方网格。
HALF_SPAN=5.3
# 前舱宽而较扁：圆角方形截面、略下垂的钝鼻及平缓腹线；尾梁连续收束。
body_sections=[(-2.72,.003,.005,.24),(-2.70,.070,.060,.244),(-2.63,.215,.155,.258),(-2.49,.360,.265,.285),(-2.23,.495,.390,.270),(-1.78,.558,.465,.258),(-1.28,.551,.468,.250),(-.73,.510,.424,.220),(-.18,.429,.330,.183),(.42,.326,.240,.144),(.99,.230,.165,.111),(1.55,.154,.108,.105),(2.10,.107,.079,.10),(2.54,.057,.046,.10),(2.72,.003,.006,.10)]
body_sections=[tuple(float(v) for v in q) for q in body_sections]
body_dense=refined_body_sections(body_sections,catmull(body_sections,5))
def section_at(sections,y):
    for a,b in zip(sections[:-1],sections[1:]):
        if a[0]<=y<=b[0]:
            t=(y-a[0])/(b[0]-a[0]);return tuple(a[j]+(b[j]-a[j])*t for j in range(4))
    return sections[0] if y<sections[0][0] else sections[-1]
def fuselage_point(y,angle,offset=.0):
    _,w,h,z=section_at(body_dense,y);c=math.cos(angle);v=math.sin(angle)
    # superelliptic shoulders and deliberately flatter belly, not a scaled sphere.
    shoulder=max(0,min(1,(y+2.60)/.90))
    # 近鼻端回到椭圆截面，避免把圆角方形尖收为带十字反光的硬极点。
    x=w*math.copysign(abs(c)**(1-.17*shoulder),c)
    exponent=1-(.16 if v>=0 else .35)*shoulder
    zz=z+h*math.copysign(abs(v)**exponent,v)
    return (x+offset*c,y,zz+offset*v)
from output_slot_profile import configure, refine_normals, triangulate_slot_input
BASE_FUSELAGE_POINT=fuselage_point
fuselage_point,SLOT_PROFILE_CONFIG=configure(BASE_FUSELAGE_POINT,section_at,body_dense)
vertices=[];faces=[];radial=64
for st in body_dense:
    for j in range(radial):vertices.append(fuselage_point(st[0],j*2*math.pi/radial))
for i in range(len(body_dense)-1):
    for j in range(radial):faces.append((i*radial+j,i*radial+(j+1)%radial,(i+1)*radial+(j+1)%radial,(i+1)*radial+j))
faces.extend([tuple(range(radial-1,-1,-1)),tuple((len(body_dense)-1)*radial+j for j in range(radial))])
triangulate_slot_input(mesh_object('Fuselage',vertices,faces,body))

def rounded_rect(cx,cy,w,h,r,n=7):
    points=[]
    for x,y,a in [(cx+w/2-r,cy+h/2-r,0),(cx-w/2+r,cy+h/2-r,math.pi/2),(cx-w/2+r,cy-h/2+r,math.pi),(cx+w/2-r,cy-h/2+r,math.pi*1.5)]:
        for k in range(n):
            angle=a+k*math.pi/2/(n-1);points.append((x+r*math.cos(angle),y+r*math.sin(angle)))
    return points

def resample_closed(points,spacing=.055):
    # 先在表面参数域补满直边，再逐点投影；长直弦不能穿过圆鼓壳体内部。
    result=[]
    for a,b in zip(points,points[1:]+points[:1]):
        n=max(1,math.ceil(math.hypot(b[0]-a[0],b[1]-a[1])/spacing))
        result.extend([(a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n) for k in range(n)])
    return result

def plate(name,center,scale,mat,parent=None,bevel=.015):
    bpy.ops.mesh.primitive_cube_add(size=1,location=center);o=bpy.context.object;o.name=name;o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    mod=o.modifiers.new('Small rounded manufactured corners','BEVEL');mod.width=bevel;mod.segments=2
    bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
    o.data.materials.append(mat);o.parent=parent
    for face in o.data.polygons:face.use_smooth=False
    return o

ROOT_CURVE_DEPTH=.21
ROOT_CURVE_RADIUS=.42
ROOT_HALF_GAP=.003
# V23只收紧翼面实体/涂层；原主斜轴桥接件仍使用已验收的切口。
HARDWARE_HALF_GAP=.012
ROOT_TIP_RELIEF_START=.72
ROOT_TIP_RELIEF_END=.80
ROOT_TIP_RELIEF_DEPTH=.005

def joint_offset(radius,offset):
    # 仅活动翼最内侧后缘渐退，让开中央机身接合边；同轴径向场随转动不变。
    if abs(offset+ROOT_HALF_GAP)>1e-12:return offset
    u=max(0.,min(1.,(radius-ROOT_TIP_RELIEF_START)/(ROOT_TIP_RELIEF_END-ROOT_TIP_RELIEF_START)))
    return offset-ROOT_TIP_RELIEF_DEPTH*u*u*(3-2*u)

def joint_signed(point, origin, axis, offset=0):
    q=Vector(point)-Vector(origin);t=q.dot(axis);r=(q-axis*t).length
    return t-joint_profile(r)-joint_offset(r,offset)

def clip_joint_skin(obj,origin,axis,keep_positive):
    # 开放涂层逐三角形裁剪，不让布尔运算错误封闭蓝色表面。
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    edges=[e for e in bm.edges if any(abs(joint_signed(v.co,origin,axis))<.12 for v in e.verts)]
    bmesh.ops.subdivide_edges(bm,edges=edges,cuts=1,use_grid_fill=True)
    bmesh.ops.triangulate(bm,faces=list(bm.faces));vertices=[];faces=[]
    offset=ROOT_HALF_GAP if keep_positive else -ROOT_HALF_GAP
    def inside(v):return joint_signed(v,origin,axis,offset)*(1 if keep_positive else -1)>=0
    for face in bm.faces:
        poly=[v.co.copy() for v in face.verts];out=[]
        for a,b in zip(poly,poly[1:]+poly[:1]):
            ia,ib=inside(a),inside(b)
            if ia:out.append(a)
            if ia!=ib:
                lo,hi=a.copy(),b.copy()
                for _ in range(30):
                    mid=(lo+hi)/2
                    if inside(mid)==ia:lo=mid
                    else:hi=mid
                out.append((lo+hi)/2)
        if len(out)>=3:
            start=len(vertices);vertices.extend(out);faces.append(tuple(range(start,start+len(out))))
    bm.free();obj.data.clear_geometry();obj.data.from_pydata(vertices,[],faces);obj.data.update()
    # 合并裁剪产生的共享点，维持连续法线，避免蓝色前缘条带逐三角明暗分层。
    welded=bmesh.new();welded.from_mesh(obj.data)
    bmesh.ops.remove_doubles(welded,verts=list(welded.verts),dist=.000001)
    welded.normal_update();welded.to_mesh(obj.data);welded.free()
    for face in obj.data.polygons:face.use_smooth=True
    return obj

def clip_joint(obj,origin,axis,keep_positive,cap=True):
    # 固定翼与活动翼分居同轴曲面两侧；轴向间隙在任意倾转角保持不变。
    axis=Vector(axis).normalized();origin=Vector(origin)
    if obj.name.startswith(('Fixed_root_','Composite_wing_','Wing_blue_leading_')):roll_joint_skin(obj,origin,axis,keep_positive,globals())
    if not cap:return clip_joint_skin(obj,origin,axis,keep_positive)
    u=axis.cross(Vector((0,0,1))).normalized();v=axis.cross(u)
    gap=ROOT_HALF_GAP if obj.name.startswith(('Fixed_root_','Composite_wing_','Wing_blue_leading_')) else HARDWARE_HALF_GAP
    offset=gap if keep_positive else -gap
    rings=sorted(set([.005*i for i in range(1,33)]+[.02*i for i in range(1,66)]+[.045,.080,.160,1.5,2,4,8,16]));n=96
    vertices=[tuple(origin+axis*joint_offset(0,offset))];faces=[]
    for r in rings:
        for j in range(n):
            angle=j*2*math.pi/n+(math.pi/n if r<.16 else 0)
            vertices.append(tuple(origin+axis*(joint_profile(r)+joint_offset(r,offset))+r*(u*math.cos(angle)+v*math.sin(angle))))
    for j in range(n):faces.append((0,1+(j+1)%n,1+j))
    for k in range(len(rings)-1):
        a=1+k*n;b=a+n
        for j in range(n):q=(j+1)%n;faces.append((a+j,a+q,b+q,b+j))
    top=len(vertices)
    for j in range(n):
        angle=j*2*math.pi/n;vertices.append(tuple(origin+axis*6+rings[-1]*(u*math.cos(angle)+v*math.sin(angle))))
    outer=1+(len(rings)-1)*n
    for j in range(n):q=(j+1)%n;faces.append((outer+j,outer+q,top+q,top+j))
    faces.append(tuple(top+j for j in range(n)))
    cutter=mesh_object('Temporary_curved_joint_cutter',vertices,faces,None,obj.parent,False)
    bpy.context.view_layer.update()
    mod=obj.modifiers.new('同轴弧形拼接面','BOOLEAN');mod.operation='INTERSECT' if keep_positive else 'DIFFERENCE';mod.solver='EXACT';mod.object=cutter
    bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter,do_unlink=True)
    # 只收圆弧形拼接面与原翼面的交界，保留整个外翼的原翼型。
    bm=bmesh.new();bm.from_mesh(obj.data);bm.normal_update()
    seam_edges=[]
    for edge in bm.edges:
        if len(edge.link_faces)!=2:continue
        if all(abs(joint_signed(v.co,origin,axis,offset))<.0008 for v in edge.verts) and edge.calc_face_angle()>.38:
            seam_edges.append(edge)
    if False and seam_edges:bmesh.ops.bevel(bm,geom=seam_edges,offset=.006,segments=3,affect='EDGES',clamp_overlap=True)
    bm.normal_update();bm.to_mesh(obj.data);bm.free()
    obj.data.set_sharp_from_angle(angle=math.radians(42))
    return obj

def round_root_trailing_corner(obj,sign,origin,axis,radius=.12):
    # 薄后缘不能依赖三维倒角去掉刀尖；用真实平面圆弧收圆翼根端点。
    te=.36;axis=Vector(axis);origin=Vector(origin)
    def root_x(y):
        lo,hi=-.9,.8
        for _ in range(50):
            mid=(lo+hi)/2;p=Vector((sign*mid,y,0))
            if joint_signed(p,origin,axis,-ROOT_HALF_GAP)>0:lo=mid
            else:hi=mid
        return (lo+hi)/2
    x=root_x(te);slope=(root_x(te+.0001)-root_x(te-.0001))/.0002
    cx=x+radius*(math.sqrt(1+slope*slope)-slope);cy=te-radius
    tangent_y=cy+radius*slope/math.sqrt(1+slope*slope)
    # 圆弧以外的窄角区去料；不扩张原曲面包络，也不扩大整条接缝。
    bpy.ops.mesh.primitive_cube_add(size=1,location=(sign*(cx-.14),(tangent_y+te+.07)/2,0))
    cutter=bpy.context.object;cutter.name='Temporary_root_corner';cutter.scale=(.28,te+.07-tangent_y,1.4)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);cutter.parent=obj.parent
    bpy.ops.mesh.primitive_cylinder_add(vertices=80,radius=radius,depth=1.8,location=(sign*cx,cy,0))
    circle=bpy.context.object;circle.name='Temporary_root_corner_circle';circle.parent=obj.parent
    bpy.context.view_layer.update()
    mod=cutter.modifiers.new('翼根后缘圆角刀具','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=circle
    bpy.context.view_layer.objects.active=cutter;bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(circle,do_unlink=True)
    mod=obj.modifiers.new('翼根后缘平面小圆角','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
    bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
    obj.data.set_sharp_from_angle(angle=math.radians(42))
    return obj

def cylinder_between(name, start, end, radius, mat, parent=None, vertices=32, bevel_width=.005):
    a,b=Vector(start),Vector(end);d=b-a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=d.length,location=(a+b)/2)
    obj=bpy.context.object;obj.name=name;obj.rotation_mode='QUATERNION';obj.rotation_quaternion=d.to_track_quat('Z','Y')
    obj.data.materials.append(mat);obj.parent=parent
    for face in obj.data.polygons:face.use_smooth=len(face.vertices)==4
    if bevel_width>0:
        bevel=obj.modifiers.new('Machined edge fillet','BEVEL');bevel.width=bevel_width;bevel.segments=2
        bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=bevel.name)
    return obj

def ring_axis(name, center, axis, outer, inner, length, mat, parent=None):
    axis=Vector(axis).normalized();c=Vector(center)
    u=axis.cross(Vector((0,0,1))).normalized();v=axis.cross(u)
    vertices=[];faces=[];n=36
    for z,r in [(-length/2,outer),(length/2,outer),(-length/2,inner),(length/2,inner)]:
        for k in range(n):vertices.append(tuple(c+axis*z+r*(u*math.cos(k*2*math.pi/n)+v*math.sin(k*2*math.pi/n))))
    for k in range(n):
        j=(k+1)%n
        faces.extend([(k,j,n+j,n+k),(2*n+j,2*n+k,3*n+k,3*n+j),(j,k,2*n+k,2*n+j),(n+k,n+j,3*n+j,3*n+k)])
    return mesh_object(name,vertices,faces,mat,parent)

def spherical_rod_eye(name,center,parent):
    # 球面座内腔随球摆动保持同一包络；端部收口保留球头，留.0005径向公差。
    c=Vector(center);n=36;outer=.030;seat=.0185;half=.005
    sections=[(-half,outer),(half,outer)]+[(y,math.sqrt(seat*seat-y*y)) for y in (-half,-half/2,0,half/2,half)]
    verts=[tuple(c+Vector((r*math.cos(k*2*math.pi/n),y,r*math.sin(k*2*math.pi/n)))) for y,r in sections for k in range(n)]
    faces=[]
    for k in range(n):
        j=(k+1)%n
        faces.extend([(k,j,n+j,n+k),(j,k,2*n+k,2*n+j),(n+k,n+j,6*n+j,6*n+k)])
        for q in range(2,6):faces.append((q*n+j,q*n+k,(q+1)*n+k,(q+1)*n+j))
    return mesh_object(name,verts,faces,metal,parent)

def shaft_bore(obj, origin, axis, radius=.045):
    # 真正挖出贯穿孔，而不是把实心零件相互插入后称为轴承。
    a=Vector(origin)-Vector(axis)*1.1;b=Vector(origin)+Vector(axis)*1.1
    # V14：只提高四片根体的轴孔采样，保持名义孔径；避免新薄唇交线的极窄折返。
    cutter=cylinder_between('Temporary_shaft_bore',a,b,radius,metal,obj.parent,vertices=64 if obj.name.startswith(('Fixed_root_','Composite_wing_')) else 32)
    bpy.context.view_layer.update()
    modifier=obj.modifiers.new('Actual shaft clearance bore','BOOLEAN');modifier.operation='DIFFERENCE';modifier.solver='EXACT';modifier.object=cutter
    bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.data.objects.remove(cutter,do_unlink=True)
    obj.data.update()
    # 斜切端盖和孔缘必须保持分离法线，否则宽翼面的平滑法线会被端盖拉成黑色三角。
    obj.data.set_sharp_from_angle(angle=math.radians(35))
    # 曲面端盖保持连续法线；不再把近轴向面误当成旧版平面端盖。
    return obj

# 视频04:12与原N273PD照片1/7：上方后置、侧壁圆角转折、下缘向鼻端前折。
# 仅修订壳面接缝；不把照片没有证明的内部舱室或开舱运动加入模型。
def cargo_seam_y(a):
    h=math.sin(a)
    if h>=.18:return -1.57+.035*(1-h)
    if h<=-.66:return -2.031-.019*(-.66-h)/.34
    t=(.18-h)/.84
    return -1.5413-.4897*t*t*(3-2*t)
hood=[fuselage_point(cargo_seam_y(a),a,.0045) for a in [2*math.pi*i/192 for i in range(192)]]
line('Cargo_hood_stepped_seam',hood,.0032,seam,closed=True,sides=5)
# 两块贴合曲面的顶部圆角矩形检修盖；不制作虚构透明座舱。
for label,y,length,width in [('main',-.18,1.02,1.00)]:
    loop=resample_closed(rounded_rect(y,math.pi/2,length,width,.14,8),.045)
    points=[fuselage_point(yy,a,.004) for yy,a in loop]
    line('Dorsal_hatch_'+label,points,.0032,seam,sides=5,closed=True)
    for yy in (y-length*.35,y+length*.35):
        for a in (math.pi/2-width*.36,math.pi/2+width*.36):
            sphere('Hatch_fastener_'+label,fuselage_point(yy,a,.002),(.010,.010,.004),metal,segments=8,rings=4)
# 两侧小搭扣跨过斜段接缝，沿局部壳面切平面放置，数量不增加。
for side,a in [('R',-.30),('L',math.pi+.30)]:
    y=cargo_seam_y(a);p=Vector(fuselage_point(y,a,.012))
    along_y=Vector(fuselage_point(y+.001,a))-Vector(fuselage_point(y-.001,a))
    around=Vector(fuselage_point(y,a+.001))-Vector(fuselage_point(y,a-.001))
    normal=along_y.cross(around).normalized()
    tangent=(Vector(fuselage_point(cargo_seam_y(a+.001),a+.001))-Vector(fuselage_point(cargo_seam_y(a-.001),a-.001))).normalized()
    long_axis=normal.cross(tangent).normalized();wide_axis=normal.cross(long_axis).normalized()
    latch=plate('Cargo_latch_'+side,p,(.009,.10,.032),metal,bevel=.004)
    latch.rotation_mode='QUATERNION';latch.rotation_quaternion=Matrix((normal,long_axis,wide_axis)).transposed().to_quaternion()
    base=p+normal*.009
    handle=[base-long_axis*.034+wide_axis*.008,base+long_axis*.034+wide_axis*.008+normal*.008,base+long_axis*.034-wide_axis*.008+normal*.008,base-long_axis*.034-wide_axis*.008]
    line('Cargo_latch_handle_'+side,handle,.0035,carbon,sides=6)
# 仅留下真实可见的腹部纵向接合边与尾梁环缝。
lower_join_paths=[[fuselage_point(y,a,.003) for y in [-1.34,-.9,-.2,.5,1.1,1.6,2.05]] for a in (math.pi*1.21,math.pi*1.79)]
line('Tail_boom_join',[BASE_FUSELAGE_POINT(2.08,i*2*math.pi/48,.003) for i in range(48)],.003,seam,sides=4,closed=True)
sphere('Dorsal_small_receiver',fuselage_point(-1.10,math.pi/2,.006),(.052,.067,.015),body,segments=16,rings=8)
sphere('Tail_receiver',fuselage_point(1.01,math.pi/2,.009),(.036,.052,.012),body,segments=16,rings=8)
antenna_base=Vector(fuselage_point(-.89,math.pi/2,.001))
line('Dorsal_antenna',[antenna_base,antenna_base+Vector((0,.02,.15))],.006,carbon,sides=8)
# 机腹细天线和小型传感器窗，按可见位置独立制作而非复制照片。
for x,y,depth in [(-.065,-1.68,.24),(.075,-1.87,.17)]:
    _,w,h,z=section_at(body_dense,y)
    c=math.copysign((abs(x)/w)**(1/.83),x);a=-math.acos(c)
    base=Vector(fuselage_point(y,a,-.001))
    line('Ventral_antenna',[base,base+Vector((0,0,-depth))],.0075,carbon,sides=8)
_,sensor_w,_,_=section_at(body_dense,-2.01)
sensor_angle=-math.acos(-(.11/sensor_w)**(1/.83))
sensor_base=Vector(fuselage_point(-2.01,sensor_angle,.002))
plate('Ventral_small_sensor',sensor_base,(.115,.10,.014),carbon,bevel=.018)
# 前舱腹线直接延伸至固定短翼，形成真实网格接合；不再外挂枕形补体。
# 尾下白色短片是有厚度的梯形，照片中其前缘稍向后倾斜。
mesh_object('Ventral_tail_tab',[(-.016,1.96,.025),(.016,1.96,.025),(.016,2.23,.025),(-.016,2.23,.025),(-.013,2.00,-.23),(.013,2.00,-.23),(.013,2.21,-.23),(-.013,2.21,-.23)],[(0,1,2,3),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0),(4,7,6,5)],body,smooth=False)

# 两侧低轮廓输出共用一个纵向自由度；V19在后处理添加真实横梁与原创内部驱动。
spreader=empty('BraceSpreader',(0,slider_at(0),SLIDER_Z))
body_stud=Vector((1,0,0))
# 保留V18杆端和滑架坐标；V19实体横梁在内部驱动后处理生成。
slider_samples=[slider_at(i/1000) for i in range(1001)]
slider_min,slider_max=min(slider_samples),max(slider_samples)
# V22: the real forward output aperture follows the measured mechanism sweep;
# the original aft narrow run and exterior mold line remain.
from output_slot_geometry import prism as output_roof_prism
from output_slot_profile import SLOT_OUTLINE, SLOT_BOTTOM_Z, SLOT_TOP_Z, prism as output_prism, trim_seam, resample_rear_seam
from annotated_mechanism import slot_preflight
EARLY_SLOT_PLAN=slot_preflight(SLOT_OUTLINE)
# Prepare the actual unchanged cut before it is made, using the final-target plan.
slot_min,slot_max=EARLY_SLOT_PLAN['travel']['minimumY'],EARLY_SLOT_PLAN['travel']['maximumY']
SLOT_CENTER_X,SLOT_WIDTH=.10575,.0205
for sign,side in [(-1,'L'),(1,'R')]:
    cutter=output_prism(globals(),'Temporary_side_slot',sign,SLOT_BOTTOM_Z,SLOT_TOP_Z,None)
    hull=bpy.data.objects['Fuselage'];mod=hull.modifiers.new('V22真实圆端变宽输出扫掠槽','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
    bpy.context.view_layer.update();bpy.context.view_layer.objects.active=hull;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
    output_roof_prism(globals(),'ActuatorSideSlot_'+side,sign,.106,.114,carbon)
seam_segments_outside_slots=trim_seam
for path in lower_join_paths:
    for segment in seam_segments_outside_slots(path):line('Lower_fuselage_join',resample_rear_seam(segment),.003,seam,sides=4)

DETAIL_WING_STATIONS={}
DETAIL_TAIL_STATIONS={}
V12_FIXED_STATIONS={}
for s in (-1,1):
    side='L' if s<0 else 'R'
    # 高展弦比、明显上反的 V 尾，前缘蓝边与薄后缘。
    tail_stations=[(s*.065,1.77,.85,.135,.09),(s*.30,1.87,.83,.325,.08),(s*1.27,2.34,.62,1.16,.065),(s*1.61,2.50,.55,1.46,.05),(s*1.65,2.535,.46,1.48,.04)]
    DETAIL_TAIL_STATIONS[side]=tail_stations
    wing('V_tail_'+side,tail_stations,body)
    skin_band('V_tail_blue_leading_'+side,tail_stations,0,.13,blue,None)
    line('Tail_control_seam_'+side,[airfoil_point(st,.74,True) for st in tail_stations[1:]],.0032,seam,sides=4)
    # 尾尖细前伸天线；两侧照片支持同系列布置，保持细而短。
    t=airfoil_point(tail_stations[-2],.30,True)
    line('Tail_tip_antenna_'+side,[(t[0],t[1],t[2]),(t[0],t[1]-.31,t[2]+.005)],.0055,carbon,sides=6)
    for u in (.13,.74):
        st=tail_stations[1];pt=airfoil_point(st,u,True)
        sphere('Tail_root_fastener_'+side,pt,(.010,.013,.006),metal,segments=8,rings=4)
    # 可见外部斜轴关节。轴线与实际运动严格共轴，尺寸是独立外观近似。
    axis=wing_axis(s);origin=pivot_position(s)
    fixed=root_stations(s,PIVOT_X,PIVOT_Y,PIVOT_Z)
    V12_FIXED_STATIONS[side]=fixed
    shaft_bore(clip_joint(wing('Fixed_root_'+side,fixed,body),origin,axis,True),origin,axis)
    clip_joint(skin_band('Fixed_root_blue_'+side,fixed,0,.12,blue,None),origin,axis,True,False)
    pivot=empty('WingPivot_'+side,origin)
    pivot.rotation_mode='QUATERNION';pivot.rotation_quaternion=wing_rotation(s,0)
    empty('RootAxisStart_'+side,origin-axis*.155)
    empty('RootAxisEnd_'+side,origin+axis*.155)
    cylinder_between('RootHingeShaft_'+side,origin-axis*.088,origin+axis*.088,.014,metal)
    for end,t in [('Front',-.050),('Rear',.060)]:
        center=origin+axis*t
        empty('RootBearingCenter_'+side+'_'+end,center)
        ring_axis('RootBearingFixed_'+side+'_'+end,center,axis,.028,.017,.022,metal)
        ring_axis('RootBearingSeal_'+side+'_'+end,center,axis,.026,.016,.026,carbon)
    # 外翼侧回转套、轴向止推圈和外观盖；都附属于同一外翼刚体。
    ring_axis('RootCarrierMoving_'+side,-axis*.020,axis,.039,.030,.047,carbon,pivot)
    ring_axis('RootCarrierThrust_'+side,-axis*.002,axis,.039,.030,.009,metal,pivot)
    shaft_bore(clip_joint(cylinder_between('RootCarrierBridge_'+side,-axis*.029,(s*.090,-.050,-.012),.018,body,pivot),(0,0,0),axis,False),(0,0,0),axis,radius=.0305)
    cylinder_between('RootFixedBearingPedestal_'+side,origin+axis*.060,origin+Vector((-s*.075,-.042,.0)),.019,body)
    # 紧凑的平盖和真正沿轴线放置的端部紧固件。
    # 小检修边界直接贴合翼型，移除旧版悬空的厚方盖。
    cover=[]
    for xx,yy in rounded_rect(s*(PIVOT_X-.28),PIVOT_Y-.11,.18,.18,.045,7):
        st=wing_station(fixed,xx);u=(yy-st[1])/st[2];q=airfoil_point(st,u,True)
        cover.append((q[0],q[1],q[2]+.002))
    line('Root_access_cover_'+side,cover,.0023,seam,closed=True,sides=5)
    for old_t,t in [(-.148,-.088),(.148,.088)]:
        cylinder_between('RootHingeEndcap_'+side+str(old_t),origin+axis*(t-.005),origin+axis*(t+.005),.018,metal,vertices=6)
    stations=[(-s*.70,-.50,.86,0,.12),(s*.23,-.49,.86,0,.115),(s*1.28,-.45,.83,0,.105),(s*2.45,-.40,.77,.01,.095),(s*3.12,-.345,.71,.018,.085),(s*3.38,-.325,.68,.032,.075),(s*3.52,-.312,.66,.07,.065),(s*3.61,-.289,.63,.13,.055),(s*3.67,-.253,.576,.19,.045),(s*3.70,-.18,.43,.23,.035)]
    stations=[(xx+(s*.25 if k else 0),le,c,z,r) for k,(xx,le,c,z,r) in enumerate(stations)]
    stations=moving_stations(s,PIVOT_X,stations)
    DETAIL_WING_STATIONS[side]=stations
    shaft_bore(clip_joint(wing('Composite_wing_'+side,stations,body,pivot),(0,0,0),axis,False),(0,0,0),axis)
    clip_joint(skin_band('Wing_blue_leading_'+side,stations[:-2],0,.105,blue,pivot),(0,0,0),axis,False,False)
    wing_patch('Wing_blue_angular_panel_'+side,stations,[(s*.71,.10),(s*2.18,.10),(s*2.23,.76),(s*1.51,.76),(s*1.04,.33)],blue,pivot)
    wing_patch('Wing_blue_aileron_accent_'+side,stations,[(s*2.30,.79),(s*2.80,.79),(s*2.86,.89),(s*2.34,.91)],blue,pivot)
    # 不复制 P4 或 PteroDynamics 标识；翼尖保留同色面，不印制编号。
    for upper in (True,False):
        line('Aileron_seam_'+side,[airfoil_point(st,.78,upper) for st in stations[1:-2]],.0032,seam,pivot,sides=4)
    # 小型圆角服务口和拉杆，贴着机翼表面而不悬浮。
    for panel_x in (s*1.07,s*2.76):
        pts=[]
        for xx,u in rounded_rect(panel_x,.60,.15,.21,.04,5):
            pts.append(airfoil_point(wing_station(stations,xx),u,False))
        line('Wing_service_panel_'+side,pts,.0028,seam,pivot,sides=4,closed=True)
    for x in (s*1.05,s*2.75):
        st=wing_station(stations,x);pt=airfoil_point(st,.66,True)
        line('Aileron_horn_'+side,[(pt[0],pt[1],pt[2]),(pt[0],pt[1]-.04,pt[2]+.045),(pt[0],pt[1]+.09,pt[2]+.02)],.009,metal,pivot,sides=6)
    # Rigid control rods between a true off-axis wing joint and one shared slider.
    wing_local=brace_wing_local(s)
    empty('BraceBody_'+side,(s*SLIDER_X,0,0),spreader)
    empty('BraceWing_'+side,wing_local,pivot)
    brace_root=empty('BraceRod_'+side);length=brace_length(s)
    cylinder_between('BraceRod_mesh_'+side,(0,0,.034),(0,0,length-.034),.012,carbon,brace_root,vertices=12)
    for label,z in [('Body',.060),('Root',length-.060)]:
        cylinder_between('BraceRodFerrule_'+side+'_'+label,(0,0,z-.023),(0,0,z+.023),.017,metal,brace_root,vertices=16)
    for label,z in [('Body',0),('Root',length)]:
        spherical_rod_eye('BraceRodEye_'+side+'_'+label,(0,0,z),brace_root)
        cylinder_between('BraceRodEyeNeck_'+side+'_'+label,(0,0,z+(.026 if label=='Body' else -.026)),(0,0,z+(.049 if label=='Body' else -.049)),.015,metal,brace_root,vertices=12)
    body_local=Vector((s*SLIDER_X,0,0))
    sphere('BraceBall_'+side+'_Body',body_local,(.018,.018,.018),carbon,spreader,segments=16,rings=8)
    body_stud_side=Vector((-s*.664,-.307,.679)).normalized()
    cylinder_between('BraceBallPin_'+side+'_Body',body_local-body_stud_side*.022,body_local+body_stud_side*.042,.0045,metal,spreader,vertices=12,bevel_width=.0007)
    sphere('BraceBall_'+side+'_Wing',wing_local,(.018,.018,.018),carbon,pivot,segments=16,rings=8)
    # 小型单侧球头支座贴近翼腹，不再使用上下外凸的矩形叉耳笼。
    stud=Vector((0,0,1))
    cylinder_between('BraceBallPin_'+side+'_Wing',wing_local-stud*.031,wing_local+stud*.022,.0045,metal,pivot,vertices=12,bevel_width=.0007)
    for which,position in [('Front',2.12),('Rear',3.75)]:
        x=s*(position-PIVOT_X);y=.02
        # 完整吊舱/着陆尾尖：长度约 2.263、最大宽 .44；没有细杆球脚。
        pod_sections=[(-.82,.186,.177,.006),(-.65,.223,.201,.008),(-.38,.235,.217,.004),(.05,.235,.218,0),(.40,.218,.201,-.004),(.62,.174,.163,-.012),(.81,.112,.110,-.025),(.96,.055,.057,-.035),(1.04,.018,.022,-.035)]
        lathe_y('Nacelle_'+side+'_'+which,pod_sections,body,pivot,radial=40,interpolate=4,offset=(x,y,0))
        cap_sections=[(-1.228,.008,.011,.005),(-1.196,.052,.06,.006),(-1.12,.112,.121,.008),(-.99,.163,.162,.008),(-.82,.186,.177,.006)]
        lathe_y('Motor_cowl_'+side+'_'+which,cap_sections,carbon,pivot,radial=40,interpolate=4,offset=(x,y,0))
        lathe_y('Landing_wear_tip_'+side+'_'+which,[(.994,.034,.036,-.034),(1.039,.019,.023,-.035),(1.052,.009,.013,-.035)],wear,pivot,radial=20,interpolate=2,offset=(x,y,0))
        dense=catmull(pod_sections,5)
        def pod_point(yy,a,inflate=.004):
            _,ww,hh,zz=section_at(dense,yy)
            return (x+(ww+inflate)*math.cos(a),y+yy,zz+(hh+inflate)*math.sin(a))
        # 每侧真实可见的 U/圆角长盖板：纵向直边和尾部圆弧，替代整圈分段缝。
        for angle in (0,math.pi):
            pts=[pod_point(yy,a) for yy,a in resample_closed(rounded_rect(-.05,angle,1.44,1.48,.21,8),.045)]
            line('Pod_U_access_panel_'+side+'_'+which,pts,.0028,seam,pivot,sides=4,closed=True)
        line('Cowl_boundary_'+side+'_'+which,[pod_point(-.819,a,.002) for a in [i*2*math.pi/48 for i in range(48)]],.0026,seam,pivot,sides=4,closed=True)
        # 机翼穿入吊舱的上部鞍形整流小罩及两条短接合线。
        saddle=[];saddle_faces=[]
        for row in range(9):
            yy=-.26+row*.055
            _,ww,hh,zz=section_at(dense,yy)
            for col in range(7):
                dx=-.13+col*.26/6
                saddle.append((x+dx,y+yy,zz+hh*math.sqrt(max(0,1-(dx/ww)**2))+.002))
        for row in range(8):
            for col in range(6):
                a=row*7+col;saddle_faces.append((a,a+1,a+8,a+7))
        mesh_object('Pod_wing_saddle_'+side+'_'+which,saddle,saddle_faces,body,pivot)
        for xx in (-.13,.13):
            pts=[]
            for yy in [-.26+i*.055 for i in range(9)]:
                _,ww,hh,zz=section_at(dense,yy)
                pts.append((x+xx,y+yy,zz+hh*math.sqrt(max(0,1-(xx/ww)**2))+.004))
            line('Pod_mount_seam_'+side+'_'+which,pts,.0022,seam,pivot,sides=4)
        # 独立电机轴标记与真实轴段共线；桨盘前移以留出收桨间隙。
        prop_origin=Vector((x,y-1.30,0))
        empty('MotorAxisStart_'+side+'_'+which,prop_origin+Vector((0,.12,0)),pivot)
        empty('MotorAxisEnd_'+side+'_'+which,prop_origin+Vector((0,-.10,0)),pivot)
        cylinder_between('Motor_spindle_'+side+'_'+which,prop_origin,prop_origin+Vector((0,.12,0)),.016,metal,pivot,vertices=16)
        motor=empty('Prop_'+side+'_'+which,prop_origin,pivot)
        motor.rotation_euler=(math.pi/2,0,0)
        spinner=sphere('Spinner_'+side+'_'+which,(0,0,0),(.080,.080,.033),carbon,motor,segments=20,rings=10)
        # 桨帽真实盲孔包住独立轴段；前端保留完整帽壳，不再让转动实心帽吞入轴料。
        spindle_bore=cylinder_between('Temporary_spinner_axle_bore',(0,0,-.14),(0,0,.003),.017,metal,motor,vertices=32,bevel_width=0)
        bpy.context.view_layer.update()
        mod=spinner.modifiers.new('Actual spindle blind clearance bore','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=spindle_bore
        bpy.context.view_layer.objects.active=spinner;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(spindle_bore,do_unlink=True)
        spinner.data.set_sharp_from_angle(angle=math.radians(42))
        for blade_s in (-1,1):
            letter='A' if blade_s<0 else 'B'
            fold=empty('BladeFold_'+side+'_'+which+'_'+letter,(blade_s*.230,0,0),motor)
            # V9：定铰为真实叉形支座和Y向销轴；臂位于叶根轴套两侧，
            # 折叠扫掠区不再穿过一根实心径向粗管。叶根轴套在下面并入桨叶。
            outline=[(.075,-.050),(.240,-.050),(.240,-.036),(.095,-.036),
                     (.095,.036),(.240,.036),(.240,.050),(.075,.050)]
            verts=[(blade_s*r,yy,zz) for zz in (-.008,.008) for r,yy in outline]
            n=len(outline);faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]
            faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
            arm=mesh_object('Blade_hinge_arm_'+side+'_'+which+'_'+letter,verts,faces,carbon,motor,False)
            bm=bmesh.new();bm.from_mesh(arm.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(arm.data);bm.free()
            mod=arm.modifiers.new('Compact fork edge radii','BEVEL');mod.width=.002;mod.segments=2
            bpy.context.view_layer.objects.active=arm;bpy.ops.object.modifier_apply(modifier=mod.name)
            cylinder_between('Blade_hinge_pin_'+side+'_'+which+'_'+letter,
                             (blade_s*.230,-.052,0),(blade_s*.230,.052,0),.006,metal,motor,vertices=20,bevel_width=.001)
            # 展开桨叶展向中心线严格共面；仅弦向翼型/安装角，不做轴向展向弯曲。
            # 收桨间隙由前移桨盘及较外侧铰点获得，保持总半径约0.78。
            base_stations=[(.002,-.026,.055),(.0865,-.045,.11),(.2585,-.031,.123),(.4043,.008,.108),(.5086,.048,.058),(.550,.067,.018)]
            blade_stations=[(blade_s*r,le if blade_s>0 else -le-ch,ch,0,.10 if k<2 else .065) for k,(r,le,ch) in enumerate(base_stations)]
            blade=wing('Blade_'+side+'_'+which+'_'+letter,blade_stations,carbon,fold)
            # 两片桨保持绕轴180度对应；6度弦向安装角不改变各截面轴向中心。
            pitch=blade_s*math.radians(6)
            for vertex in blade.data.vertices:
                st=wing_station(blade_stations,vertex.co.x);center=st[1]+st[2]/2
                dy=vertex.co.y-center;z=vertex.co.z
                vertex.co.y=center+dy*math.cos(pitch)-z*math.sin(pitch)
                vertex.co.z=dy*math.sin(pitch)+z*math.cos(pitch)
            blade.data.update()
            # 有孔的转动叶根与桨叶真实并为封闭实体。孔半径.0085、销半径.006，
            # 共轴径向净空.0025；轴套端面±.029，叉臂内面±.036。
            sleeve=ring_axis('Temporary_blade_root_sleeve',(0,0,0),(0,1,0),.022,.0085,.058,carbon,fold)
            bpy.context.view_layer.update()
            mod=blade.modifiers.new('Closed bonded blade root sleeve','BOOLEAN');mod.operation='UNION';mod.solver='EXACT';mod.object=sleeve
            bpy.context.view_layer.objects.active=blade;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(sleeve,do_unlink=True)
            bore=cylinder_between('Temporary_blade_root_bore',(0,-.09,0),(0,.09,0),.0085,metal,fold,vertices=36,bevel_width=0)
            bpy.context.view_layer.update()
            mod=blade.modifiers.new('Actual folding pin clearance bore','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=bore
            bpy.context.view_layer.objects.active=blade;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(bore,do_unlink=True)
            blade.data.set_sharp_from_angle(angle=math.radians(42))
            if blade_s>0:
                # 只清理布尔叶根小于1e-9的数值碎边；所有导出面先明确三角化。
                # A/B本来就是绕桨轴180°对应，从同一封闭B叶派生A，避免重复
                # 浮点布尔在对称两侧产生不同的共点碎面；不改翼型或孔腔包络。
                bm=bmesh.new();bm.from_mesh(blade.data)
                bmesh.ops.triangulate(bm,faces=list(bm.faces))
                bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-9)
                bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-9)
                bmesh.ops.triangulate(bm,faces=list(bm.faces))
                assert all(e.is_manifold for e in bm.edges),'Blade root cleanup must remain closed'
                assert all(f.calc_area()>1e-18 for f in bm.faces),'No zero-area blade triangles'
                bm.normal_update();bm.to_mesh(blade.data);bm.free()
                blade.data.set_sharp_from_angle(angle=math.radians(42))
                opposite=bpy.data.objects['Blade_'+side+'_'+which+'_A']
                opposite.data=blade.data.copy()
                for vertex in opposite.data.vertices:vertex.co.x*=-1;vertex.co.y*=-1
                opposite.data.update()


# V10独立后处理：保留V9主机构与孔腔，细化有证据的6舵面和外壳。
from airframe_accessories import build_details
DETAIL_MANIFEST=build_details(globals(),PRESERVED_CONCEPT_MANIFEST)
from wing_seam import finish_wing_seam_topology
WING_SEAM_TOPOLOGY=finish_wing_seam_topology()
# V11只实施经新增帧与原照片交叉支持的局部轮廓。
from airframe_refinements import build_refinements
VIDEO_REFINEMENTS=build_refinements(globals())
SURFACE_REFINEMENTS=build_surface_refinements(globals())
from propeller_shape import build_propeller_refinements
PROP_REFINEMENTS=build_propeller_refinements(globals())
from rotor_handedness import build_rotor_handedness
ROTOR_HANDEDNESS=build_rotor_handedness(globals())
from central_wing_attachment import build_central_attachment
CENTRAL_ATTACHMENT=build_central_attachment(globals())
EMBEDDED_JOINTS=finish_embedded_joints(globals())
from annotated_native_stage import (rebase_native_assemblies, apply_required_after_root_hook,
    fit_and_bind_final_mechanism, build_compact_supported_hinge, finish_root_paint, decorate_manifest)
from annotated_root_interface import build_annotated_root_interface, finish_annotated_root_interface
install_native_diagnostics()
ANNOTATED_REBASE=run_stage('rebase',lambda:rebase_native_assemblies(globals()))
ANNOTATED_OUTER_PAINT_STOCK=run_stage('native-outer-paint-stock',lambda:prepare_native_outer_paint(globals()))
LAYERED_WING_JOINT=run_stage('root-build',lambda:build_annotated_root_interface(globals()))
run_stage('repair-trim',lambda:finish_annotated_root_interface(LAYERED_WING_JOINT))  # repair4 then trim2 once
ANNOTATED_ROOT_CLOSING=run_stage('v6b-closing',lambda:apply_required_after_root_hook(globals(),LAYERED_WING_JOINT))
ANNOTATED_MECHANISM=run_stage('actual-skin-linkage',lambda:fit_and_bind_final_mechanism(globals(),ANNOTATED_REBASE,LAYERED_WING_JOINT,EARLY_SLOT_PLAN))
LAYERED_WING_JOINT['closedWingSolids']=LAYERED_WING_JOINT['mainWingSolids']
LAYERED_WING_JOINT['closedWingSolidsScope']='Original pre-repair construction checks; final v6b material is independently gated'
from nacelle_wing_layout import reposition_nacelles
slider_samples=[slider_at(i/1000) for i in range(1001)]
slider_min,slider_max=min(slider_samples),max(slider_samples)
from linkage_geometry import build_linkage_details
LINKAGE_REFINEMENTS=run_stage('linkage-seats',lambda:build_linkage_details(globals()))
from internal_drive import build_internal_drive
INTERNAL_DRIVE=run_stage('internal-drive',lambda:build_internal_drive(globals()))
from joint_endcaps import build_joint_refinements
JOINT_REFINEMENTS=run_stage('joint-refinements',lambda:build_joint_refinements(globals()))
from hinge_supports import build_hinge_supports
HINGE_SUPPORTS=run_stage('hinge-supports',lambda:build_hinge_supports(globals()))
from control_supports import build_control_supports
CONTROL_SUPPORTS=run_stage('control-supports',lambda:build_control_supports(globals()))
from legacy_powertrain_fit import prepare_and_install_for_native_context
LEGACY_POWERTRAIN_RESTORATION=run_stage('legacy-powertrain-restoration',lambda:prepare_and_install_for_native_context(globals()))
from surface_supports import build_surface_supports
SURFACE_SUPPORTS=run_stage('surface-supports',lambda:build_surface_supports(globals()))
SURFACE_SUPPORTS['nativeProtected64ExactIdentityPending']=True
SURFACE_SUPPORTS['legacyPowertrainRestoration']=LEGACY_POWERTRAIN_RESTORATION
from joint_fairings import build_fairing_refinements
FAIRING_REFINEMENTS=run_stage('source-fairings',lambda:build_fairing_refinements(globals()))
# Housing and all four original covers now exist; do not compact earlier.
ANNOTATED_SUPPORTED_HINGE=run_stage('compact-supported-hinge',lambda:build_compact_supported_hinge(globals()))
WING_SURFACE_REPAIR=LAYERED_WING_JOINT['repair']
from surface_finish import build_surface_finish
# Final actual-host coating assignment is deferred until all body preservation is done.
from preserved_surfaces import preserve_untouched, finish_topology
SLOT_PROFILE_CONFIG['preservation']=preserve_untouched(globals())
SLOT_PROFILE_CONFIG['initialTopology']=finish_topology()
from slot_topology import canonicalize_lip_nodes, restore_central_floor, fit_adjacent_seams
SLOT_PROFILE_CONFIG['lipNodeConstruction']=canonicalize_lip_nodes(globals())
SLOT_PROFILE_CONFIG['lipNodeTopology']=finish_topology()
SLOT_PROFILE_CONFIG['centralFloorPreservation']=restore_central_floor(globals())
SLOT_PROFILE_CONFIG['preservation']=preserve_untouched(globals())
SLOT_PROFILE_CONFIG['topology']=finish_topology()
SLOT_PROFILE_CONFIG['normalRefinement']=refine_normals(globals())
SLOT_PROFILE_CONFIG['adjacentSeamFit']=fit_adjacent_seams(globals())
CENTRAL_ATTACHMENT_LIFT={'applied':False,'lift':0,'changedVertices':[],'reason':'Fresh native common-natural root; neither old fixed lift nor central lift is applied'}
NACELLE_LAYOUT=reposition_nacelles(globals())
ANNOTATED_ROOT_PAINT=run_stage('final-root-paint',lambda:finish_root_paint(globals()))
SURFACE_FINISH_V22=build_surface_finish(globals())
from annotated_low_angle_relief import apply_bounded_low_angle_relief
ANNOTATED_LOW_ANGLE_RELIEF=run_stage('bounded-low-angle-relief',apply_bounded_low_angle_relief)
from annotated_principal_side_closure import apply_bounded_principal_side_closure
ANNOTATED_PRINCIPAL_SIDE_CLOSURE=run_stage('bounded-principal-side-closure',lambda:apply_bounded_principal_side_closure(
    root_objects={name:bpy.data.objects[name]for name in ('Fixed_root_L','Fixed_root_R','Composite_wing_L','Composite_wing_R')},
    wing_pivots={name:bpy.data.objects[name]for name in ('WingPivot_L','WingPivot_R')}))

scene=bpy.context.scene
# 可编辑源文件、独立GLB和网页模型共用确定性的烘焙动作。
import importlib.util
spec=importlib.util.spec_from_file_location('transition_export',os.path.join(ROOT,'scripts/export-transition.py'))
transition_export=importlib.util.module_from_spec(spec);spec.loader.exec_module(transition_export)
run_stage('bake-actions',transition_export.bake_transition)
aircraft=[o for o in scene.objects if o.type=='MESH']
ground_min=min((o.matrix_world@v.co).z for o in aircraft for v in o.data.vertices)
triangles=sum(sum(len(face.vertices)-2 for face in obj.data.polygons) for obj in aircraft)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SOURCES,'xp4.blend'))
run_stage('export-source-actions',lambda:transition_export.export_transition(os.path.join(SOURCES,'xp4-source.glb')))
for name in ('xp4.blend','xp4-source.glb'):shutil.copy2(os.path.join(SOURCES,name),os.path.join(ROOT,'assets/blender',name))
manifest={'version':24,'referenceBaseline':'原N273PD/10蓝白照片与V14新增四张实机参考；统一型号的原创几何与材质，不复制影像或标识','coordinateSystem':'glTF Y-up, nose +Z, span X','authoredPose':'hover','transition':'oblique wing rotation with rigid moving control rods and a shared longitudinal spreader; dimensions reconstructed, not surveyed production geometry','propellerSpinLocalAxis':'Y','motorAxisMarkers':{'startPrefix':'MotorAxisStart_','endPrefix':'MotorAxisEnd_'},'propellerPlane':'展向中心线垂直电机轴；根至尖分布安装角，与演示旋向匹配的双手性','outerBladeFoldLocalAxis':'Z','outerBladeFoldAngles':{'A':math.pi/2,'B':-math.pi/2},'variants':{'xp4':{'file':'xp4.glb','meshes':len(aircraft),'triangles':triangles,'span':HALF_SPAN*2,'groundContactMinY':ground_min,'fuselageLength':5.44,'fuselageMaxWidth':1.24,'fuselageCoreMaxWidth':1.116,'fuselageMergedMeshMaxWidth':1.24,'podLength':2.28,'podMaxWidth':.47,'rootChord':.86,'outerPanelChord':.76,'propellerRadius':.78,'tailSpan':3.30,'pivots':{'WingPivot_L':{'axis':[.577350269,.577350269,.577350269],'angle':2.0943951024},'WingPivot_R':{'axis':[-.577350269,.577350269,.577350269],'angle':-2.0943951024}},'props':['Prop_L_Front','Prop_L_Rear','Prop_R_Front','Prop_R_Rear']}}}
manifest['detailRevision']={'version':14,'targets':sorted(o.name for o in aircraft if o.name.startswith(('Fixed_root_L','Fixed_root_R','Composite_wing_','RootHingeShaft_','RootHingeEndcap_','RootBearingFixed_','RootBearingSeal_','RootCarrierMoving_','RootCarrierThrust_','RootCarrierBridge_','RootFixedBearingPedestal_'))),'reference':'V14新增实机图2和图4支持的局部壳边错层与窄槽短轴；全部四动力折桨是本轮用户功能要求。原创重建尺寸与演示时序，不是原厂CAD或飞控','mechanismBaselineVersion':9,'controlSurfaceBaselineVersion':10,'unchangedLandingEndsVersion':11,'unchangedSurfaceAndPropellerBaselineVersion':12}
manifest['airframeDetails']=DETAIL_MANIFEST
manifest['videoRefinements']=VIDEO_REFINEMENTS
manifest['surfaceRefinements']=SURFACE_REFINEMENTS
manifest['centralAttachment']=CENTRAL_ATTACHMENT
manifest['compactPropellers']={**PROP_REFINEMENTS,'version':15,'bladePitchDegrees':None,'bladePitchDefinition':'V15用rotorHandedness.radialSections替换V12统一6度','sourceBoundary':'紧凑铰点、叉耳、孔腔沿用V12；V15双手性和扭转为原创演示几何，不是原厂参数。'}
manifest['rotorHandedness']=ROTOR_HANDEDNESS
manifest['embeddedWingJoints']=EMBEDDED_JOINTS
manifest['animation']={'name':transition_export.CLIP,'durationSeconds':199/24,'frames':200,'fps':24,'channels':18,'portable':True,'description':'Whole-wing hover to cruise and return; baked wing, rear-blade fold, and brace channels. Website uses its own rig and does not auto-play this clip.'}
manifest['drivePhaseEncodingV22']=transition_export._read_glb(os.path.join(SOURCES,'xp4-source.glb'))[0]['extras']['drivePhaseEncodingV22']
manifest['nativeDriveConstraintV22']={'method':'persistent local simple sin/cos quaternion expressions','input':'BraceSpreader.location[1]','independentDegreesOfFreedom':0,'externalFunctionsRequired':False}
manifest['animations']=[{'name':transition_export.CLIP,'purpose':'原整翼机构回归基准','frames':[0,199],'fps':24,'channels':18},{'name':transition_export.MOTOR_CLIP,'purpose':'四动力先展开再转动、停转寻位再收桨','frames':[0,168],'fps':24,'channels':26,'durationSeconds':7,'timingIsIllustrative':True}]
manifest['rootInterface']={'surface':'前部连续退让曲面与轴旁同轴孔腔共同构成上下错层；活动上皮真实让位，下皮为有限承托材料','axisHalfGap':ROOT_HALF_GAP,'axisHalfGapScope':'兼容字段，仅为旧同轴构造半间隙；当前上开口及下盆间隙参见layeredWingJoint，不代表全局最小净空','hardwareProfile':'原同轴径向曲面只用于轴旁过渡与硬件分缝','booleanBevelUsed':False,'visualReconstruction':True,'geometryContract':'layeredWingJoint'}
manifest['layeredWingJoint']=LAYERED_WING_JOINT
manifest['nacelleLayout']=NACELLE_LAYOUT
manifest['centralAttachmentLift']=CENTRAL_ATTACHMENT_LIFT
manifest['wingSeamTopology']={'version':24,'parts':LAYERED_WING_JOINT['closedWingSolids'],'method':'四个当前主翼实体的闭合、正体积、非退化三角面；旧预构造布尔报告不能替代本结果'}
manifest['straightFuselageSlot']=SLOT_PROFILE_CONFIG
manifest['wingSeamRefinement']={'version':24,'changedNodes':['Fixed_root_L','Fixed_root_R','Composite_wing_L','Composite_wing_R','Fixed_root_blue_L','Fixed_root_blue_R','Wing_blue_leading_L','Wing_blue_leading_R','BraceWingSeat_L','BraceWingSeat_R'],'axialGap':2*ROOT_HALF_GAP,'hardwareHalfGapPreserved':HARDWARE_HALF_GAP,'fairingSeamPreserved':.003,'method':'连续前部轮廓、实体上下错层、实际移轴和球心内移；不继承旧曲面或旧运动配对身份','claimBoundary':'当前实际网格和全程采样另验；非连续碰撞、制造性或适航证明'}
manifest['surfaceRefinements']['root']={'fixedNodes':['Fixed_root_L','Fixed_root_R'],'movingNodes':['Composite_wing_L','Composite_wing_R'],'sharedCruiseLoft':SURFACE_REFINEMENTS['root']['sharedCruiseLoft'],'axisHalfGap':ROOT_HALF_GAP,'mechanismAxesUnchanged':False,'geometryContract':'layeredWingJoint','visualReconstructionNotFactoryDimensions':True}
manifest['embeddedWingJoints']['scope']='本构造阶段为旧局部硬件基元；最终主翼实体由layeredWingJoint替换，主轴位置和整翼运动已重新计算'
for key in ('fixedRootTopology','rootSkinNormals','rootPaintProjection'):manifest['surfaceRefinements'].pop(key,None)
manifest['surfaceRefinements']['currentRootEvidence']='当前几何及法线由layeredWingJoint、surfaceFinishV22和独立源/运行验证登记；不继承旧翼根统计'
manifest['embeddedWingJoints'].pop('changedRootNormals',None)
manifest['centralAttachment'].pop('fixedRoots',None)
manifest['centralAttachment'].pop('paintTaper',None)
manifest['centralAttachment']['currentRootEvidence']='固定中央翼等厚上移，机身相接鞍面由centralAttachmentLift作有限C1抬升；外接固定翼及蓝边由layeredWingJoint当前重建'
manifest['centralAttachment']['preserved']=['centralAttachmentLift明确域外的原前舱腔体与机壳；域内鞍面有限抬升','CargoHoodShell及0–55度开盖轴','两腹部探头','旋翼部件局部几何；当前世界运动另验']
manifest['detailRevision']['reference']='原实机外观参考的局部基元，加当前用户标注的连续分层翼根与真实移轴；原创概念尺寸，不是原厂CAD或飞控'
manifest['detailRevision']['currentGeometryContract']='layeredWingJoint'
manifest['detailRevision'].pop('unchangedSurfaceAndPropellerBaselineVersion',None)
manifest['pivotAngleMeaning']='signed rotation delta from authored folded pose to cruise; mechanism.foldAngle is the opposite cruise-to-folded angle'
manifest['mechanism']={'version':24,'rootClearance':2*ROOT_HALF_GAP,'rootClearanceScope':'兼容字段，仅保留旧局部轴向参数；当前真实三维间隙必须由layeredWingJoint和独立三角材料检查确定','type':'机身直出紧凑滑架、正装翼上球座、定长控制杆；共用纵向自由度','source':'PteroDynamics UAFM section 2.4.7, publicly indexed FAA filing FAA-2024-2404-0001 attachment_10, pp19-20; dimensions reconstructed','spreaderNode':'BraceSpreader','sliderAxis':[0,0,-1],'sliderTravel':[slider_min,slider_max],'sliderBodyHeight':SLIDER_Z,'braceScale':[1,1,1],'sides':{side:{'axis':gltf_vector(wing_axis(sign)),'foldAngle':sign*FOLD_ANGLE,'bodyAnchorCruise':gltf_vector(brace_body(sign)),'bodyAnchorLocal':gltf_vector((sign*SLIDER_X,0,0)),'wingAnchorLocal':gltf_vector(brace_wing_local(sign)),'braceLength':brace_length(sign),'rodLocalAxis':[0,1,0],'shaftEndpoints':['RootAxisStart_'+side,'RootAxisEnd_'+side],'bearingCenters':['RootBearingCenter_'+side+'_Front','RootBearingCenter_'+side+'_Rear']} for side,sign in [('L',-1),('R',1)]}}
manifest['linkageSimplification']=LINKAGE_REFINEMENTS
manifest['internalDrive']=INTERNAL_DRIVE
manifest['jointRefinements']=JOINT_REFINEMENTS
manifest['hingeSupports']=HINGE_SUPPORTS
manifest['controlSupports']=CONTROL_SUPPORTS
manifest['surfaceSupports']=SURFACE_SUPPORTS
manifest['wingSurfaceRepair']=WING_SURFACE_REPAIR
manifest['fairingRefinements']=FAIRING_REFINEMENTS
manifest['surfaceFinishV22']=SURFACE_FINISH_V22
manifest['boundedLowAngleRelief']=ANNOTATED_LOW_ANGLE_RELIEF
manifest['mechanism']['actualSlotTravel']=[slot_min,slot_max]
manifest['mechanism']['actualSlotTravelScope']='兼容字段，记录保留槽口的既有制作包络；当前滑架真实行程在sliderTravel，必须检查其位于该包络内'
manifest['mechanism']['slotEnvelopeBlender']={'centerX':SLOT_CENTER_X,'width':SLOT_WIDTH,'bottomZ':SLOT_BOTTOM_Z,'topZ':SLOT_TOP_Z,'actualRoundedOutlineRightXY':SLOT_OUTLINE,'previousTravel':[1.2090788195527518,1.8999999762819604]}
manifest['wingAttachmentReference']={'source':'用户当前标注的蓝点向前、远离边缘指示','worldBlenderCruise':list(WING_ANCHOR_CRUISE),'fitIsIllustrative':True,'exactImagePixelRegistrationClaimed':False}
manifest['internalDrive']['loweredLayout']['bodyBallAndWingTrajectoryUnchanged']=False
manifest['internalDrive']['loweredLayout']['preserved']='机身侧球心、低置固定驱动布局及单直件保持；翼侧球心、杆长、滑架起点和相位按实际新机构重算'
manifest['fairingRefinements']['protectedHardwareUnchangedScope']='仅指当前生成中的罩体构造前后同一硬件网格；主轴位置已由layeredWingJoint真实更新'
manifest['spinnerAxleClearance']={'shaftRadius':.016,'blindBoreRadius':.017,'blindBoreFrontEndLocalZ':.003,'frontCapPreserved':True,'motorInternalTypeNotClaimed':True}
manifest['rodEndSeat']={'type':'spherical retaining bore','ballRadius':.018,'seatRadius':.0185,'halfWidth':.005,'nominalRadialClearance':.0005,'centersUnchanged':False,'seatGeometryUnchanged':True}
manifest['foldingHinge']={'version':12,'pivotRadius':.17,'forkBoreRadius':.0068,'pinAxisBlenderLocal':[0,1,0],'pinRadius':.006,'boreRadius':.0085,'sleeveOuterRadius':.022,'sleeveAxialHalfLength':.029,'forkInnerHalfWidth':.036,'radialClearance':.0025,'axialSideClearance':.007,'actualSolidBore':True,'samePropMovingPartsRequireContactChecks':True}
manifest=decorate_manifest(manifest,globals())
with open(os.path.join(MODELS,'manifest.json'),'w') as file:json.dump(manifest,file,indent=2)

# 解除预览场景的动作绑定，防止渲染器重评估第 1 帧而覆盖手动姿态。
for obj in scene.objects:obj.animation_data_clear()

# 中性摄影棚让轮廓清楚可见；独立验收程序另从压缩 GLB 生成二十张正交图。
scene.render.engine='CYCLES';scene.cycles.samples=int(os.environ.get('TRANSWING_SAMPLES','40'));scene.cycles.use_denoising=False
scene.render.resolution_x=1600;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.72,.75,.78,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.7
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG'
for location,power,size in [((0,-6,10),1600,8),((7,4,9),1800,7),((-7,1,5),1000,6)]:
    bpy.ops.object.light_add(type='AREA',location=location);light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(Vector((0,0,0))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(10,-14,8));camera=bpy.context.object;camera.data.type='ORTHO';camera.data.ortho_scale=12.6;camera.rotation_euler=(Vector((0,.0,.10))-camera.location).to_track_quat('-Z','Y').to_euler();scene.camera=camera

def set_pose(unfold):
    for side,s in [('L',-1),('R',1)]:
        pivot=bpy.data.objects['WingPivot_'+side]
        pivot.rotation_quaternion=wing_rotation(s,unfold)
        for letter,sign in [('A',-1),('B',1)]:
            fold=bpy.data.objects['BladeFold_'+side+'_Rear_'+letter];fold.rotation_euler.y=sign*math.pi/2*max(0,(unfold-.85)/.15)
    update_braces()

if os.environ.get('TRANSWING_RENDER','1')!='0':
    for label,unfold in [('hover',0),('transition50',.5),('cruise',1)]:
        set_pose(unfold)
        scene.render.filepath=os.path.join(PREVIEWS,'xp4-'+label+'-three-quarter.png');bpy.ops.render.render(write_still=True)
    for label in ('hover','cruise'):shutil.copy2(os.path.join(PREVIEWS,'xp4-'+label+'-three-quarter.png'),os.path.join(ROOT,'assets/previews','xp4-'+label+'.png'))
print('P4_V24_COMPLETE',json.dumps(manifest['variants']['xp4']))
