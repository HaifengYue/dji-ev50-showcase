"""Native protected8 attachment restoration in their original deterministic fit frame.

Construct only from current primitive stock captured before rebase. Four actual
hosts are never replaced; eight old-fitted data blocks are installed using an
explicit local object translation. Actual final support/64 identity remain QA.
"""
import hashlib,json,inspect
from pathlib import Path
CONTRACT_PATH=Path(__file__).with_name('data')/'legacy-powertrain-fit.json'
CONTRACT=json.loads(CONTRACT_PATH.read_text())
if CONTRACT['schema']!='transwing.legacy-powertrain-fit.v1':raise ValueError('Unexpected legacy-fit contract')
PARAMETERS=CONTRACT['parameters']
FROZEN_PARAMETER_SHA256='ac24dfd1520e10b91be22879b08cd18ef923f9552f6964f50ea21dd59663e21a'
if hashlib.sha256(json.dumps(PARAMETERS,sort_keys=True,separators=(',',':')).encode()).hexdigest()!=FROZEN_PARAMETER_SHA256:raise ValueError('Legacy fit parameters changed')
def validate_helpers(module):
 for name,expected in CONTRACT['surfaceHelperFunctionSha256'].items():
  text=inspect.getsource(getattr(module,name)).rstrip()
  if hashlib.sha256(text.encode()).hexdigest()!=expected:raise ValueError('Original geometry/material helper changed: '+name)
 if module.TIP_EMBED!=PARAMETERS['tipEmbedding']or module.SADDLE_EMBED!=PARAMETERS['saddleEmbedding']:raise ValueError('Original embedding changed')

REFERENCE=tuple(PARAMETERS['referencePivot'])
LEGACY=tuple(PARAMETERS['legacyRightPivot'])
NAMES=[prefix+side+'_'+end for side in ['L','R']for end in ['Front','Rear']for prefix in ['Nacelle_','Landing_wear_tip_','Pod_wing_saddle_']]
def fingerprint(mesh):
 payload={'vertices':[list(v.co)for v in mesh.vertices],'faces':[list(p.vertices)for p in mesh.polygons],'smooth':[p.use_smooth for p in mesh.polygons]}
 return hashlib.sha256(json.dumps(payload,separators=(',',':')).encode()).hexdigest()
def capture_native_stock():
 import bpy,math
 from mathutils import Vector,Matrix,Quaternion
 result={'schema':'transwing.legacy-powertrain-stock.v1','finishedAssetInput':False,'meshes':{},'pivots':{}}
 for side,sg in [('L',-1),('R',1)]:
  pivot=bpy.data.objects['WingPivot_'+side]
  if pivot.location!=Vector((sg*REFERENCE[0],REFERENCE[1],REFERENCE[2])):raise ValueError('Capture must precede native rebase')
  expected=Quaternion(Vector((-sg,-1,1)).normalized(),sg*2*math.pi/3)
  if tuple(pivot.rotation_quaternion)!=tuple(expected):raise ValueError('Capture requires actual original native hover quaternion')
  result['pivots'][side]={'location':list(pivot.location),'quaternion':list(pivot.rotation_quaternion),'scale':list(pivot.scale)}
 for name in NAMES:
  o=bpy.data.objects[name]
  if o.type!='MESH'or o.matrix_basis!=Matrix.Identity(4)or o.modifiers or o.animation_data:raise ValueError('Noncanonical stock '+name)
  result['meshes'][name]={'data':o.data.copy(),'sourceMeshSha256':fingerprint(o.data),'sourceParent':o.parent.name,'sourceObjectMatrix':[list(r)for r in o.matrix_basis]}
 return result

