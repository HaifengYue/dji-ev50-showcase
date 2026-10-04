"""真实直槽的共享唇节点及原中央底板材料保留。"""
import math
import struct
from mathutils import Vector
from collections import Counter
from pathlib import Path
from mathutils.bvhtree import BVHTree
import bpy
import bmesh


def _normal_map(mesh):
    mesh.calc_loop_triangles();ns=[n.vector.copy()for n in mesh.corner_normals]
    result={tuple(sorted(tuple(mesh.vertices[i].co)for i in t.vertices)):{tuple(mesh.vertices[i].co):ns[li]for i,li in zip(t.vertices,t.loops)}for t in mesh.loop_triangles}
    for face in mesh.polygons:
        if len(face.vertices)!=3:result[tuple(sorted(tuple(mesh.vertices[i].co)for i in face.vertices))]={tuple(mesh.vertices[mesh.loops[li].vertex_index].co):ns[li]for li in face.loop_indices}
    return result

def _restore_normals(mesh,original):
    normals=[]
    for face in mesh.polygons:
        key=tuple(sorted(tuple(mesh.vertices[i].co)for i in face.vertices));old=original.get(key)
        normals.extend(old[tuple(mesh.vertices[mesh.loops[li].vertex_index].co)]if old else face.normal.copy()for li in face.loop_indices)
    mesh.normals_split_custom_set(normals);mesh.update()


def _restore_subdivided_normals(mesh,source):
    """原平面新增边点继承原逐角法线插值，避免局部细分重算远处明暗。"""
    source.calc_loop_triangles();ns=[n.vector.copy()for n in source.corner_normals];old=[]
    for t in source.loop_triangles:
        ps=[source.vertices[i].co.copy()for i in t.vertices];old.append((ps,[ns[li]for li in t.loops]))
    normals=[]
    for face in mesh.polygons:
        for li in face.loop_indices:
            p=mesh.vertices[mesh.loops[li].vertex_index].co;best=None
            for ps,corner in old:
                a,b,c=ps;v0=b-a;v1=c-a;v2=p-a
                d00=v0.dot(v0);d01=v0.dot(v1);d11=v1.dot(v1);d20=v2.dot(v0);d21=v2.dot(v1);den=d00*d11-d01*d01
                if abs(den)<1e-20:continue
                u=(d11*d20-d01*d21)/den;v=(d00*d21-d01*d20)/den
                distance=(v2-v0*u-v1*v).length
                if min(1-u-v,u,v)>=-1e-5 and distance<1e-7:
                    # 同点存在多个原面时，优先选与新面朝向一致的一侧。
                    alignment=(v0.cross(v1).normalized()).dot(face.normal)
                    value=next((n.copy()for q,n in zip(ps,corner)if tuple(q)==tuple(p)),None)
                    if value is None:value=(corner[0]*(1-u-v)+corner[1]*u+corner[2]*v).normalized()
                    if best is None or alignment>best[0]:best=(alignment,value)
            normals.append(best[1]if best else face.normal.copy())
    mesh.normals_split_custom_set(normals);mesh.update()


