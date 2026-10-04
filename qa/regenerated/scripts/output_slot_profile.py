"""V24平直机腹槽：直接构建局部薄壁截面，避免硬拉旧曲槽网格。"""
import math
from mathutils import Vector
from output_slot_geometry import OUTLINE_CONTROL, SLOT_BOTTOM_Z, SLOT_TOP_Z

LONG_START = .90
LONG_END = 1.93
CORE_X = .092
INNER_X = .0955
OUTER_START_X = .205
OUTER_END_X = .116
LIP_HEIGHT = .055
INNER_ALPHA = 9*math.pi/32
OUTER_ALPHA = 13*math.pi/32


def smooth(t):
    t=max(0.,min(1.,t));return t*t*(3-2*t)


def configure(base_point, section_at, stations):
    def base_low(x,y):
        w=section_at(stations,y)[1]
        a=3*math.pi/2+math.asin(min(1.,max(0.,x/w)**(1/.83)))
        return base_point(y,a,0)[2]
    z0,z1=base_low(INNER_X,LONG_START),base_low(INNER_X,LONG_END)
    def target(y):
        u=(y-LONG_START)/(LONG_END-LONG_START)
        return OUTER_START_X+(OUTER_END_X-OUTER_START_X)*u,z0+(z1-z0)*u
    def point(y,angle,offset=0.):
        base=base_point(y,angle,0)
        if math.sin(angle)>=-1e-12 or y<=.76416 or y>=2.1:
            return base_point(y,angle,offset)
        weight=smooth((y-.76416)/(.87712-.76416))*smooth((2.1-y)/(2.1-1.9972))
        _,w,h,center=section_at(stations,y)
        old_x=abs(base[0]);xi=w*math.sin(INNER_ALPHA)**.83;xo=w*math.sin(OUTER_ALPHA)**.83
        core=min(CORE_X,xi-.001)
        if old_x<=core:return base_point(y,angle,offset)
        outer_x,lower=target(y);upper=min(lower+LIP_HEIGHT,center-.001)
        if old_x<=xi:
            u=(old_x-core)/(xi-core);x=core+(INNER_X-core)*u
            dz=1e-5;slope=(base_low(core+dz,y)-base_low(core-dz,y))/(2*dz)
            start=base_low(core,y);length=INNER_X-core
            z=(2*u**3-3*u*u+1)*start+(u**3-2*u*u+u)*length*slope+(-2*u**3+3*u*u)*lower
        elif old_x<=xo:
            u=(old_x-xi)/(xo-xi);x=INNER_X+(outer_x-INNER_X)*u;z=lower+(upper-lower)*u
        else:
            u=(old_x-xo)/(w-xo);x=outer_x+(w-outer_x)*u
            z=upper+(center-upper)*(1-max(0.,1-u*u)**.325)
        qx=base[0]+weight*(math.copysign(x,base[0])-base[0]);qz=base[2]+weight*(z-base[2])
        cavity_weight = smooth(4*(old_x-core)/(xi-core)) if old_x<=xi else 1-smooth((old_x-xi)/(xo-xi))
        cavity_weight *= weight
        return (qx+offset*math.cos(angle)*(1-cavity_weight),y,
                qz+offset*math.sin(angle)*(1-cavity_weight)-offset*cavity_weight)
    return point,{'version':24,'longRangeBlenderY':[LONG_START,LONG_END],
        'profileFullWeightBlenderY':[.87712,1.9972],'profileBlendRangeBlenderY':[.76416,2.1],
        'innerLipRightEndpoints':[[INNER_X,LONG_START,z0],[INNER_X,LONG_END,z1]],
        'outerLipRightEndpoints':[[OUTER_START_X,LONG_START,z0+LIP_HEIGHT],[OUTER_END_X,LONG_END,z1+LIP_HEIGHT]],
        'nominalVerticalLipSeparation':LIP_HEIGHT,'protectedCentralFloorMaximumAbsX':.074,'outerProfileBlendCoreAbsX':CORE_X,
        'method':'原机壳环截面的局部平直唇与连续曲面顺接；真实布尔槽，不添加遮盖件；主翼及机构不改'}


