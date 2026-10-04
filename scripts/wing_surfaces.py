"""V12 共用翼根截面与解析外皮法线：原创可视化拟合，不是原厂 CAD。"""
import math
import bpy
from mathutils import Vector
# 展开状态共享同一截面场，避免两套独立拟合在接口处出现高度差。
# 肩部渐变留在关节内侧，不用固定罩跨过活动翼。
ROOT_LOFT=[(.27,-.560,1.000,.025,.132),(.44,-.540,.960,.015,.128),(.62,-.518,.910,.006,.123),(.80,-.503,.874,.001,.118),(1.00,-.499,.862,0,.115),(1.20,-.497,.862,0,.115),(1.42,-.494,.862,0,.115),(1.64,-.492,.861,0,.115),(1.83,-.490,.860,0,.115),(2.00,-.484,.855,0,.1134)]
def root_stations(sign,pivot_x,pivot_y,pivot_z):
    return [(sign*x,pivot_y+le,chord,pivot_z+z,ratio) for x,le,chord,z,ratio in ROOT_LOFT]
def moving_stations(sign,pivot_x,old):
    shared=[(sign*(x-pivot_x),le,chord,z,ratio) for x,le,chord,z,ratio in ROOT_LOFT if x>=.44 and x<=1.83]
    return shared+[st for st in old if sign*st[0]>.48+1e-7]
def _continuous_section(stations,y):
    if y<=stations[0][0]:return stations[0]
    if y>=stations[-1][0]:return stations[-1]
    index=next(i for i,(b,c) in enumerate(zip(stations,stations[1:])) if b[0]<=y<=c[0])
    a=stations[max(index-1,0)];b=stations[index];c=stations[index+1];d=stations[min(index+2,len(stations)-1)]
    def at(t):return tuple(.5*((2*b[j])+(-a[j]+c[j])*t+(2*a[j]-5*b[j]+4*c[j]-d[j])*t*t+(-a[j]+3*b[j]-3*c[j]+d[j])*t*t*t) for j in range(4))
    lo,hi=0.,1.
    for _ in range(30):
        t=(lo+hi)/2
        if at(t)[0]<y:lo=t
        else:hi=t
    return at((lo+hi)/2)
def _nose_drop(y):
    t=max(0,min(1,(-2.05-y)/.67));return .12*t*t*(3-2*t)
def refine_composite_normals(context):
    stations=context['body_sections'];linear_section=context['section_at'];dense=context['body_dense'];surface=context['fuselage_point'];report=[]
    def continuous(y,a,drop=False):
        _,w,h,z=nose_section(stations,y);shoulder=max(0,min(1,(y+2.60)/.90));c=math.cos(a);v=math.sin(a)
        return Vector((w*math.copysign(abs(c)**(1-.17*shoulder),c),y,z+h*math.copysign(abs(v)**(1-(.16 if v>=0 else .35)*shoulder),v)-(_nose_drop(y) if drop else 0)))
    for name in ('Fuselage','CargoHoodShell'):
        obj=bpy.data.objects[name];hood=name=='CargoHoodShell';origin=obj.parent.location.copy() if hood else Vector((0,0,0));cached={};changed=0
        for vertex in obj.data.vertices:
            p=vertex.co+origin;y=p.y;_,w,h,z=linear_section(dense,y);shoulder=max(0,min(1,(y+2.60)/.90));x=p.x/max(w,1e-8);zz=(p.z+(_nose_drop(y) if hood else 0)-z)/max(h,1e-8)
            xx=math.copysign(abs(x)**(1/(1-.17*shoulder)),x);zv=math.copysign(abs(zz)**(1/(1-(.16 if zz>=0 else .35)*shoulder)),zz);a=math.atan2(zv,xx)
            q=Vector(surface(y,a));q.z-=_nose_drop(y) if hood else 0
            # 只修外皮：内腔、输出槽及开口边缘保留原来的独立法线。
            if (p-q).length>.008:continue
            dy=.0001;da=.0002
            ty=continuous(min(stations[-1][0],y+dy),a,hood)-continuous(max(stations[0][0],y-dy),a,hood);ta=continuous(y,a+da,hood)-continuous(y,a-da,hood)
            normal=ty.cross(ta).normalized()
            if y<stations[0][0]+.001:normal=Vector((0,-1,0))
            cached[vertex.index]=normal
        normals=[];existing=[x.vector.copy() for x in obj.data.corner_normals]
        for face in obj.data.polygons:
            for li in face.loop_indices:
                n=cached.get(obj.data.loops[li].vertex_index)
                if n is not None and n.dot(face.normal)>.20:normals.append(tuple(n));changed+=1
                else:normals.append(tuple(existing[li]))
        obj.data.normals_split_custom_set(normals);obj.data.update();obj['surfaceRefinementVersion']=12;obj['normalMethod']='analytic Catmull-Rom/superellipse exterior field; cavity and rims preserved'
        report.append({'node':name,'analyticalExteriorCorners':changed,'allCorners':len(normals),'positionsUnchanged':False,'unchangedAtAndBehindY':-2.23,'preserveRimAndCavityNormals':True})
    return report