def canonicalize_lip_nodes(ctx):
    """把同一设计交点统一成共享节点；不更改机构、短端或长边目标。"""
    obj=bpy.data.objects['Fuselage'];original_normals=_normal_map(obj.data);config=ctx['SLOT_PROFILE_CONFIG']
    a,b=config['outerLipRightEndpoints'];count=Counter(v.co.y for v in obj.data.vertices)
    stations=[y for y,n in count.items()if n>=16]+[a[1],b[1]]
    bm=bmesh.new();bm.from_mesh(obj.data);rows=[];chosen=[]
    def target(y):
        u=(y-a[1])/(b[1]-a[1]);return a[0]+(b[0]-a[0])*u,a[2]+(b[2]-a[2])*u
    for v in bm.verts:
        x,y,z=v.co;tx,tz=target(y)
        if a[1]-1e-6<=y<=b[1]+1e-6 and abs(abs(x)-tx)<2e-6 and abs(z-tz)<2e-6:
            original=v.co.copy();near=min(stations,key=lambda sy:abs(sy-y))
            if abs(near-y)<1e-6:y=near
            tx,tz=target(y);v.co=(math.copysign(tx,x),y,tz)
            distance=(original-v.co).length
            if distance>1e-6:raise ValueError('设计唇交点合并超出源编码几何界限')
            rows.append({'before':list(original),'after':list(v.co),'distance':distance});chosen.append(v)
    bmesh.ops.remove_doubles(bm,verts=chosen,dist=1e-7)
    bmesh.ops.dissolve_degenerate(bm,edges=sorted({e for v in chosen if v.is_valid for e in v.link_edges},key=lambda e:tuple(sorted(tuple(v.co)for v in e.verts))),dist=1e-7)
    bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free();obj.data.update();_restore_normals(obj.data,original_normals)
    return {'nodes':rows,'maximumConstructionDisplacement':max((r['distance']for r in rows),default=0),
            'method':'同一设计长边与原环站位的布尔交点统一为共享节点；原SAT与驱动门槛不动'}


