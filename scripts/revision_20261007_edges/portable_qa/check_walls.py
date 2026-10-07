from pathlib import Path
import bpy,sys,json,math,hashlib
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from qa_context import bootstrap
Q=bootstrap(require_baseline=False)
R=Q.project.parent.parent;W=Q.output;P=Q.project/'scripts';CANDIDATE=Q.candidate;BASELINE=Q.baseline
from rebuild_rear_corner_flat import _tree,_skin,_station
bpy.ops.wm.open_mainfile(filepath=str(CANDIDATE))
rows=[]
for side,sg in [('L',-1),('R',1)]:
 wing=bpy.data.objects['Composite_wing_'+side];wt=_tree(wing);ft=_tree(bpy.data.objects['Fixed_root_'+side]);tests=[];gaps=[]
 for domain,xs,ys in [('front',[.66+.005*i for i in range(95)],[-1.785+.0025*i for i in range(69)]),('rear',[.65+.003*i for i in range(103)],[-1.11+.002*i for i in range(68)])]:
  for x in xs:
   for y in ys:
    hit,n,idx,d=wt.ray_cast(Vector((sg*x,y,-1)),Vector((0,0,1)),2)
    if hit is None or n.z>-.65:continue
    inward=-n;op=wt.ray_cast(hit+inward*2e-6,inward,1)
    if op[0] is None:continue
    distance=op[3]+2e-6
    # Exclude points within .012 of an actual inner boundary: an oblique
    # ray there can exit the end wall before reaching the opposite skin.
    inner=wt.ray_cast(Vector((sg*.2,y,hit.z+.005)),Vector((sg,0,0)),2)[0]
    edgeDistance=(x-abs(inner.x))if inner else None
    primary=(edgeDistance is not None and edgeDistance>.014 and (domain!='rear' or y<-.986))
    tests.append({'domain':domain,'x':x,'y':y,'lower':list(hit),'normalWall':distance,'edgeDistance':edgeDistance,'primaryInteriorSample':primary})
    upper=wt.ray_cast(Vector((sg*x,y,1)),Vector((0,0,-1)),2)[0];fixed=ft.ray_cast(Vector((sg*x,y,-1)),Vector((0,0,1)),2)[0]
    if upper and fixed and upper.z<fixed.z and edgeDistance is not None and edgeDistance>.006:gaps.append({'domain':domain,'x':x,'y':y,'verticalGap':fixed.z-upper.z})
 primary=[r for r in tests if r['primaryInteriorSample']];bad=[r for r in primary if r['normalWall']<.010];row={'side':side,'testedLowerSamples':len(tests),'primaryInteriorSamples':len(primary),'minimumPrimaryNormalWall':min(primary,key=lambda r:r['normalWall']),'primaryBelow010Count':len(bad),'primaryBelow010Witnesses':sorted(bad,key=lambda r:r['normalWall'])[:20],'fixedGapSamples':len(gaps),'minimumFixedVerticalGap':min(gaps,key=lambda r:r['verticalGap'])if gaps else None,'allSampleMinimumIncludingEndEdgeAndFeather':min(tests,key=lambda r:r['normalWall'])};rows.append(row);print(json.dumps(row),flush=True)
report={'candidateSha256':hashlib.sha256((CANDIDATE).read_bytes()).hexdigest(),'rows':rows,'boundary':'Finite BVH rays only, actual lower-face normals, primary samples >.014u from measured end wall and rear y<-.986. Thin natural feather and edge exits reported separately, not waived as full-body guarantee.'};(W/'wall-screen.json').write_text(json.dumps(report,indent=2))
