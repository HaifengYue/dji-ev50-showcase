"""局部固定上皮相对活动翼的保守扫掠让位；只切活动实体，不跨刚体封口。"""
import bpy,bmesh,math,json,itertools
import numpy as np
from mathutils import Quaternion,Vector
from scipy.spatial import ConvexHull

def build(side,center,axis,boolean,temp_revolve):
 fixed=bpy.data.objects['Fixed_root_'+side];moving=bpy.data.objects['Composite_wing_'+side]
 clip=fixed.copy();clip.data=fixed.data.copy();bpy.context.collection.objects.link(clip);clip.name='TemporaryFiniteFixedSkin_'+side
 tool=temp_revolve('TemporarySweepDomain_'+side,side,[(-.05,0),(-.05,.120),(.135,.120),(.135,0)])
 boolean(clip,tool,'INTERSECT');bpy.data.objects.remove(tool,do_unlink=True)
 raw=np.array([tuple(clip.matrix_world@v.co-center)for v in clip.data.vertices]);assert len(raw)>3
 sign=-1 if side=='L'else 1;points=[]
 for degrees in range(0,121,2):
  rotation=np.array(Quaternion(axis,-sign*math.radians(degrees)).to_matrix());points.extend((raw@rotation.T).tolist())
 p=np.array(points);h=ConvexHull(p);p=p[h.vertices]
 offset=.0034;corners=np.array(list(itertools.product([-offset,offset],repeat=3)));p=(p[:,None,:]+corners[None,:,:]).reshape(-1,3);h=ConvexHull(p);used=np.unique(h.simplices);remap={v:i for i,v in enumerate(used)};vs=[p[i]+np.array(center)for i in used];fs=[[remap[int(i)]for i in f]for f in h.simplices]
 mesh=bpy.data.meshes.new('ConservativeLocalSweep_'+side);mesh.from_pydata(vs,[],fs);mesh.update();bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));assert all(e.is_manifold for e in bm.edges);bm.to_mesh(mesh);bm.free();cutter=bpy.data.objects.new(mesh.name,mesh);bpy.context.collection.objects.link(cutter)
 before=len(moving.data.vertices);boolean(moving,cutter,'DIFFERENCE');bpy.data.objects.remove(cutter,do_unlink=True);bpy.data.objects.remove(clip,do_unlink=True)
 bm=bmesh.new();bm.from_mesh(moving.data);bad=sum(not e.is_manifold for e in bm.edges);volume=bm.calc_volume(signed=True);bm.free()
 return {'side':side,'angleDegrees':[0,120],'stepDegrees':2,'radialSourceBound':.120,'sourceAxisT':[-.05,.135],'outwardBoxOffset':offset,'maximumBetweenPoseArcSagitta':.120*(1-math.cos(math.radians(1))),'conservativeConvexHull':True,'notMinimumMaterialRemoval':True,'beforeVertices':before,'afterVertices':len(moving.data.vertices),'nonManifoldEdges':bad,'volume':volume,'changesOnlyMovingSkin':True}