def prepare_legacy_fits(stock, surface_helpers):
 """Use the unchanged original geometry-affecting helpers on scratch stock only.

The real integration must bind the helper file SHA and require function parity
against minimal-replay-functions-v2.json before invoking this preparation.
"""
 import bpy
 from mathutils import Vector,Matrix,Quaternion
 validate_helpers(surface_helpers)
 if stock['schema']!='transwing.legacy-powertrain-stock.v1'or set(stock['meshes'])!=set(NAMES):raise ValueError('Incomplete captured12 stock')
 collection=bpy.data.collections.new('LegacyPowertrainFit_DIAGNOSTIC');bpy.context.scene.collection.children.link(collection)
 objects=[];pivots={};shadows={};results={};evidence=[]
 try:
  for side,sg in [('L',-1),('R',1)]:
   pivot=bpy.data.objects.new('LegacyFitPivot_'+side,None);collection.objects.link(pivot);objects.append(pivot);pivots[side]=pivot
   pivot.location=(sg*LEGACY[0],LEGACY[1],REFERENCE[2]);pivot.rotation_mode='QUATERNION';pivot.rotation_quaternion=Quaternion(stock['pivots'][side]['quaternion'])
   old_shift=Vector((sg*REFERENCE[0],REFERENCE[1],REFERENCE[2]))-Vector((sg*LEGACY[0],LEGACY[1],LEGACY[2]));old_shift.z=0.
   for name,row in stock['meshes'].items():
    if '_'+side+'_'not in name:continue
    data=row['data'].copy();data.transform(Matrix.Translation(old_shift));data.update();o=bpy.data.objects.new(name+'__LegacyFit',data);collection.objects.link(o);o.parent=pivot;objects.append(o);shadows[name]=o
  bpy.context.view_layer.update()
  for side in ['L','R']:
   for end in ['Front','Rear']:
    key=side+'_'+end;host=shadows['Nacelle_'+key];tip=shadows['Landing_wear_tip_'+key];frame=surface_helpers._frame(tip);points=surface_helpers._points(tip,frame);before=[p.copy()for p in points];tree=surface_helpers._tree(host,frame);start=len(points)-160;hits=[]
    if len(points)<320:raise ValueError('Original V11 wear-tip rings missing')
    for i in range(start,start+80):
     hit,normal,triangle,distance=tree.find_nearest(points[i])
     if hit is None or distance>.00040:raise ValueError('Legacy tip admission changed')
     hits.append({'vertex':i,'triangle':triangle,'point':list(hit),'normal':list(normal),'distance':distance});points[i]=hit-normal*surface_helpers.TIP_EMBED
    surface_helpers._set_points(tip,points,frame)
    # Full original callbacks preserve closing/triangulation/sharp source state.
    surface_helpers._record(tip,host,'isolated legacy fit proof',before,changedInnerVertices=80)
    saddle=shadows['Pod_wing_saddle_'+key];surface_helpers._fit_saddle(saddle,host)
    for source,obj in [('Landing_wear_tip_'+key,tip),('Pod_wing_saddle_'+key,saddle)]:
     obj.data.calc_loop_triangles();results[source]={'legacyData':obj.data.copy(),'legacyMeshSha256':fingerprint(obj.data),'loopNormals':[list(n.vector)for n in obj.data.corner_normals],'polygons':[list(p.vertices)for p in obj.data.polygons],'loopTriangles':[{'vertices':list(t.vertices),'loops':list(t.loops)}for t in obj.data.loop_triangles],'oldFitFrame':[list(r)for r in pivots[side].matrix_world]}
    evidence.append({'key':key,'tipNearestPoints':hits,'oldFitFrame':[list(r)for r in pivots[side].matrix_world]})
  if len(results)!=8:raise ValueError('Only the eight protected attachment results may be installed')
  return {'schema':'transwing.legacy-powertrain-fit-preparation.v1','reviewed':False,'geometryAccepted':False,'meshes':results,'fitEvidence':evidence,'installationRequired':'Apply declared legacy-to-new coordinate transport once; preserve loop provenance; prove64 and actual normal export before release'}
 finally:
  for obj in objects:
   data=obj.data if obj.type=='MESH'else None;bpy.data.objects.remove(obj,do_unlink=True)
   if data and data.users==0:bpy.data.meshes.remove(data)
  bpy.data.collections.remove(collection)

