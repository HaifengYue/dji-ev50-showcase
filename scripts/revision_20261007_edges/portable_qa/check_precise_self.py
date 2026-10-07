from pathlib import Path
import bpy,sys,json,hashlib,datetime,collections,numpy as np
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).resolve().parent))
from qa_context import bootstrap
Q=bootstrap(require_baseline=True)
R=Q.project.parent.parent;W=Q.output;O=Q.output;CANDIDATE=Q.candidate;BASELINE=Q.baseline;sys.path.insert(0,str(Path(__file__).resolve().parent))
from intersections import classify
out={'schema':'front-triangle-intersection.precise.v1','timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':{},'rows':[]}
for label,path in [('candidate',CANDIDATE),('baseline',BASELINE)]:
 before=hashlib.sha256(path.read_bytes()).hexdigest();bpy.ops.wm.open_mainfile(filepath=str(path));after=hashlib.sha256(path.read_bytes()).hexdigest();out['files'][label]={'sha256':before,'stableDuringRead':before==after}
 for side in ['R','L']:
  o=bpy.data.objects['Composite_wing_'+side];o.data.calc_loop_triangles();p=[o.matrix_world@v.co for v in o.data.vertices];tri=[tuple(t.vertices)for t in o.data.loop_triangles];ids=[i for i,t in enumerate(tri)if any(.64<abs(p[j].x)<1.18 and -1.80<p[j].y<-1.60 for j in t)];local=[tri[i]for i in ids];tree=BVHTree.FromPolygons(p,local,all_triangles=True);over=tree.overlap(tree);counts=collections.Counter();witnesses=[];allcross=[];n=0
  for a,b in over:
   if a>=b or set(local[a])&set(local[b]):continue
   n+=1;A=[list(p[j])for j in local[a]];B=[list(p[j])for j in local[b]];r=classify(A,B);counts[r['class']]+=1;r|={'triangleIds':[ids[a],ids[b]],'vertexIdsA':list(local[a]),'vertexIdsB':list(local[b]),'pointsA':A,'pointsB':B}
   if r['class']in['proper_transverse_crossing','coplanar_area_overlap']:
    allcross.append(r)
  # strongest robust witnesses, and crossings nearest old two thin wedges
  robust=[r for r in allcross if r.get('robustOver1e7') or r['class']=='coplanar_area_overlap'];score=lambda r:min(r.get('planeStraddleDepthA',1),r.get('planeStraddleDepthB',1),r.get('segmentLength',1),r.get('midpointEdgeMarginA',1),r.get('midpointEdgeMarginB',1))
  ranked=sorted(robust,key=score,reverse=True)[:10]
  focused=[r for r in allcross if 'midpoint'in r and .725<abs(r['midpoint'][0])<.80 and -1.785<r['midpoint'][1]<-1.735 and r['midpoint'][2]<-.225]
  chosen=ranked+sorted(focused,key=score,reverse=True)[:12];seen=set();witnesses=[]
  for r in chosen:
   k=tuple(r['triangleIds'])
   if k not in seen:witnesses.append(r);seen.add(k)
  row={'label':label,'side':side,'regionTriangles':len(ids),'nonAdjacentBVHCandidatePairs':n,'classCounts':dict(counts),'robustCrossingCountOver1e7':sum(bool(r.get('robustOver1e7'))for r in allcross),'focusedCrossingCount':len(focused),'robustFocusedCrossingCountOver1e7':sum(bool(r.get('robustOver1e7'))for r in focused),'witnesses':witnesses}
  out['rows'].append(row);print(json.dumps({k:v for k,v in row.items()if k!='witnesses'}),flush=True)
  # preserve compact exact crossing coordinates for source comparison, not a large mesh
  (O/f'crossings-{label}-{side}-{before[:8]}.json').write_text(json.dumps(allcross,separators=(',',':')))
filename=O/f"self-precise-{out['files']['candidate']['sha256'][:8]}.json";filename.write_text(json.dumps(out,indent=2));print('REPORT',filename,flush=True)
