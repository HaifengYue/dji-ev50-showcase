"""Native annotated root with the bounded segmented v7d tail partition.

The established macro/B2 curves, gap/skin allowances and paint clipping remain
literal preserved helpers. The cutter is deliberately replaced by the v7d
same-body core termination and downstream raw-skin closed partition. This is
not the old v5 whole-function/literal geometry contract. All generation inputs
are project-relative primitives/data, never a completed aircraft or AST import.

Build after the one native XYZ rebase; finish repair4 then trim2 before the
unchanged five-strip closing and actual ball/rod fit. Combined source/runtime
material, support, motion and original-shape acceptance remain independent.
"""
import bisect
import hashlib
import json
import math
from pathlib import Path

PARAMETER_PATH = Path(__file__).with_name('data') / 'annotated-root-interface.json'
CONTRACT = json.loads(PARAMETER_PATH.read_text(encoding='utf-8'))
if CONTRACT.get('schema') != 'transwing.annotated-root-interface.segmented-tail-v7d.v1':
    raise ValueError('Unexpected annotated root parameter schema')
# Parameters describe preserved pre-tail helpers and v7d additions; the whole v5 cutter is superseded.
FROZEN_PARAMETER_SHA256 = '4f96018488865e6a8e59bc02ce944f0d20a554e6142b36f123ce110c9fe2cc09'
if hashlib.sha256(json.dumps(CONTRACT['parameters'], sort_keys=True, separators=(',', ':')).encode()).hexdigest() != FROZEN_PARAMETER_SHA256:
    raise ValueError('Root helper/tail parameter contract and reviewed source recipe disagree')
ROWS = CONTRACT['b2Knots']
YS = [r['y'] for r in ROWS]
if len(ROWS) != 201 or any(a >= b for a, b in zip(YS, YS[1:])):
    raise ValueError('The complete ordered 201-knot B2 curve is required')
if hashlib.sha256(json.dumps(ROWS, sort_keys=True, separators=(',', ':')).encode()).hexdigest() != CONTRACT['b2KnotsSha256']:
    raise ValueError('B2 parameter integrity mismatch')


def reference_curve(y):
    # The original macro-reference implementation and mathutils arithmetic.
    from layered_wing_joint import reference_curve as original
    return original(y)


def _orient(obj):
    from layered_wing_joint import _orient as original
    return original(obj)


def lower_curve(y):
 if y<=YS[0]:return ROWS[0]['absX']
 if y>=YS[-1]:return ROWS[-1]['absX']
 j=bisect.bisect_right(YS,y)-1;a,b=ROWS[j],ROWS[j+1];u=(y-a['y'])/(b['y']-a['y']);return a['absX']*(1-u)+b['absX']*u

def smooth(q):
 q=max(0.,min(1.,q));return q*q*(3-2*q)
def local_bump(y,a,b,ramp=.03):
 return smooth((y-(a-ramp))/ramp)*smooth(((b+ramp)-y)/ramp)
def smooth_positive(d,s=.0001):
 if d<=0:return 0.
 if d>=s:return d
 t=d/s;return d*t*(2-t)
def upper_gap(y):
 value=.012+.033*local_bump(y,-1.327183,-1.269155)
 for target,a,b,ramp in [(.024,-1.250,-1.154,.008),(.017,-.979,-.949,.003)]:
  value+=local_bump(y,a,b,ramp)*smooth_positive(target-value)
 return value
def construction_top_allowance(y,fixed):
 return .011 if fixed else .011-.00085*local_bump(y,-1.585,-1.566,.003)
def lower_gap(y):return .020+.034*local_bump(y,-1.339421,-1.233214)
def construction_bottom_allowance(y):
 return .011-.00085*local_bump(y,-1.345,-1.315,.010)

def skin(ctx,stations,x,y,upper):
 st=ctx['wing_station'](stations,x);u=max(0.,min(1.,(y-st[1])/st[2]));return ctx['airfoil_point'](st,u,upper)[2]

def hybrid_cutter(ctx,side,sign,fixed,stations,pivot):
 # Call-time import: annotated_tail_partition obtains these fully initialized
 # preserved helpers only when actual geometry construction begins.
 from annotated_tail_partition import build_partition
 return build_partition(ctx,side,sign,fixed,stations,pivot)

