from pathlib import Path
import bpy,sys,json,hashlib,struct,numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from qa_context import bootstrap
Q=bootstrap(require_baseline=True)
R=Q.project.parent.parent;W=Q.output;P=Q.project/'scripts';CANDIDATE=Q.candidate;BASELINE=Q.baseline
import importlib
repair_end_contours=importlib.import_module(Q.helper_module)
BASE=BASELINE
def inventory():
 bpy.context.view_layer.update();out={}
 for ob in sorted(bpy.data.objects,key=lambda o:o.name):
  h=hashlib.sha256();h.update(ob.type.encode());h.update((ob.parent.name if ob.parent else '').encode());h.update(np.asarray(ob.matrix_world,dtype='<f4').tobytes())
  if ob.type=='MESH':
   for v in ob.data.vertices:h.update(struct.pack('<3f',*v.co))
   for p in ob.data.polygons:h.update(struct.pack('<II',len(p.vertices),p.material_index));h.update(struct.pack('<'+'I'*len(p.vertices),*p.vertices))
  out[ob.name]=h.hexdigest()
 return out
runs=[]
for i in range(2):
 bpy.ops.wm.open_mainfile(filepath=str(BASE));before=inventory();repair_end_contours.apply();after=inventory();changed=sorted(k for k in set(before)|set(after)if before.get(k)!=after.get(k));runs.append({'changedOwners':changed,'inventory':after});print('REPEAT',i,changed,flush=True)
report={'helperSha256':hashlib.sha256(Path(repair_end_contours.__file__).read_bytes()).hexdigest(),'sourceSha256':hashlib.sha256(BASE.read_bytes()).hexdigest(),'sameInputRuns':2,'geometryAndTransformsIdentical':runs[0]['inventory']==runs[1]['inventory'],'changedOwners':runs[0]['changedOwners'],'changedOwnerFingerprints':{n:runs[0]['inventory'][n]for n in runs[0]['changedOwners']},'comparison':'Exact Float32 vertex bytes, ordered directed polygon indices and material IDs, object type/parent, Float32 world matrix. Object names sorted. No authoring file save.'};(W/'determinism.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
