"""V24只替换局部槽口；原前部曲面精确保留，清除可证明零厚度的布尔赘片。"""
import hashlib
import json
import math
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector


def _canonical(points):
    keys=[tuple(p)for p in points]
    return min(tuple(keys),tuple(keys[1:]+keys[:1]),tuple(keys[2:]+keys[:2]))


def preserve_untouched(ctx):
    root=Path(ctx['ROOT']);meta=json.loads((root/'scripts/data/preserved-front-surfaces.json').read_text())
    path=root/'scripts/data/preserved-front-surfaces.blend'
    if hashlib.sha256(path.read_bytes()).hexdigest()!=meta['dataSha256']:
        raise ValueError('V24未改表面保留源身份不符')
    names=list(meta['meshes']);mesh_names=[meta['meshes'][n]for n in names]
    with bpy.data.libraries.load(str(path),link=False)as(src,dst):dst.meshes=mesh_names
    source=dict(zip(names,dst.meshes));rows=[]
    for name in names:
        if name=='Fuselage':continue
        obj=bpy.data.objects[name];materials=list(obj.data.materials);obj.data=source[name]
        obj.data.materials.clear()
        for material in materials:obj.data.materials.append(material)
        rows.append({'node':name,'method':'复用已验收的原生网格数据；对象、父节点、变换、材料和动作不动','vertices':len(obj.data.vertices),'faces':len(obj.data.polygons)})
    obj=bpy.data.objects['Fuselage'];materials=list(obj.data.materials);verts=[];faces=[];normals=[];lookup={};counts=[]
    for mesh,keep_front in[(source['Fuselage'],True),(obj.data,False)]:
        mesh.calc_loop_triangles();ns=[n.vector.copy()for n in mesh.corner_normals];count=0
        for t in mesh.loop_triangles:
            ps=[mesh.vertices[i].co.copy()for i in t.vertices]
            front=all(p.y<.70 for p in ps)
            if front!=keep_front:continue
            ids=[]
            for p in ps:
                key=tuple(p)
                if key not in lookup:lookup[key]=len(verts);verts.append(key)
                ids.append(lookup[key])
            faces.append(tuple(ids));normals.extend(ns[li]for li in t.loops);count+=1
        counts.append(count)
    data=bpy.data.meshes.new('V24仅机腹局部更新');data.from_pydata(verts,[],faces);data.update()
    for p in data.polygons:p.use_smooth=True
    for material in materials:data.materials.append(material)
    data.normals_split_custom_set(normals);obj.data=data;obj.data.update()
    return {'sourceBlendSha256':meta['sourceBlendSha256'],'dataSha256':meta['dataSha256'],
            'frontFuselageTriangleCount':counts[0],'currentRearTriangleCount':counts[1],
            'frontSelection':'原生BlenderY<.70的完整三角面；此处远离实际槽口，接合边界未改',
            'restoredObjects':rows,'reason':'避免全局布尔重算对远处舱壳和接缝造成未请求的数值漂移'}


