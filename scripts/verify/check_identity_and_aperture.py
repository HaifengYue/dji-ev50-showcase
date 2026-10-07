from pathlib import Path
import bpy,sys,json,hashlib,struct,math
from mathutils import Vector,Quaternion
from mathutils.bvhtree import BVHTree
import argparse
args=sys.argv[sys.argv.index('--')+1:]if '--'in sys.argv else []
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--baseline',type=Path);p.add_argument('--output',type=Path,required=True);p.add_argument('--expected-sha');p.add_argument('--expected-baseline-sha');opts=p.parse_args(args);CAND=opts.source.resolve();BASE=opts.baseline.resolve()if opts.baseline else None
sha=hashlib.sha256(CAND.read_bytes()).hexdigest()
if opts.expected_sha and sha!=opts.expected_sha:raise ValueError('Candidate SHA mismatch')
if BASE and opts.expected_baseline_sha and hashlib.sha256(BASE.read_bytes()).hexdigest()!=opts.expected_baseline_sha:raise ValueError('Baseline SHA mismatch')
opts.output.parent.mkdir(parents=True,exist_ok=True)

def inventory():
 out={}
 for o in bpy.data.objects:
  row={'type':o.type,'parent':o.parent.name if o.parent else None,'basis':[[float(x)for x in r]for r in o.matrix_basis],'parentInverse':[[float(x)for x in r]for r in o.matrix_parent_inverse]}
  if o.type=='MESH':
   h=hashlib.sha256()
   for v in o.data.vertices:h.update(struct.pack('<3f',*v.co))
   for p in o.data.polygons:h.update(struct.pack('<II',len(p.vertices),p.material_index));h.update(struct.pack('<'+'I'*len(p.vertices),*p.vertices))
   row['meshSha']=h.hexdigest();row['vertices']=len(o.data.vertices)
  out[o.name]=row
 return out

def bodytree():
 o=bpy.data.objects['Fuselage'];o.data.calc_loop_triangles();return BVHTree.FromPolygons([o.matrix_world@v.co for v in o.data.vertices],[tuple(t.vertices)for t in o.data.loop_triangles],all_triangles=True)

def lower_hits(tree,x,y):
 out=[];origin=Vector((x,y,.105));d=Vector((0,0,-1))
 for j in range(5):
  h,n,ix,ds=tree.ray_cast(origin,d,.3)
  if h is None:break
  out.append(h.z);origin=h+d*1e-6
 return out

if BASE is None:
 bpy.ops.wm.open_mainfile(filepath=str(CAND));current=inventory();counts={'objects':len(current),'meshes':sum(x['type']=='MESH'for x in current.values())};result={'candidateSha256':sha,'candidateCounts':counts,'optionalBaselineSupplied':False,'baselineComparisonPerformed':False,'currentNames':sorted(current),'passedCurrentInventoryChecks':counts=={'objects':352,'meshes':285}};opts.output.write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
 if not result['passedCurrentInventoryChecks']:raise SystemExit('Current native inventory failed')
 raise SystemExit(0)
bpy.ops.wm.open_mainfile(filepath=str(BASE));original=inventory();baseline_body=bodytree()
bpy.ops.wm.open_mainfile(filepath=str(CAND));current=inventory();candidate_body=bodytree();r=json.loads(bpy.context.scene['annotationLinkageRefinementJSON']);keys0=set(original);keys1=set(current);changed_mesh=[n for n in keys0&keys1 if original[n].get('meshSha')!=current[n].get('meshSha')];changed_basis=[n for n in keys0&keys1 if original[n]['basis']!=current[n]['basis']];parent_changes=[n for n in keys0&keys1 if original[n]['parent']!=current[n]['parent']or original[n]['parentInverse']!=current[n]['parentInverse']]
control_names=[n for n in current if n.startswith(('Control','V_tail','CargoHinge','CargoHood'))];control_unchanged=all(original[n]==current[n]for n in control_names);protected=['Composite_wing_L','Composite_wing_R','RootCarrierBridge_L','RootCarrierBridge_R','ActuatorSideSlot_L','ActuatorSideSlot_R'];protected_unchanged={n:original[n]==current[n]for n in protected}
# Finite grid integration measures newly absent actual lower-shell projection,
# excludes portions already empty in the original side aperture.
x0,x1=.13,.255;y0,y1=.415,.845;nx,ny=250,860;dx=(x1-x0)/nx;dy=(y1-y0)/ny;new=old_void=old_skin=cand_void=0
for i in range(nx):
 x=x0+(i+.5)*dx
 for j in range(ny):
  y=y0+(j+.5)*dy;a=lower_hits(baseline_body,x,y);b=lower_hits(candidate_body,x,y);aa=bool(a);bb=bool(b)
  old_skin+=aa;old_void+=not aa;cand_void+=not bb
  if aa and not bb:new+=1
wall_comparison=[];outline=r['slotRelief']['outlineRightXY']
for a,b in zip(outline,outline[1:]+outline[:1]):
 a,b=Vector(a),Vector(b);d=b-a
 if d.length<1e-8:continue
 for t in [i/4 for i in range(5)]:
  p=a.lerp(b,t)+Vector((d.y,-d.x)).normalized()*.0003;h0=lower_hits(baseline_body,p.x,p.y);h1=lower_hits(candidate_body,p.x,p.y)
  if len(h0)==len(h1)==2:wall_comparison.append({'xy':list(p),'beforeVerticalThickness':h0[0]-h0[1],'afterVerticalThickness':h1[0]-h1[1],'difference':h1[0]-h1[1]-h0[0]+h0[1]})
res={'sourceSha256':hashlib.sha256(BASE.read_bytes()).hexdigest(),'candidateSha256':hashlib.sha256(CAND.read_bytes()).hexdigest(),'sourceCounts':{'objects':len(original),'meshes':sum(x['type']=='MESH'for x in original.values())},'candidateCounts':{'objects':len(current),'meshes':sum(x['type']=='MESH'for x in current.values())},'nodesAdded':sorted(keys1-keys0),'nodesRemoved':sorted(keys0-keys1),'parentChanges':parent_changes,'changedMeshes':sorted(changed_mesh),'changedLocalTransforms':sorted(changed_basis),'independentControlNamesChecked':control_names,'independentControlObjectsUnchanged':control_unchanged,'protectedObjectsUnchanged':protected_unchanged,'actualAddedVisibleLowerAperture':{'method':'250x860 midpoint samples; downward lower-shell rays from z.105; count baseline material and candidate void; one right-side bounded XY domain','domainXY':[[x0,y0],[x1,y1]],'gridCell':[dx,dy],'sampleCount':nx*ny,'newVoidCells':new,'estimatedAdditionalProjectedAreaPerSide':new*dx*dy,'twoSideEstimate':2*new*dx*dy,'gridAreaResolution':dx*dy,'notAnalyticExactArea':True},'newBoundaryWallComparison':{'samples':len(wall_comparison),'maximumAbsoluteVerticalThicknessChange':max(abs(v['difference'])for v in wall_comparison),'minimumCandidate':min(v['afterVerticalThickness']for v in wall_comparison),'note':'The retained skin immediately outside new aperture is the original actual lower shell; finite vertical thickness comparison only'},'passedIdentityChecks':keys0==keys1 and not parent_changes and control_unchanged and all(protected_unchanged.values())};opts.output.write_text(json.dumps(res,indent=2));print(json.dumps(res,indent=2),flush=True)