def outline():
    # 前圆端沿用原机件扫掠形状；随后接真正共线的外长边。
    p=OUTLINE_CONTROL[:6]
    a=Vector(p[-1]);b=Vector((OUTER_START_X,LONG_START))
    slope=(OUTER_END_X-OUTER_START_X)/(LONG_END-LONG_START)
    c0=a+Vector((0,.010));c1=b-Vector((slope,1)).normalized()*.009
    for i in range(1,9):
        t=i/8;q=(1-t)**3*a+3*(1-t)**2*t*c0+3*(1-t)*t*t*c1+t**3*b;p.append(tuple(q))
    p.append((OUTER_END_X,LONG_END))
    a=Vector((OUTER_END_X,LONG_END));b=Vector((INNER_X,LONG_END));c0=a+Vector((slope,1))*.0326666667;c1=b+Vector((0,.0326666667))
    for i in range(1,25):
        t=i/24;q=(1-t)**3*a+3*(1-t)**2*t*c0+3*(1-t)*t*t*c1+t**3*b;p.append(tuple(q))
    p.extend([(INNER_X,.895),(.106,.861),(.128,.833),(.155,.811),(.175,.790)])
    # 只有前圆端的小折角做二次圆顺，长段顶点保持原直线位置。
    result=[]
    for i,b in enumerate([Vector(x)for x in p]):
        if LONG_START-1e-6<=b.y<=LONG_END+1e-6:
            result.append(tuple(b));continue
        a=Vector(p[i-1]);c=Vector(p[(i+1)%len(p)]);ab=a-b;cb=c-b;d=min(.003,ab.length*.15,cb.length*.15)
        start=b+ab.normalized()*d;end=b+cb.normalized()*d
        for k in range(5):
            t=k/4;result.append(tuple(start*(1-t)**2+b*2*t*(1-t)+end*t*t))
    return result

SLOT_OUTLINE=outline()


def prism(ctx,name,sign,z0,z1,material):
    p=[(sign*x,y)for x,y in SLOT_OUTLINE];n=len(p)
    vertices=[(x,y,z)for z in(z0,z1)for x,y in p]
    faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)]
    if sign<0:faces=[tuple(reversed(f))for f in faces]
    return ctx['mesh_object'](name,vertices,faces,material,smooth=False)


def refine_normals(ctx):
    """局部外/内皮以实际新截面场求法线，平切端面仍保持硬边。"""
    obj=ctx['bpy'].data.objects['Fuselage'];old=[n.vector.copy()for n in obj.data.corner_normals];normals=list(old);changed=0
    for face in obj.data.polygons:
        points=[obj.data.vertices[i].co for i in face.vertices]
        if abs(face.normal.z)<.2 or all(abs(p.z-SLOT_TOP_Z)<1e-6 for p in points)or all(abs(p.z-SLOT_BOTTOM_Z)<1e-6 for p in points):continue
        for li in face.loop_indices:
            p=obj.data.vertices[obj.data.loops[li].vertex_index].co
            if not(.76416<p.y<2.1)or abs(p.x)<=CORE_X:continue
            _,w,h,center=ctx['section_at'](ctx['body_dense'],p.y)
            if p.z>=center:continue
            sign=1 if p.x>=0 else -1;found=[]
            for offset,outward in[(0,1),(-.006,-1)]:
                lo,hi=0.,math.pi/2
                for _ in range(32):
                    mid=(lo+hi)/2;a=3*math.pi/2+sign*mid;q=Vector(ctx['fuselage_point'](p.y,a,offset))
                    if abs(q.x)<abs(p.x):lo=mid
                    else:hi=mid
                a=3*math.pi/2+sign*(lo+hi)/2;q=Vector(ctx['fuselage_point'](p.y,a,offset));distance=(q-p).length
                if distance>.002:continue
                dy=1e-4;da=1e-4
                ty=Vector(ctx['fuselage_point'](p.y+dy,a,offset))-Vector(ctx['fuselage_point'](p.y-dy,a,offset))
                ta=Vector(ctx['fuselage_point'](p.y,a+da,offset))-Vector(ctx['fuselage_point'](p.y,a-da,offset))
                n=ty.cross(ta).normalized()*outward
                if n.dot(face.normal)>.2:found.append((distance,n))
            if found:normals[li]=min(found,key=lambda x:x[0])[1];changed+=1
    obj.data.normals_split_custom_set(normals);obj.data.update();return{'changedCorners':changed,'positionsUnchanged':True}