def repair_core(original_mesh,mesh):
    ranges=[(1.1028,1.2152),(1.3272,1.4388),(1.55,1.6624)]
    check=bmesh.new();check.from_mesh(mesh);closed=all(e.is_manifold for e in check.edges);check.free()
    if not closed:raise ValueError('共同剖分输入必须已经严格闭合，禁止顺带修复未知开口')
    def f32(x):return struct.unpack('f',struct.pack('f',x))[0]
    def cross(a,b):return a[0]*b[1]-a[1]*b[0]
    def sub(a,b):return (a[0]-b[0],a[1]-b[1])
    def area(poly):return .5*sum(cross(a,b)for a,b in zip(poly,poly[1:]+poly[:1]))
    def clip(poly,a,b,sgn=1):
        output=[]
        for p,q in zip(poly,poly[1:]+poly[:1]):
            dp=sgn*cross(sub(b,a),sub(p,a));dq=sgn*cross(sub(b,a),sub(q,a));ip=dp>=-1e-15;iq=dq>=-1e-15
            if ip:output.append(p)
            if ip!=iq:
                t=dp/(dp-dq);output.append((p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t))
        return output
    def bary(p,t):
        d=cross(sub(t[1],t[0]),sub(t[2],t[0]));u=cross(sub(p,t[0]),sub(t[2],t[0]))/d;v=cross(sub(t[1],t[0]),sub(p,t[0]))/d
        return (1-u-v,u,v)
    def height(p,t):return sum(w*q[2]for w,q in zip(bary(p,t),t))
    def selected(ps):
        result=any(min(p[1]for p in ps)>=lo-1e-7 and max(p[1]for p in ps)<=hi+1e-7 for lo,hi in ranges) and max(p[2]for p in ps)<.05 and max(abs(p[0])for p in ps)<.096 and max(abs(p[0])for p in ps)>.06
        if result and min(p[0]for p in ps)<-1e-7 and max(p[0]for p in ps)>1e-7:raise ValueError('底板扇形不得跨越左右两侧')
        return result
    old=[];original_mesh.calc_loop_triangles();mesh.calc_loop_triangles()
    for t in original_mesh.loop_triangles:
        ps=[tuple(original_mesh.vertices[i].co)for i in t.vertices]
        if selected(ps) and abs(t.normal.z)>.5:old.append((ps,1 if t.normal.z>0 else -1))
    verts=[];faces=[];normals=[];lookup={};source_ns=[n.vector.copy()for n in mesh.corner_normals];edited=0;cells=0;maximum_area_error=0.
    def vid(p):
        key=tuple(f32(v)for v in p)
        if key not in lookup:lookup[key]=len(verts);verts.append(key)
        return lookup[key]
    for t in mesh.loop_triangles:
        ps=[tuple(mesh.vertices[i].co)for i in t.vertices]
        if not(selected(ps)and abs(t.normal.z)>.5):
            faces.append([vid(p)for p in ps]);normals.extend(source_ns[li]for li in t.loops);continue
        sign=1 if t.normal.z>0 else -1;polys=[];source_area=abs(area(ps))
        for prior,prior_sign in old:
            if prior_sign!=sign:continue
            if max(p[0]for p in prior)<min(p[0]for p in ps)-1e-12 or min(p[0]for p in prior)>max(p[0]for p in ps)+1e-12:continue
            poly=[p[:2]for p in ps];orientation=1 if area(prior)>0 else -1
            for a,b in zip(prior,prior[1:]+prior[:1]):
                poly=clip(poly,a,b,orientation)
                if len(poly)<3:break
            if len(poly)<3 or abs(area(poly))<1e-18:continue
            # 在真实保护边界切开；保护侧用旧平面，外侧只调整共同边界节点。
            for left in (True,False):
                side=1 if sum(p[0]for p in ps)>0 else -1;x=.074*side
                part=clip(poly,(x,0),(x,3),(1 if left else -1)*side)
                if len(part)<3 or abs(area(part))<1e-18:continue
                points=[]
                for p in part:
                    z=height(p,prior)if left or abs(abs(p[0])-.074)<1e-10 else height(p,ps)
                    v=vid((p[0],p[1],z))
                    if not points or points[-1]!=v:points.append(v)
                if len(points)>1 and points[0]==points[-1]:points.pop()
                if len(set(points))<3:continue
                # 中心扇保持所有边界细分点，避免删除共线边点造成T接头。
                center=tuple(sum(verts[i][k]for i in points)/len(points)for k in range(3));ci=vid(center)
                for a,b in zip(points,points[1:]+points[:1]):
                    if len({a,b,ci})<3:continue
                    tri=[a,b,ci];v0,v1,v2=[Vector(verts[i])for i in tri]
                    if (v1-v0).cross(v2-v0).length<=2e-18:continue
                    faces.append(tri);normals.extend([t.normal.copy()]*3)
                polys.append(abs(area(part)));cells+=1
        covered=sum(polys)
        maximum_area_error=max(maximum_area_error,abs(covered-source_area))
        if abs(covered-source_area)>1e-13:raise ValueError('底板共同剖分投影未完整覆盖：'+str((ps,source_area,covered)))
        edited+=1
    result=bpy.data.meshes.new('原保护底板局部共同剖分');result.from_pydata(verts,[],faces);result.update()
    for p in result.polygons:p.use_smooth=True
    for m in mesh.materials:result.materials.append(m)
    result.normals_split_custom_set(normals);result.update()
    bm=bmesh.new();bm.from_mesh(result);bm.normal_update();splits=0;maximum_boundary_shift=0.
    def in_patch(v):return abs(v.co.x)<.096+1e-7 and -.2<v.co.z<.05+1e-7 and any(lo-2e-7<=v.co.y<=hi+2e-7 for lo,hi in ranges)
    # 只在新补片周界把相邻原三角的边分到同一套实际节点。
    for attempt in range(300):
        boundary=sorted([e for e in bm.edges if e.is_boundary],key=lambda e:tuple(sorted(tuple(v.co)for v in e.verts)));candidates=sorted({v for e in boundary for v in e.verts},key=lambda v:tuple(v.co));hit=None
        if any(not in_patch(v)for v in candidates):raise ValueError('共同剖分开边超出声明扇形，停止而不全局修复')
        for edge in boundary:
            a,b=edge.verts;d=b.co-a.co;length2=d.length_squared
            if length2<1e-20:continue
            for v in candidates:
                if v==a or v==b:continue
                t=(v.co-a.co).dot(d)/length2
                if t<=1e-6 or t>=1-1e-6:continue
                error=(v.co-(a.co+d*t)).length
                if error<1e-7 and (hit is None or error<hit[0]):hit=(error,edge,a,v,t)
        if hit is None:break
        error,edge,a,v,t=hit;maximum_boundary_shift=max(maximum_boundary_shift,error)
        _,new=bmesh.utils.edge_split(edge,a,t);bmesh.ops.pointmerge(bm,verts=[new,v],merge_co=v.co.copy());splits+=1
    # 同一理论交点的Float32结果只做原有1e-7焊接，不移动设计边线。
    boundary={v for e in bm.edges if not e.is_manifold for v in e.verts}
    if any(not in_patch(v)for v in boundary):raise ValueError('待焊接节点超出声明扇形')
    bmesh.ops.remove_doubles(bm,verts=sorted(boundary,key=lambda v:tuple(v.co)),dist=1e-7)
    bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.normal_update()
    bad=[{'edge':[tuple(v.co)for v in e.verts],'faces':len(e.link_faces)}for e in bm.edges if not e.is_manifold]
    if bad:raise ValueError('共同剖分仍有开放/非流形边：'+str(bad[:20]))
    zero=[f for f in bm.faces if f.calc_area()<=1e-18]
    if zero:raise ValueError('共同剖分仍有零面积面：'+str([[tuple(v.co)for v in f.verts]for f in zero]))
    bm.to_mesh(result);bm.free();result.update()
    # 域外原三角的逐角法线照抄，不因局部共同剖分重算整机明暗。
    normal_map={tuple(sorted(tuple(mesh.vertices[i].co)for i in t.vertices)):{tuple(mesh.vertices[i].co):source_ns[li]for i,li in zip(t.vertices,t.loops)}for t in mesh.loop_triangles}
    final_normals=[]
    for face in result.polygons:
        key=tuple(sorted(tuple(result.vertices[i].co)for i in face.vertices));original=normal_map.get(key)
        final_normals.extend(original[tuple(result.vertices[result.loops[li].vertex_index].co)]if original else face.normal.copy()for li in face.loop_indices)
    result.normals_split_custom_set(final_normals);result.update()
    return result,{'changedInputTriangles':edited,'commonCells':cells,'boundaryEdgeSplits':splits,'protectionAbsX':.074,'stationRanges':ranges,'maximumProjectedAreaCoverageError':maximum_area_error,'maximumBoundaryConstructionShift':maximum_boundary_shift}