def install_prepared_with_object_rebase(prepared):
 """UNREVIEWED installation proposal; call only in a new authorized source tree.

Preflight all8, then preserve their exact data and put the declared coordinate
change in TRS. Existing nacelle_layout later adds its independent translation.
"""
 import bpy
 from mathutils import Vector,Matrix
 if prepared['schema']!='transwing.legacy-powertrain-fit-preparation.v1'or len(prepared['meshes'])!=8:raise ValueError('Expected exactly8 prepared legacy attachments')
 pending=[]
 for name,row in prepared['meshes'].items():
  o=bpy.data.objects[name];side=name.split('_')[-2];sg=-1 if side=='L'else 1
  if not name.startswith(('Landing_wear_tip_','Pod_wing_saddle_'))or o.parent!=bpy.data.objects['WingPivot_'+side]or o.matrix_basis!=Matrix.Identity(4):raise ValueError('Unexpected prepared attachment identity/frame')
  reference=Vector((sg*REFERENCE[0],REFERENCE[1],REFERENCE[2]));legacy=Vector((sg*LEGACY[0],LEGACY[1],LEGACY[2]));new=Vector((sg*1.35,-1.415,-.20))
  if o.parent.location!=new:raise ValueError('New B pivot must be installed first')
  old_shift=reference-legacy;old_shift.z=0.;new_shift=reference-new;delta=new_shift-old_shift
  if fingerprint(row['legacyData'])!=row['legacyMeshSha256']:raise ValueError('Prepared legacy data changed')
  pending.append((o,row,delta,old_shift,new_shift))
 receipts=[]
 for o,row,delta,old_shift,new_shift in pending:
  o.data=row['legacyData'].copy();o.location=delta
  if fingerprint(o.data)!=row['legacyMeshSha256']or[list(n.vector)for n in o.data.corner_normals]!=row['loopNormals']:raise ValueError('Protected data or old loop normals changed during installation')
  receipts.append({'node':o.name,'legacyDataSha256':row['legacyMeshSha256'],'objectRebaseBlender':list(delta),'oldMeshBakeBlender':list(old_shift),'newMeshBakeBlender':list(new_shift),'meshDataTransformed':False,'customNormalSetterUsed':False,'oldLoopNormalsUnmodified':True})
 bpy.context.view_layer.update()
 return {'schema':'transwing.legacy-powertrain-installation.v1','reviewed':False,'geometryAccepted':False,'rows':receipts,'originalFittingMustNotRunAgain':True}

def readonly_material_record(obj,host,method,before_points,surface_helpers,**details):
 """Original material floors and graph checks without _closed reconstruction.

Current actual contact is recomputed. The full old mesh/normal fingerprint is
asserted unchanged around reporting. This is not a final strict-self certificate.
"""
 import bpy,bmesh
 def full_identity(o):
  o.data.calc_loop_triangles()
  return (fingerprint(o.data),[list(n.vector)for n in o.data.corner_normals])
 identity=full_identity(obj);bm=bmesh.new();bm.from_mesh(obj.data)
 try:
  volume=abs(bm.calc_volume(signed=True));boundary=sum(not e.is_manifold for e in bm.edges);degenerate=sum(f.calc_area()<=1e-18 for f in bm.faces)
  if boundary or degenerate or volume<=1e-12:raise ValueError('Original author closed-solid floors failed')
 finally:bm.free()
 adjacency={v.index:set()for v in obj.data.vertices}
 for edge in obj.data.edges:
  a,b=edge.vertices;adjacency[a].add(b);adjacency[b].add(a)
 unseen=set(adjacency);components=0
 while unseen:
  components+=1;stack=[unseen.pop()]
  while stack:
   for n in adjacency[stack.pop()]:
    if n in unseen:unseen.remove(n);stack.append(n)
 if components!=1:raise ValueError('Original one-component material requirement failed')
 contact=surface_helpers._contact(obj,host,method)
 if obj.name.startswith('Pod_wing_saddle_'):
  bounds=contact['finiteContactBoundsBlender']
  if contact['strictInteriorSamples']<24 or bounds[1][0]-bounds[0][0]<.20 or bounds[1][1]-bounds[0][1]<.35:raise ValueError('Original saddle contact requirements failed')
 if full_identity(obj)!=identity:raise ValueError('Read-only contact reporting changed protected material')
 obj['surfaceSupportVersion']=21;obj['surfaceSupportMethod']=method;obj['surfaceSupportConceptOnly']=True
 frame=surface_helpers._frame(obj)
 row={'node':obj.name,'support':host.name,'method':method,'parent':obj.parent.name if obj.parent else None,'beforeBoundsBlender':surface_helpers._bounds(before_points),'afterBoundsBlender':surface_helpers._bounds(surface_helpers._points(obj,frame)),'coordinateSystem':'Original parent-local Blender coordinates','closedVolume':volume,'connectedComponents':components,'transformPreserved':True,'materialPreserved':True,'geometryRebuiltDuringReporting':False,**details}
 return row,contact