def finish_topology():
    obj=bpy.data.objects['Fuselage'];obj.data.calc_loop_triangles()
    old_normals=[n.vector.copy()for n in obj.data.corner_normals]
    normal_map={_canonical([obj.data.vertices[i].co for i in t.vertices]):{tuple(obj.data.vertices[i].co):old_normals[li]for i,li in zip(t.vertices,t.loops)}for t in obj.data.loop_triangles}
    bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.verts.ensure_lookup_table();bm.verts.index_update();bm.normal_update();before_volume=bm.calc_volume(signed=True)
    seen={};duplicates=[];pairs=[]
    for face in bm.faces:
        key=tuple(sorted(v.index for v in face.verts))
        if key in seen:
            other=seen[key]
            if len(face.verts)!=3 or len(other.verts)!=3 or face.normal.dot(other.normal)>-.999:
                raise ValueError('V24未识别的重复实体面：'+str((face.calc_area(),other.calc_area(),face.normal.dot(other.normal),[tuple(v.co)for v in face.verts],[tuple(v.co)for v in other.verts])))
            points=[tuple(v.co)for v in face.verts]
            if not all(.75<p[1]<2.1 and .07<abs(p[0])<.30 for p in points):
                raise ValueError('V24重复面超出机腹槽局部')
            duplicates.extend([other,face]);pairs.append({'vertices':points,'faces':2,'exactlyCoincident':True,'oppositeWinding':True,'materialVolume':0})
        else:seen[key]=face
    if duplicates:bmesh.ops.delete(bm,geom=list(set(duplicates)),context='FACES_ONLY')
    loose=[e for e in bm.edges if not e.link_faces]
    if loose:bmesh.ops.delete(bm,geom=loose,context='EDGES')
    loose=[v for v in bm.verts if not v.link_edges]
    if loose:bmesh.ops.delete(bm,geom=loose,context='VERTS')
    retriangulated=[]
    positions_before={v:v.co.copy()for v in bm.verts}
    for attempt in range(4):
        bm.normal_update()
        tiny=[f for f in bm.faces if f.calc_area()<=1e-18]
        if not tiny:break
        if not all(.75<v.co.y<2.1 for f in tiny for v in f.verts):
            raise ValueError('V24零面积面超出槽口局部')
        rows=[{'vertices':[tuple(v.co)for v in f.verts],'areaBefore':f.calc_area()}for f in tiny]
        # 沿用V13已有1e-7局部数值清理，只处理已确认零面积面的边；不动碰撞门槛。
        bmesh.ops.dissolve_degenerate(bm,edges=sorted({e for f in tiny for e in f.edges},key=lambda e:tuple(sorted(v.index for v in e.verts))),dist=1e-7)
        bmesh.ops.triangulate(bm,faces=list(bm.faces))
        retriangulated.append({'originalZeroFaces':rows,'existingCleanupDistance':1e-7})
    else:
        if any(f.calc_area()<=1e-18 for f in bm.faces):raise ValueError('V24局部共线重三角化未收敛')
    # 重三角化后优先恢复原坐标。若恢复使零厚度端部面重新共线，
    # 仅对该面的原有数值投影保留原1e-7界内结果；仍执行体积及面积门槛。
    cleaned_positions={v:v.co.copy()for v in bm.verts}
    for v in bm.verts:
        if v in positions_before:v.co=positions_before[v]
    bm.normal_update()
    unstable=[f for f in bm.faces if f.calc_area()<=1e-18]
    for face in unstable:
        for v in face.verts:
            if v in positions_before and tuple(cleaned_positions[v])!=tuple(positions_before[v]):v.co=cleaned_positions[v]
    numerical_moves=[{'before':list(positions_before[v]),'after':list(v.co),'distance':(v.co-positions_before[v]).length}for v in bm.verts if v in positions_before and tuple(v.co)!=tuple(positions_before[v])]
    if any(row['distance']>1e-7 or not .75<row['before'][1]<2.1 for row in numerical_moves):
        raise ValueError('V24局部数值清理超出既有1e-7几何修复界限')
    bm.normal_update();after_volume=bm.calc_volume(signed=True)
    if any(not e.is_manifold for e in bm.edges)or any(f.calc_area()<=1e-18 for f in bm.faces):
        raise ValueError('V24局部清理门槛：'+str({'nonmanifold':[[tuple(v.co)for v in e.verts]for e in bm.edges if not e.is_manifold],'zero':[[tuple(v.co)for v in f.verts]for f in bm.faces if f.calc_area()<=1e-18]}))
    if abs(after_volume-before_volume)>1e-13:raise ValueError('V24清理体积差：'+str((before_volume,after_volume,after_volume-before_volume,numerical_moves,retriangulated)))
    bm.to_mesh(obj.data);bm.free();obj.data.update();normals=[]
    for face in obj.data.polygons:
        ps=[obj.data.vertices[i].co for i in face.vertices];old=normal_map.get(_canonical(ps))
        normals.extend(old[tuple(obj.data.vertices[obj.data.loops[li].vertex_index].co)]if old else face.normal.copy()for li in face.loop_indices)
    obj.data.normals_split_custom_set(normals);obj.data.update()
    return {'removedCoincidentOppositePairs':pairs,'localCollinearRetriangulation':retriangulated,'beforeVolume':before_volume,'afterVolume':after_volume,'numericalVertexMoves':numerical_moves,'maximumNumericalVertexDisplacement':max((r['distance']for r in numerical_moves),default=0),'boundaryEdges':0,'nonManifoldEdges':0,'zeroAreaLimit':1e-18,'collisionThresholdsUnchanged':True}
