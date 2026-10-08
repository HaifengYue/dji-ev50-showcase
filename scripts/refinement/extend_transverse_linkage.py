"""Explicit refinement of the current native input, never a historical rebuild.
Dimensions are concept units. Candidate remains subject to unchanged physical QA.
"""
import bpy,bmesh,json,math,sys,hashlib
from pathlib import Path
from mathutils import Vector,Quaternion
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts'));sys.path.insert(0,str(Path(__file__).parent))

def mesh_volume(o):
 bm=bmesh.new();bm.from_mesh(o.data);v=bm.calc_volume(signed=True);closed=all(e.is_manifold for e in bm.edges);bm.free();return v,closed

def extend_linkage(body_x=.28):
 import kinematics as kin
 rec=json.loads(bpy.context.scene['annotatedMechanismJSON']);old_length=rec['rigidRodLength'];old_body=rec['bodyAnchorRightCruise'][:];old_rest=rec['actualTravel']['hoverY'];new_body=[body_x,old_body[1],old_body[2]];delta_x=new_body[0]-old_body[0]
 for o in bpy.data.objects:o.animation_data_clear()
 for side in ['L','R']:bpy.data.objects['WingPivot_'+side].rotation_quaternion=Quaternion((1,0,0,0))
 rec['bodyAnchorRightCruise']=new_body;new_length=(Vector(rec['wingAnchorRightCruise'])-Vector(new_body)).length;rec['rigidRodLength']=new_length
 bpy.context.scene['annotatedMechanismJSON']=json.dumps(rec)
 kin._BOUND_SCENE_MECHANISM=None;kin.hydrate_final_mechanism();kin.SLIDER_X,kin.SLIDER_CRUISE_Y,kin.SLIDER_Z=new_body
 for side,sign in [('L',-1),('R',1)]:
  for prefix in ['BraceBody_','BraceBall_','BraceBallPin_','BraceBodyCarriage_']:
   name=prefix+side+('_Body' if prefix in ['BraceBall_','BraceBallPin_'] else '')
   ob=bpy.data.objects[name]
   if prefix!='BraceBodyCarriage_':ob.location.x+=sign*delta_x
   if prefix=='BraceBodyCarriage_':
    ends=[[float(x)for x in p]for p in ob['straightOutputEndpointsLocal']]
    # Keep the inner beam endpoint; only extend the slanted output to the relocated pin.
    a,b=map(Vector,ends);old_a=a.copy();old_delta=b-a;a.x+=sign*delta_x;new_delta=b-a
    mat=ob.matrix_local.copy();inv=mat.inverted();rot=old_delta.rotation_difference(new_delta)
    for v in ob.data.vertices:
     p=mat@v.co-old_a;t=p.dot(old_delta)/old_delta.length_squared;axial=old_delta*t;radial=p-axial;v.co=inv@(a+new_delta*t+rot@radial)
    ob.data.update();ends=[list(a),list(b)]
    ob['straightOutputEndpointsLocal']=ends;ob['purpose']='Extended transverse output, fixed body ball relocated outward; shared translating spreader, no added degree of freedom'
  for ob in bpy.data.objects:
   if ob.parent and ob.parent.name=='BraceRod_'+side and ob.name.endswith('_Root'):ob.location.z+=new_length-old_length
  rod=bpy.data.objects['BraceRod_mesh_'+side];mat=rod.matrix_local.copy();inv=mat.inverted();lo=.034;hi=old_length-.034
  for v in rod.data.vertices:
   p=mat@v.co;p.z=lo+(p.z-lo)*(new_length-.068)/(old_length-.068);v.co=inv@p
  rod.data.update()
 kin.update_linkage();rows=[(i/4000,kin.slider_at(i/4000))for i in range(4001)];lo=min(rows,key=lambda p:p[1]);hi=max(rows,key=lambda p:p[1]);tr={'samples':4001,'minimumY':lo[1],'maximumY':hi[1],'hoverY':rows[0][1],'cruiseY':rows[-1][1],'minimumAtUnfold':lo[0],'maximumAtUnfold':hi[0],'continuousExtremaProof':False};rec['actualTravel']=tr
 # Moving the body anchor changes hover phase. Keep actual male/female threads
 # conjugate by rotating only the male helix about its native longitudinal axis.
 from verify.native_contract_qa import _helix_phase
 male=bpy.data.objects['Drive_LeadScrewThread'];female=bpy.data.objects['Drive_NutInternalThread'];inv_frame=bpy.data.objects['Drive_ScrewRotor'].matrix_world.inverted();mp,ms=_helix_phase(male,inv_frame);fp,fs=_helix_phase(female,inv_frame);angle=math.remainder(fp-mp-math.pi,2*math.pi);mat=male.matrix_local.copy();inv=mat.inverted();q=Quaternion((0,1,0),angle)
 for v in male.data.vertices:v.co=inv@(q@(mat@v.co))
 male.data.update()
 for n in ['Drive_ScrewRotor','Drive_MotorRotor']+['Drive_PlanetRotor_'+str(i)for i in range(3)]:bpy.data.objects[n]['sliderRestY']=tr['hoverY']
 phase={'schema':'transwing.lead-screw-phase-sync.v1','operation':'Rotate only male helix vertices about existing screw-rotor local Y axis','node':male.name,'rotationRadians':angle,'rotationDegrees':math.degrees(angle),'lead':.032,'runtimeHoverY':tr['hoverY'],'maximumAxialCoordinateDelta':0.0,'sourceGeometryOnlyCopy':True}
 rec['constructionRevision']='2026-10-08 transverse output extension and bounded rounded side slot';rec['transverseOutputRefinement']={'previousBodyAnchorRightCruise':old_body,'bodyAnchorRightCruise':new_body,'previousOutputHalfSpan':.12,'outputHalfSpan':.12,'previousRodLength':old_length,'rigidRodLength':new_length,'newDegreeOfFreedom':False,'unchangedWingAnchor':rec['wingAnchorRightCruise'],'fixedPowertrainLayoutChanged':False,'oldForwardStopRetained':True};rec['geometryAcceptance']=False;bpy.context.scene['annotatedMechanismJSON']=json.dumps(rec)
 kin._BOUND_SCENE_MECHANISM=None;kin.hydrate_final_mechanism();kin.update_linkage()
 receipt=json.loads(bpy.context.scene['annotationLinkageRefinementJSON']);link=receipt['linkage'];link.update(rigidRodLength=new_length,actualTravel=tr,phase=phase,geometryAccepted=False);link['transverseOutputRefinement']=rec['transverseOutputRefinement'];bpy.context.scene['annotationLinkageRefinementJSON']=json.dumps(receipt)
 return rec['transverseOutputRefinement']|{'actualTravel':tr,'phase':phase}

from restore_lower_shell import restore_and_cut_slot

def main():
 src=Path(sys.argv[sys.argv.index('--')+1])if '--'in sys.argv else ROOT/'assets/blender/xp4.blend';out=ROOT/'build/refinement/linkage-narrow-candidate.blend';bpy.ops.wm.open_mainfile(filepath=str(src));assert hashlib.sha256(src.read_bytes()).hexdigest()=='41d1d093ce4b261483ffcc845303fc1e1b8cbb211c4b75ef24663aeb46f0d116';bpy.context.scene.frame_set(0);bpy.context.view_layer.update();r={'linkage':extend_linkage(),'slot':restore_and_cut_slot()};out.parent.mkdir(parents=True,exist_ok=True);bpy.ops.wm.save_as_mainfile(filepath=str(out),compress=True);(out.parent/'linkage-narrow-refinement.json').write_text(json.dumps(r,indent=2));print('CANDIDATE_SAVED',out)
if __name__=='__main__':main()