def capture_for_native_context(ctx):
 if '_legacyPowertrainStock'in ctx:raise ValueError('Protected stock capture may occur only once')
 stock=capture_native_stock();ctx['_legacyPowertrainStock']=stock
 return {'schema':stock['schema'],'materialMeshes':12,'source':'actual current-generation primitive stock before native rebase','inputsSha256':hashlib.sha256(CONTRACT_PATH.read_bytes()).hexdigest(),'meshFingerprints':{n:r['sourceMeshSha256']for n,r in stock['meshes'].items()},'finishedAircraftRead':False}

def prepare_and_install_for_native_context(ctx):
 import bpy
 import surface_supports as helpers
 stock=ctx.pop('_legacyPowertrainStock',None)
 if stock is None:raise ValueError('Missing pre-rebase current primitive stock')
 validate_helpers(helpers)
 before={n:[list(p)for p in helpers._points(bpy.data.objects[n],helpers._frame(bpy.data.objects[n]))]for n in CONTRACT['protectedAttachmentNames']}
 prepared=prepare_legacy_fits(stock,helpers)
 receipt=install_prepared_with_object_rebase(prepared)
 ctx['_legacyPowertrainBefore']=before;ctx['_legacyPowertrainReceipt']=receipt
 receipt['inputContractSha256']=hashlib.sha256(CONTRACT_PATH.read_bytes()).hexdigest();receipt['legacyFitSource']='current-generation primitive snapshots; unchanged original helper functions';receipt['originalFunctionSha256']=CONTRACT['surfaceHelperFunctionSha256'];receipt['actualCurrentMaterialReportedSeparately']=True
 for row in prepared['meshes'].values():
  if row['legacyData'].users==0:bpy.data.meshes.remove(row['legacyData'])
 for row in stock['meshes'].values():
  if row['data'].users==0:bpy.data.meshes.remove(row['data'])
 return receipt

def report_installed_attachment(ctx,name,host,helpers):
 import bpy
 from mathutils import Vector
 receipt=ctx.get('_legacyPowertrainReceipt')
 if not receipt or name not in CONTRACT['protectedAttachmentNames']:raise ValueError('Explicit installed protected attachment required')
 row=next(r for r in receipt['rows']if r['node']==name);obj=bpy.data.objects[name]
 if fingerprint(obj.data)!=row['legacyDataSha256']:raise ValueError('Installed protected geometry was rebuilt before reporting')
 before=[Vector(p)for p in ctx['_legacyPowertrainBefore'][name]]
 if name.startswith('Landing_wear_tip_'):
  details={'changedInnerVertices':80,'originalOuterVerticesUnchanged':True,'nacelleLongitudinalBand':[.994,1.009375],'nominalEmbedding':helpers.TIP_EMBED,'distalClearancePreserved':.0002}
 else:details={'originalVisibleVerticesUnchanged':True,'visibleVertexCount':len(before),'originallyOpenSurface':True,'nominalEmbedding':helpers.SADDLE_EMBED,'supportType':'Preserved original conceptual thin saddle, no new independent support'}
 result=readonly_material_record(obj,host,'Original deterministic legacy-frame fit with declared rigid object rebase',before,helpers,**details)
 if name.startswith('Pod_wing_saddle_'):
  result[1]['minimumRequiredContactSpanBlenderXY']=[.20,.35];result[1]['singleClosedComponentVerified']=True
 return result
