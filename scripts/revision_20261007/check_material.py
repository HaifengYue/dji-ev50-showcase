from pathlib import Path
import os,hashlib,bpy,bmesh,json,sys
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'qa/revision-20261007';LABEL=os.environ.get('TRANSWING_CANDIDATE','candidate-large-raised');sys.path.insert(0,str(ROOT/'scripts'));bpy.ops.wm.open_mainfile(filepath=str(OUT/(LABEL+'.blend')));bpy.context.view_layer.update()
from surface_supports import _contact
from mesh_precision import face_area
names=['Fixed_root_','Composite_wing_','WingLowerClosure_','RootFixedBearingPedestal_','RootCarrierBridge_','BraceWingSeat_'];names=[n+s for s in ['L','R']for n in names]+[n+s+'_Front'for s in ['L','R']for n in ['Nacelle_','Pod_wing_saddle_']]
rows=[]
for name in names:
 o=bpy.data.objects[name];bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.normal_update();adj={v:set()for v in bm.verts}
 for e in bm.edges:a,b=e.verts;adj[a].add(b);adj[b].add(a)
 unseen=set(adj);components=0
 while unseen:
  components+=1;stack=[unseen.pop()]
  while stack:
   for v in adj[stack.pop()]:
    if v in unseen:unseen.remove(v);stack.append(v)
 rows.append({'name':name,'triangles':len(bm.faces),'nonManifoldEdges':sum(not e.is_manifold for e in bm.edges),'exactFloat64ZeroAreaFaces':sum(face_area(f)==0 for f in bm.faces),'signedVolume':bm.calc_volume(signed=True),'connectedComponents':components});bm.free()
contacts=[];errors=[]
for side in ['L','R']:
 pairs=[('RootFixedBearingPedestal_'+side,'Fixed_root_'+side),('RootFixedBearingPedestal_'+side,'RootBearingFixed_'+side+'_Rear'),('RootCarrierBridge_'+side,'Composite_wing_'+side),('RootCarrierBridge_'+side,'RootCarrierMoving_'+side),('WingLowerClosure_'+side,'Composite_wing_'+side),('BraceWingSeat_'+side,'Composite_wing_'+side),('Pod_wing_saddle_'+side+'_Front','Composite_wing_'+side),('Nacelle_'+side+'_Front','Pod_wing_saddle_'+side+'_Front')]
 for a,b in pairs:
  try:contacts.append(_contact(bpy.data.objects[a],bpy.data.objects[b],'本轮实际封闭材料有限支承复核'))
  except Exception as exc:errors.append({'pair':[a,b],'error':str(exc)})
receipt={'source':LABEL+'.blend','sourceBlendSha256':hashlib.sha256((OUT/(LABEL+'.blend')).read_bytes()).hexdigest(),'topology':rows,'contactWitnesses':contacts,'contactErrors':errors,'passed':not errors and all(r['nonManifoldEdges']==0 and r['exactFloat64ZeroAreaFaces']==0 and r['signedVolume']>0 for r in rows),'claimBoundary':'Current actual geometry, finite interior contact witnesses. No strength, load, fabrication or global self-intersection certification.'};(OUT/(LABEL+'-material-and-support-check.json')).write_text(json.dumps(receipt,ensure_ascii=False,indent=2));print(json.dumps({'passed':receipt['passed'],'topology':rows,'contactErrors':errors},indent=2))