def _inside(x, y):
    c = False
    for (ax, ay), (bx, by) in zip(SLOT_OUTLINE, SLOT_OUTLINE[1:] + SLOT_OUTLINE[:1]):
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            c = not c
    return c

def _intersection(a, b, c, d):
    q = b - a
    r = d - c
    det = q.x * r.y - q.y * r.x
    if abs(det) < 1e-12:
        return None
    v = c - a
    t = (v.x * r.y - v.y * r.x) / det
    s = (v.x * q.y - v.y * q.x) / det
    return t if 0 < t < 1 and 0 <= s <= 1 else None

def trim_seam(points, margin=0.0035):
    """按本版真实槽轮廓裁剪有限接缝管路径。"""
    runs = []
    run = []
    for pa, pb in zip(points[:-1], points[1:]):
        a, b = (Vector(pa), Vector(pb))
        delta = b - a
        cuts = [0.0, 1.0]
        for sign in (-1, 1):
            for dx, dy in [(0, 0), (margin, 0), (-margin, 0), (0, margin), (0, -margin)]:
                aa = Vector((sign * a.x + dx, a.y + dy))
                bb = Vector((sign * b.x + dx, b.y + dy))
                for cc, dd in zip(SLOT_OUTLINE, SLOT_OUTLINE[1:] + SLOT_OUTLINE[:1]):
                    t = _intersection(aa, bb, Vector(cc), Vector(dd))
                    if t is not None:
                        cuts.append(t)
        for z in (SLOT_BOTTOM_Z - margin, SLOT_TOP_Z + margin):
            if abs(delta.z) > 1e-12:
                t = (z - a.z) / delta.z
                if 0 < t < 1:
                    cuts.append(t)
        cuts = sorted(set(cuts))
        for u, v in zip(cuts[:-1], cuts[1:]):
            m = a + delta * ((u + v) / 2)
            inside = SLOT_BOTTOM_Z - margin <= m.z <= SLOT_TOP_Z + margin and any((_inside(sign * m.x + dx, m.y + dy) for sign in (-1, 1) for dx, dy in [(0, 0), (margin, 0), (-margin, 0), (0, margin), (0, -margin)]))
            if inside:
                if len(run) > 1:
                    runs.append(run)
                run = []
                continue
            start, end = (a + delta * u, a + delta * v)
            if run and (Vector(run[-1]) - start).length < 1e-07:
                run.append(tuple(end))
            else:
                if len(run) > 1:
                    runs.append(run)
                run = [tuple(start), tuple(end)]
    if len(run) > 1:
        runs.append(run)
    return runs

def resample_rear_seam(points):
    """仅细分短后端接缝，便于逐截面贴合新曲面；不改前部路径。"""
    if min(p[1]for p in points)<1.9:return points
    out=[]
    for a,b in zip(points,points[1:]):
        a,b=Vector(a),Vector(b);steps=max(1,math.ceil((b-a).length/.01))
        out.extend([tuple(a+(b-a)*i/steps)for i in range(steps)])
    return out+[tuple(points[-1])]


def triangulate_slot_input(obj):
    """按原环顶点序号确定一致对角线；布尔前消除局部非平面四边形歧义。"""
    points=[tuple(v.co)for v in obj.data.vertices];faces=[];smooths=[];materials=[]
    for face in obj.data.polygons:
        ids=list(face.vertices);ps=[points[i]for i in ids]
        selected=len(ids)==4 and min(p[1]for p in ps)>=.76416-1e-7 and max(p[1]for p in ps)<=2.1+1e-7 and max(p[2]for p in ps)<=.22 and min(p[2]for p in ps)>=-.2 and min(abs(p[0])for p in ps)>.095 and max(abs(p[0])for p in ps)<=.30
        if selected:
            first=ids.index(min(ids));ids=ids[first:]+ids[:first]
            pieces=[(ids[0],ids[1],ids[2]),(ids[0],ids[2],ids[3])]
        else:pieces=[tuple(ids)]
        faces.extend(pieces);smooths.extend([face.use_smooth]*len(pieces));materials.extend([face.material_index]*len(pieces))
    obj.data.clear_geometry();obj.data.from_pydata(points,[],faces);obj.data.update()
    for face,smooth,material in zip(obj.data.polygons,smooths,materials):face.use_smooth=smooth;face.material_index=material
    obj.data.update()