def restore_central_floor(ctx):
    """仅对底板内外皮受影响扇形共同剖分，不重新布尔整个机壳。"""
    root=Path(ctx['ROOT']);path=root/'scripts/data/preserved-front-surfaces.blend'
    with bpy.data.libraries.load(str(path),link=False)as(src,dst):dst.meshes=['Fuselage']
    obj=bpy.data.objects['Fuselage'];mesh,report=repair_core(dst.meshes[0],obj.data);obj.data=mesh;obj.data.update()
    return report


def fit_adjacent_seams(ctx):
    """仅让槽口相邻装饰贴回真实宿主，保留原截面和开闭形式。"""
    hull=bpy.data.objects['Fuselage'].data;hull.calc_loop_triangles()
    tree=BVHTree.FromPolygons([v.co for v in hull.vertices],[tuple(t.vertices)for t in hull.loop_triangles],all_triangles=True)
    rows=[]
    def domain(p):return .074<=abs(p.x)<=.30 and .76415<=p.y<=2.1 and -.2<=p.z<=.22
    def check(obj,open_edges):
        bm=bmesh.new();bm.from_mesh(obj.data);bm.normal_update()
        boundary=sum(e.is_boundary for e in bm.edges)
        bad=sum(not e.is_manifold and not e.is_boundary for e in bm.edges)
        zero=sum(f.calc_area()<=1e-18 for f in bm.faces);bm.free()
        if boundary!=open_edges or bad or zero:raise ValueError('贴壳装饰原拓扑改变：'+str((obj.name,boundary,bad,zero)))
        obj.data.calc_loop_triangles();maximum=0.
        for t in obj.data.loop_triangles:
            ps=[obj.data.vertices[i].co for i in t.vertices]
            for i in range(9):
                for j in range(9-i):
                    p=ps[0]*(i/8)+ps[1]*(j/8)+ps[2]*((8-i-j)/8)
                    maximum=max(maximum,tree.find_nearest(p)[3])
        return {'boundaryEdges':boundary,'nonManifoldEdges':bad,'zeroAreaFaces':zero,'maximumSampledHostDistance':maximum,'sampleSubdivision':8}
    for name in ('Lower_fuselage_join','Lower_fuselage_join.002'):
        obj=bpy.data.objects[name];source=obj.data;original_normals=_normal_map(source)
        original=[v.co.copy()for v in source.vertices]
        centers=[sum(original[i:i+4],Vector())/4 for i in range(0,len(original),4)]
        # 先固定原有实际三角面，再只在局部域内加入平面截线。
        source.calc_loop_triangles();mesh=bpy.data.meshes.new(name+'局部贴壳')
        mesh.from_pydata(original,[],[tuple(t.vertices)for t in source.loop_triangles]);mesh.update()
        for material in source.materials:mesh.materials.append(material)
        bm=bmesh.new();bm.from_mesh(mesh)
        for y in (.76416,.77416,.78416,.79416):
            bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=1e-9,plane_co=(0,y,0),plane_no=(0,1,0),clear_outer=False,clear_inner=False)
        moves=[]
        for v in bm.verts:
            p=v.co.copy()
            if p.y<=.76416+1e-8:continue
            a,b=centers[-2:];u=(p.y-a.y)/(b.y-a.y);center=a.lerp(b,u)
            hit,normal,index,distance=tree.ray_cast(Vector((center.x,p.y,-.3)),Vector((0,0,1)),.6)
            if hit is None:raise ValueError('前装饰固定XY射线未命中真实外皮')
            t=min(1,max(0,(p.y-.76416)/.012));weight=t*t*(3-2*t)
            v.co.z+=(hit.z-.0025-center.z)*weight
            if not(domain(p)and domain(v.co)):raise ValueError('前装饰位移越过声明局部域')
            moves.append({'before':list(p),'after':list(v.co)})
        bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free();mesh.update()
        for face in mesh.polygons:face.use_smooth=True
        _restore_subdivided_normals(mesh,source);obj.data=mesh
        report=check(obj,8)
        if report['maximumSampledHostDistance']>.009:raise ValueError('前装饰仍未贴壳：'+str(report))
        rows.append({'node':name,'method':'原实际三角面沿Y截线细分，同一Y截面仅整体竖向平移；Y≤.76416原面保留','moves':moves,**report})
    obj=bpy.data.objects['Tail_boom_join'];mesh=obj.data;original_normals=_normal_map(mesh)
    original=[v.co.copy()for v in mesh.vertices];moves=[];changed=[]
    for i in range(0,len(original),4):
        ps=original[i:i+4];center=sum(ps,Vector())/4
        maximum=max(tree.find_nearest(p)[3]for p in ps)
        if maximum<=.0062:continue
        if not all(domain(p)for p in ps):raise ValueError('尾装饰需调整的环超出声明局部域')
        hit,normal,index,distance=tree.find_nearest(center)
        target=hit+normal*.0025;delta=target-center
        for j,p in enumerate(ps):
            mesh.vertices[i+j].co=p+delta
            if not domain(mesh.vertices[i+j].co):raise ValueError('尾装饰目标越过声明局部域')
            moves.append({'before':list(p),'after':list(mesh.vertices[i+j].co)})
        changed.append(i//4)
    changed_indices={i*4+j for i in changed for j in range(4)}
    for face in mesh.polygons:
        if any(i in changed_indices for i in face.vertices)and not all(domain(original[i])and domain(mesh.vertices[i].co)for i in face.vertices):
            raise ValueError('尾装饰共同位移的邻接面越过声明局部域')
    # 每个受影响四点管环只作共同平移，其余弧段逐坐标不变。
    mesh.update();_restore_normals(mesh,original_normals)
    report=check(obj,0)
    if report['maximumSampledHostDistance']>.0065:raise ValueError('尾装饰仍未贴壳：'+str(report))
    rows.append({'node':obj.name,'method':'仅宿主变化附近的原四点管环整体贴合，其余原弧段不变','changedRings':changed,'moves':moves,**report})
    return {'host':'Fuselage','hostGeometryUnchanged':True,'domainBlender':{'absX':[.074,.30],'Y':[.76416,2.1],'Z':[-.2,.22]},'objects':rows}