def build_surface_refinements(context):
    topology=clean_fixed_roots()
    return {'version':12,'fixedRootTopology':topology,'root':{'fixedNodes':['Fixed_root_L','Fixed_root_R'],'movingNodes':['Composite_wing_L','Composite_wing_R'],'sharedCruiseLoft':ROOT_LOFT,'chordwiseIntervals':28,'lipThicknessFraction':.42,'lipTransitionDistance':.10,'lipProfile':'0.42+0.58*d*d*(3-2*d)','booleanBevelUsed':False,'localSpanSamplingMaximumStep':.06,'axisHalfGap':context['ROOT_HALF_GAP'],'interfaceProfile':'t=.21*(1-exp(-(r/.42)^2))','mechanismAxesUnchanged':True,'coverCrossingMovingJoint':False,'visualReconstructionNotFactoryDimensions':True},'compositeSkinNormals':refine_composite_normals(context),'rootSkinNormals':refine_root_normals(context),'rootPaintProjection':fit_root_color_bands(context),'noseProfile':{'forwardOnlyY':-2.23,'terminalY':-2.72,'radiusLaw':'r(d)^2=r(0)^2+A*(2R*d-d*d); A,R matched at aft value and slope','localLongitudinalIntervals':48,'preserveOpeningAndHinge':True},'source':'User V12 model screenshots; N273PD original photographs; prior V10/V11 reference limits retained'}


def densify_root(stations,limit,spacing=.06):
    out=[]
    for a,b in zip(stations,stations[1:]):
        count=max(1,math.ceil(abs(b[0]-a[0])/spacing)) if min(abs(a[0]),abs(b[0]))<limit else 1
        for i in range(count):
            t=i/count;out.append(tuple(a[j]+(b[j]-a[j])*t for j in range(5)))
    out.append(stations[-1]);return out


def roll_joint_skin(obj,origin,axis,keep_positive,context):
    """实际翼型逐渐减薄成圆顺接口；仍用精确同轴曲面分隔，不添加重叠遮罩。"""
    sign=-1 if obj.name.endswith('_L') else 1
    stations=context['V12_FIXED_STATIONS'][obj.name[-1]] if keep_positive else context['DETAIL_WING_STATIONS'][obj.name[-1]]
    station_at=context['wing_station'];signed=context['joint_signed'];gap=context['ROOT_HALF_GAP']
    for v in obj.data.vertices:
        distance=(signed(v.co,origin,axis,gap if keep_positive else -gap))*(1 if keep_positive else -1)
        if distance>=.10:continue
        st=station_at(stations,v.co.x);z=st[3];d=max(0,min(1,distance/.10))
        q=v.co-Vector(origin);radial=(q-Vector(axis)*q.dot(Vector(axis))).length
        factor=context['root_lip_factor'](distance,radial) if 'root_lip_factor' in context else .42+.58*d*d*(3-2*d)
        # 贴面与翼体共用厚度场；涂层微小偏移单独保留，不能压进实体。
        coating=.004 if 'blue' in obj.name.lower() else 0
        delta=v.co.z-z;sgn=1 if delta>=0 else -1
        v.co.z=z+sgn*(max(0,abs(delta)-coating)*factor+coating)
    obj.data.update()
    return obj


def nose_section(stations,y):
    old=_continuous_section(stations,y)
    if y>=-2.23:return old
    d=max(0,y+2.72);end=.49;values=[]
    for axis,r0,value in [(1,.003,.495),(2,.005,.390)]:
        slope=(_continuous_section(stations,-2.23+.0001)[axis]-_continuous_section(stations,-2.23-.0001)[axis])/.0002
        # 整个前鼻采用同一椭圆式半径场，与保留截面匹配数值及一阶导数。
        radius=(slope*end*end-value*end)/(2*slope*end-value)
        amplitude=(value*value-r0*r0)/(2*radius*end-end*end)
        values.append(math.sqrt(max(r0*r0,r0*r0+amplitude*(2*radius*d-d*d))))
    t=d/end;z0=.24;z1=.270
    slope=(_continuous_section(stations,-2.23+.0001)[3]-_continuous_section(stations,-2.23-.0001)[3])/.0002
    z=(2*t**3-3*t*t+1)*z0+(-2*t**3+3*t*t)*z1+(t**3-t*t)*end*slope
    return (y,*values,z)


def refined_body_sections(stations,dense):
    ys=sorted(set([x[0] for x in dense if x[0]<-2.23]+[-2.72+.49*i/48 for i in range(49)]))
    return [nose_section(stations,y) for y in ys if y<-2.23]+[row for row in dense if row[0]>=-2.23]