def clip_hybrid_paint(ctx,obj,side,sign,fixed,stations,pivot):
 import bmesh
 from mathutils import Vector
 obj.data.calc_loop_triangles();half=len(obj.data.polygons)//2;origin=Vector()if fixed else pivot.location.copy();vv=[];ff=[]
 for tri in obj.data.loop_triangles:
  top=tri.polygon_index<half;poly=[obj.data.vertices[i].co.copy()for i in tri.vertices]
  def inside(p):
   q=p+origin;bound=(reference_curve(q.y)if top else lower_curve(q.y))+(0. if fixed else(upper_gap(q.y)if top else lower_gap(q.y)))
   return sign*q.x<=bound if fixed else sign*q.x>=bound
  out=[]
  for a,b in zip(poly,poly[1:]+poly[:1]):
   ia,ib=inside(a),inside(b)
   if ia:out.append(a)
   if ia!=ib:
    lo,hi=a.copy(),b.copy()
    for _ in range(32):
     mid=(lo+hi)/2
     if inside(mid)==ia:lo=mid
     else:hi=mid
    out.append((lo+hi)/2)
  if len(out)>=3:
   n=len(vv);vv.extend(out);ff.append(tuple(range(n,n+len(out))))
 obj.data.clear_geometry();obj.data.from_pydata(vv,[],ff);obj.data.update();bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7);bm.normal_update();bm.to_mesh(obj.data);bm.free();obj.data.update()
 return obj


def trim_moving_body(obj,sign,origin):
 """Exact recovered v5 local-frame tail trim, called only after four-wing repair."""
 import central_wing_attachment as ca
 old=ca.JOIN_X
 try:
  ca.JOIN_X=.623-abs(origin.x)
  report=ca._trim_root(obj,sign)
 finally:ca.JOIN_X=old
 report['worldAbsX']=.623;report['wingOriginBlender']=list(origin)
 return report


def parameter_fingerprint():
    return hashlib.sha256(PARAMETER_PATH.read_bytes()).hexdigest()


def dependency_fingerprints():
    """Record current inputs without enforcing stale whole-file kinematics hashes."""
    root = Path(__file__).parent
    return {name: hashlib.sha256((root/name).read_bytes()).hexdigest()
            for name in CONTRACT['dependenciesAtMigration']}


def _preflight(ctx):
    """Read-only admission checks; the caller owns authoring rebase and pose."""
    import bpy
    from mathutils import Vector
    import kinematics
    for name in ('wing', 'skin_band', 'mesh_object', 'wing_station', 'airfoil_point'):
        if not callable(ctx.get(name)):
            raise ValueError('Missing native primitive: '+name)
    for name in ('body', 'blue'):
        if name not in ctx:
            raise ValueError('Missing native material: '+name)
    if kinematics._AUTHORING_REFERENCE:
        raise ValueError('Rebase current-generation stock before constructing the annotated roots')
    if tuple(kinematics.pivot_position(1)) != tuple(Vector((1.35,-1.415,-.20))):
        raise ValueError('Persistent mechanism does not select the actual annotated B pivot')
    for side,sign in [('L',-1),('R',1)]:
        pivot=bpy.data.objects['WingPivot_'+side]
        if (pivot.location-Vector((sign*1.35,-1.415,-.20))).length>1e-7:
            raise ValueError('Actual pivot differs from the annotated axis: '+side)
        if pivot.parent or tuple(pivot.scale)!=(1.,1.,1.) or pivot.animation_data:
            raise ValueError('Requires an unanimated rigid native wing pivot: '+side)
        if pivot.rotation_mode!='QUATERNION' or abs(pivot.rotation_quaternion.angle)>1e-7:
            raise ValueError('Author annotated finite cavities at cruise: '+side)
        for prefix,fixed in [('Fixed_root_',True),('Composite_wing_',False),
                             ('Fixed_root_blue_',True),('Wing_blue_leading_',False)]:
            obj=bpy.data.objects[prefix+side]
            if obj.type!='MESH' or obj.parent!=(None if fixed else pivot):
                raise ValueError('Unexpected current-generation root hierarchy: '+obj.name)
            if obj.animation_data or obj.modifiers:
                raise ValueError('Root stock must be unanimated evaluated native mesh: '+obj.name)
            if obj.data.get('annotatedFiniteHingeCavity'):
                raise ValueError('Annotated finite roots must not be constructed twice: '+obj.name)


