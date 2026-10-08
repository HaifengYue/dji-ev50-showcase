"""Current closed-owner finite self-intersection classification, without legacy assets."""
from pathlib import Path
import bpy,bmesh,numpy as np,json,sys,hashlib,argparse,collections,time
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).resolve().parent))
from finite_intersections import classify
ap=argparse.ArgumentParser();ap.add_argument('--source',required=True);ap.add_argument('--output',required=True);ap.add_argument('--expected-sha',required=True)
a=ap.parse_args(sys.argv[sys.argv.index('--')+1:]if '--'in sys.argv else[])
p=Path(a.source).resolve();out=Path(a.output).resolve();out.mkdir(parents=True,exist_ok=True)
sha=lambda:hashlib.sha256(p.read_bytes()).hexdigest();assert sha()==a.expected_sha
bpy.ops.wm.open_mainfile(filepath=str(p));bpy.context.view_layer.update();rows=[];started=time.time()
for o in sorted(bpy.data.objects,key=lambda o:o.name):
 if o.type!='MESH':continue
 bm=bmesh.new();bm.from_mesh(o.data);closed=bool(bm.edges)and all(e.is_manifold for e in bm.edges);bm.free()
 if not closed:rows.append({'name':o.name,'closed':False,'scope':'Open-owner role/whitelist is enforced by the separate all-owner topology gate'});continue
 m=o.data;m.calc_loop_triangles();T=[tuple(t.vertices)for t in m.loop_triangles];local=np.asarray([tuple(v.co)for v in m.vertices],dtype=np.float64);world=np.asarray(o.matrix_world,dtype=np.float64);P=local@world[:3,:3].T+world[:3,3]
 tree=BVHTree.FromPolygons(P.tolist(),T,all_triangles=True);hist=collections.Counter();robust=0;coplanar=0;candidates=0;shared=0;witnesses=[]
 for i,j in tree.overlap(tree):
  if i>=j:continue
  if set(T[i])&set(T[j]):shared+=1;continue
  candidates+=1;r=classify(P[list(T[i])],P[list(T[j])]);hist[r['class']]+=1
  bad=bool(r.get('robustOver1e7'));area=r['class']=='coplanar_area_overlap';robust+=bad;coplanar+=area
  if (bad or area)and len(witnesses)<3:witnesses.append({'triangles':[i,j],'classification':r})
 row={'name':o.name,'closed':True,'triangles':len(T),'nonAdjacentBvhCandidates':candidates,'sharedVertexPairsExcluded':shared,'classificationCounts':dict(hist),'robustFiniteCrossings':robust,'coplanarAreaOverlaps':coplanar,'witnesses':witnesses};rows.append(row);print(o.name,candidates,robust,coplanar,flush=True)
assert sha()==a.expected_sha,'Native changed during inspection'
report={'sourceSha256':a.expected_sha,'closedOwnersChecked':sum(r['closed']for r in rows),'openOwnersDelegatedToRoleAwareTopologyGate':sum(not r['closed']for r in rows),'finiteThresholdU':1e-7,'coplanarAreaThresholdU2':1e-14,'properPlaneStraddleAloneIsNotPenetration':True,'scope':'All nonadjacent triangle pairs of each closed native mesh owner in exact Float64 affine world coordinates. Shared-vertex topology contacts excluded. Different-owner contacts/containment have separate current motion and attachment gates.','rows':rows,'seconds':time.time()-started,'passed':all(not r.get('robustFiniteCrossings',0)and not r.get('coplanarAreaOverlaps',0)for r in rows)}
(out/'native-self-intersections.json').write_text(json.dumps(report,indent=2)+'\n');assert report['passed'],'Robust same-owner intersection detected'