def refine_root_normals(context):
    rows=[];section_at=context['wing_station'];point=context['airfoil_point'];signed=context['joint_signed'];gap=context['ROOT_HALF_GAP']
    for side,sign in [('L',-1),('R',1)]:
        axis=context['wing_axis'](sign)
        for name,fixed in [('Fixed_root_'+side,True),('Composite_wing_'+side,False)]:
            obj=bpy.data.objects[name];origin=context['pivot_position'](sign) if fixed else Vector((0,0,0));stations=context['V12_FIXED_STATIONS'][side] if fixed else context['DETAIL_WING_STATIONS'][side]
            def height(x,y,upper):
                st=section_at(stations,x);u=max(1e-7,min(1-1e-7,(y-st[1])/st[2]));p=Vector(point(st,u,upper));p.y=y
                distance=signed(p,origin,axis,gap if fixed else -gap)*(1 if fixed else -1);d=max(0,min(1,distance/.10));q=p-origin;radial=(q-axis*q.dot(axis)).length
                factor=context['root_lip_factor'](distance,radial) if 'root_lip_factor' in context else .42+.58*d*d*(3-2*d)
                return st[3]+(p.z-st[3])*factor
            existing=[n.vector.copy() for n in obj.data.corner_normals];normals=[];changed=0
            for face in obj.data.polygons:
                for li in face.loop_indices:
                    p=obj.data.vertices[obj.data.loops[li].vertex_index].co
                    st=section_at(stations,p.x);upper=p.z>=st[3];near=abs(p.z-height(p.x,p.y,upper))<.003
                    # 只给真正的翼型外皮指定解析法线；拼接端面和真实轴孔保持锐边。
                    cap=all(abs(signed(obj.data.vertices[obj.data.loops[j].vertex_index].co,origin,axis,gap if fixed else -gap))<.001 for j in face.loop_indices)
                    if not cap and abs(face.normal.z)>.3:
                        eps=.0001;dx=(height(p.x+eps,p.y,upper)-height(p.x-eps,p.y,upper))/(2*eps);dy=(height(p.x,p.y+eps,upper)-height(p.x,p.y-eps,upper))/(2*eps)
                        n=Vector((-dx,-dy,1)).normalized()*(1 if upper else -1)
                        if n.dot(face.normal)>.2:normals.append(tuple(n));changed+=1;continue
                    normals.append(tuple(existing[li]))
            obj.data.normals_split_custom_set(normals);obj.data.update();rows.append({'node':name,'analyticalSkinCorners':changed})
    return rows


def fit_root_color_bands(context):
    from mathutils.bvhtree import BVHTree
    rows=[]
    for side in ('L','R'):
        for base,paint in [('Fixed_root_','Fixed_root_blue_'),('Composite_wing_','Wing_blue_leading_')]:
            body=bpy.data.objects[base+side];obj=bpy.data.objects[paint+side]
            tree=BVHTree.FromPolygons([v.co for v in body.data.vertices],[list(p.vertices) for p in body.data.polygons],all_triangles=False)
            stations=context['V12_FIXED_STATIONS'][side] if base=='Fixed_root_' else context['DETAIL_WING_STATIONS'][side]
            hits=0
            for vertex in obj.data.vertices:
                p=vertex.co;st=context['wing_station'](stations,p.x);up=p.z>=st[3]
                start=Vector((p.x,p.y,10 if up else -10));direction=Vector((0,0,-1 if up else 1));hit=tree.ray_cast(start,direction,20)
                if hit[0] is not None:
                    p.z=hit[0].z+(.004 if up else -.004);hits+=1
            obj.data.update();rows.append({'node':obj.name,'projectedVertices':hits,'allVertices':len(obj.data.vertices),'verticalClearance':.004})
    return rows


def clean_fixed_roots():
    import bmesh
    report=[]
    for side in ('L','R'):
        obj=bpy.data.objects['Fixed_root_'+side];bm=bmesh.new();bm.from_mesh(obj.data)
        before={'vertices':len(bm.verts),'faces':len(bm.faces)}
        bmesh.ops.triangulate(bm,faces=list(bm.faces));bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7);bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-7)
        bm.verts.ensure_lookup_table();bm.verts.index_update();seen={};duplicate=[]
        for face in bm.faces:
            key=tuple(sorted(v.index for v in face.verts))
            if key in seen:duplicate.extend([seen[key],face])
            else:seen[key]=face
        if duplicate:bmesh.ops.delete(bm,geom=list(set(duplicate)),context='FACES_ONLY')
        wires=[edge for edge in bm.edges if not edge.link_faces]
        if wires:bmesh.ops.delete(bm,geom=wires,context='EDGES')
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.normal_update()
        after={'vertices':len(bm.verts),'faces':len(bm.faces),'boundaryEdges':sum(e.is_boundary for e in bm.edges),'nonManifoldEdges':sum(not e.is_manifold for e in bm.edges),'zeroAreaTriangles':sum(f.calc_area()<=1e-18 for f in bm.faces)}
        bm.to_mesh(obj.data);bm.free();obj.data.set_sharp_from_angle(angle=math.radians(35));report.append({'node':obj.name,'before':before,'after':after,'cleanupThreshold':1e-7})
        assert after['boundaryEdges']==0 and after['nonManifoldEdges']==0 and after['zeroAreaTriangles']==0,report[-1]
    return report