def build_annotated_root_interface(ctx):
    """Stage 1: v7d partition with the preserved root/paint construction order.

    The caller has already performed the one and only authoring-coordinate
    rebase, retained complete outer assemblies, selected the actual axis and
    cruise pose. No historical scene load/unlift/rebase occurs here. Returns a
    receipt for finish_annotated_root_interface. This step does NOT repair or
    perform the moving-body trim yet; do not insert an earlier trim.
    """
    import bpy
    from wing_surfaces import root_stations
    from layered_wing_joint import _orient, _closed, _keep_outer_wing, _orient_open_paint, _replace, _boolean
    from central_wing_attachment import _trim_root, _taper_paint
    from compact_hinge_enclosure import apply_finite_host_cavity
    _preflight(ctx)
    wing=ctx['wing'];skin_band=ctx['skin_band'];body=ctx['body'];blue=ctx['blue']
    finite_cavity_rows=[];rows=[];V12_FIXED_STATIONS={}
    # _taper_paint reads this current native field in the original v5 order.
    ctx['V12_FIXED_STATIONS']=V12_FIXED_STATIONS
    for side,sg in [('L',-1),('R',1)]:
     pivot=bpy.data.objects['WingPivot_'+side];origin=pivot.location.copy()
     fixed=root_stations(sg,1.35,-1.30,-.22);V12_FIXED_STATIONS[side]=fixed
     moving=[(x-origin.x,y-origin.y,c,z-origin.z,r)for x,y,c,z,r in fixed if abs(x)>=.44]
     for typ in ['solid','paint']:
      for fixed_part in [True,False]:
       parent=None if fixed_part else pivot;st=fixed if fixed_part else moving
       name=('Fixed_root_'if fixed_part else'Composite_wing_')+side if typ=='solid' else('Fixed_root_blue_'if fixed_part else'Wing_blue_leading_')+side
       obj=wing(name+'__flat_candidate',st,body,parent)if typ=='solid'else skin_band(name+'__flat_candidate',st,0,.12 if fixed_part else .105,blue,parent)
       if typ=='solid':
        cutter=hybrid_cutter(ctx,side,sg,fixed_part,fixed,pivot);_orient(obj);_boolean(obj,cutter,'INTERSECT'if fixed_part else'DIFFERENCE');bpy.data.objects.remove(cutter,do_unlink=True)
       else:clip_hybrid_paint(ctx,obj,side,sg,fixed_part,fixed,pivot)
       if not fixed_part:_keep_outer_wing(ctx,obj,bpy.data.objects[name],sg)
       if typ=='solid':
        finite_cavity_rows.append(apply_finite_host_cavity(obj,side,'fixed'if fixed_part else'moving'))
       original=_replace(bpy.data.objects[name],obj)
       if fixed_part:
        if typ=='solid':_trim_root(original,sg)
        else:_taper_paint(original,sg,ctx)
       if typ=='solid':
        try:rows.append(_closed(original))
        except Exception as exc:rows.append({'node':original.name,'diagnosticTopologyBlocker':str(exc),'passed':False})
       else:_orient_open_paint(original,bpy.data.objects[('Fixed_root_'if fixed_part else'Composite_wing_')+side])
    bpy.context.view_layer.update()
    return {'schema':CONTRACT['schema'],'phase':'roots-built-before-repair',
            'sourceCandidateSha256':CONTRACT['provenance']['sourceCandidateSha256'],
            'parameterSha256':parameter_fingerprint(),'dependencies':dependency_fingerprints(),
            'mainWingSolids':rows,'finiteHostCavities':finite_cavity_rows,
            'nativeRegenerationVerified':False,'wholeMachineAccepted':False,
            'tailPartition':{'contractSha256':hashlib.sha256((Path(__file__).with_name('data')/'annotated-tail-partition.json').read_bytes()).hexdigest(),'sourceCandidateSha256':CONTRACT['provenance']['sourceCandidateSha256'],'reports':list(__import__('annotated_tail_partition').REPORTS[-4:])},
            'claimBoundary':'V7d tail plus preserved leading helpers; previous source certificates do not certify combined newly generated bytes.'}


def finish_annotated_root_interface(receipt):
    """Stage 2: all four wing repairs, THEN both moving-tail trims, exactly once.

    The native caller runs this immediately after root construction, before
    five-strip closing and actual linkage fitting. Compact stack/covers/supports
    are built later, when their complete original native source nodes exist.
    Do not add another repair/closed/triangulation pass after the final trim.
    """
    import bpy
    from wing_surface_repair import repair_wing_surfaces
    if receipt.get('schema')!=CONTRACT['schema'] or receipt.get('phase')!='roots-built-before-repair':
        raise ValueError('Requires the unfinished receipt from this annotated root builder')
    if receipt.get('parameterSha256')!=parameter_fingerprint():
        raise ValueError('Root parameters changed between build and final repair')
    # Mark before mutation so an interrupted partial finish cannot silently rerun.
    receipt['phase']='final-repair-in-progress'
    repair=repair_wing_surfaces()
    MOVING_BODY_TRIM_REPORTS=[]
    for side,sg in [('L',-1),('R',1)]:
     obj=bpy.data.objects['Composite_wing_'+side];MOVING_BODY_TRIM_REPORTS.append(trim_moving_body(obj,sg,obj.parent.location.copy()))
    receipt['repair']=repair
    receipt['movingBodyTrim']=MOVING_BODY_TRIM_REPORTS
    receipt['phase']='repair-then-moving-trim-complete'
    receipt['independentFinalGeometryGateRequired']=True
    return receipt
