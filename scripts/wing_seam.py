"""V23真实翼缝的局部布尔清理；不改变顶点、间隙或验收容差。

精确布尔偶发生成贴在一条真实边上的近共面四面薄片。只删除可独立
证明为四面闭壳、仅共用一条边、体积小于1e-15的数值赘片。主体外壳
须恢复严格流形，否则立即停止；不删除正常翼面或按碰撞结果豁免。
"""
import itertools
import bpy
import bmesh


def finish_wing_seam_topology(names=None):
    rows=[]
    for name in names or ('Composite_wing_L','Composite_wing_R'):
        obj=bpy.data.objects[name]
        bm=bmesh.new();bm.from_mesh(obj.data)
        bm.verts.ensure_lookup_table();bm.verts.index_update()
        before_volume=bm.calc_volume(signed=True)
        bad=[e for e in bm.edges if not e.is_manifold]
        removed=[]
        for edge in bad:
            if not edge.is_valid or len(edge.link_faces)!=4:
                raise ValueError('V23存在未识别的翼面非流形边：'+obj.name)
            a,b=edge.verts
            opposite=set(v for f in edge.link_faces for v in f.verts)-{a,b}
            found=False
            for c,d in itertools.combinations(sorted(opposite,key=lambda v:v.index),2):
                tetra={a,b,c,d}
                faces={f for v in tetra for f in v.link_faces if len(f.verts)==3 and set(f.verts)<=tetra}
                if len(faces)!=4 or len({tuple(sorted(v.index for v in f.verts)) for f in faces})!=4:continue
                if any(set(v.link_faces)!=faces.intersection(set(v.link_faces)) for v in (c,d)):continue
                counts={e:sum(e in f.edges for f in faces) for f in faces for e in f.edges}
                if any(n!=2 for n in counts.values()):continue
                volume=abs((b.co-a.co).dot((c.co-a.co).cross(d.co-a.co)))/6
                maximum_edge=max((p.co-q.co).length for p in tetra for q in tetra)
                if volume>1e-15 or maximum_edge>.01:continue
                removed.append({'vertices':[list(v.co) for v in sorted(tetra,key=lambda v:v.index)],'faces':4,'absoluteTetraVolume':volume,'maximumEdgeLength':maximum_edge,'sharedBoundary':'仅与主体共用一条边；外壳原两面保持','reason':'零厚度量级的封闭布尔赘片，不是实际翼面材料'})
                bmesh.ops.delete(bm,geom=list(faces),context='FACES_ONLY')
                loose=[e for e in bm.edges if not e.link_faces]
                if loose:bmesh.ops.delete(bm,geom=loose,context='EDGES')
                loose=[v for v in bm.verts if not v.link_edges]
                if loose:bmesh.ops.delete(bm,geom=loose,context='VERTS')
                found=True;break
            if not found:raise ValueError('V23非流形边不能证明为有限零厚度赘片：'+obj.name)
        after_volume=bm.calc_volume(signed=True)
        if any(not e.is_manifold for e in bm.edges):raise ValueError('V23清理后翼面仍非流形：'+obj.name)
        if any(f.calc_area()<=1e-18 for f in bm.faces):raise ValueError('V23清理后翼面有退化面：'+obj.name)
        if abs(after_volume-before_volume)>1e-13:raise ValueError('V23清理影响实际翼面体积：'+obj.name)
        if removed:
            bm.normal_update();bm.to_mesh(obj.data);obj.data.update();obj.data.set_sharp_from_angle(angle=0.7330382858376184)
        rows.append({'node':obj.name,'removedNumericalShells':removed,'removedFaces':sum(x['faces'] for x in removed),'beforeVolume':before_volume,'afterVolume':after_volume,'existingVertexCoordinatesUnchanged':True,'boundaryEdges':sum(e.is_boundary for e in bm.edges),'nonManifoldEdges':sum(not e.is_manifold for e in bm.edges)})
        bm.free()
    return {'version':23,'parts':rows,'scope':'只清理新翼缝布尔产生的局部四面赘片；不改变原严格实体/相交/相位判定阈值'}
