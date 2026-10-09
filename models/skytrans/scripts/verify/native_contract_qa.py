"""Independent current-native kinematics for QA; no historical asset/build imports."""
import json,math
import bpy
from mathutils import Vector,Quaternion,Matrix
CONTRACT=None
REC=None
_BOUND_SCENE_MECHANISM=None

def configure(contract):
 global CONTRACT
 CONTRACT=contract

def hydrate_final_mechanism():
 global REC,_BOUND_SCENE_MECHANISM
 raw=bpy.context.scene['annotatedMechanismJSON']
 if raw==_BOUND_SCENE_MECHANISM:return
 REC=json.loads(raw);assert REC['schema']=='transwing.annotated-mechanism.final.v1'
 assert abs(REC['wingAnchorRightCruise'][0]-CONTRACT['anchorAbsX'])<1e-6
 assert abs(REC['foldAngleDegrees']-CONTRACT['foldAngleDegrees'])<1e-9
 assert max(abs(a-b)for a,b in zip(REC['bodyAnchorRightCruise'],CONTRACT['sliderBodyAnchor']))<1e-8
 assert abs((Vector(REC['wingAnchorRightCruise'])-Vector(REC['bodyAnchorRightCruise'])).length-REC['rigidRodLength'])<1e-6
 _BOUND_SCENE_MECHANISM=raw

def slider_y(wing,sg=1):
 hydrate_final_mechanism();body=REC['bodyAnchorRightCruise'];r2=REC['rigidRodLength']**2-(wing.x-sg*body[0])**2-(wing.z-body[2])**2
 if r2<=0:raise ValueError('No real constant-rod closure')
 return wing.y+math.sqrt(r2)

def slider_at(unfold):
 hydrate_final_mechanism();pivot=Vector(REC['actualRightPivot']);local=Vector(REC['wingAnchorRightCruise'])-pivot;axis=Vector(REC['rightAxisUnnormalized']).normalized();q=Quaternion(axis,math.radians(REC['foldAngleDegrees'])*(1-unfold));return slider_y(pivot+q@local)

def update_linkage():
 hydrate_final_mechanism();bpy.context.view_layer.update();ys=[slider_y(bpy.data.objects['BraceWing_'+s].matrix_world.translation,sg)for s,sg in [('L',-1),('R',1)]]
 if abs(ys[0]-ys[1])>1e-5:raise ValueError('Asymmetric spreader closure')
 bpy.data.objects['BraceSpreader'].location=(0,sum(ys)/2,REC['bodyAnchorRightCruise'][2]);bpy.context.view_layer.update()
 for s in ['L','R']:
  a=bpy.data.objects['BraceBody_'+s].matrix_world.translation;b=bpy.data.objects['BraceWing_'+s].matrix_world.translation;z=(b-a).normalized();ref=bpy.data.objects['WingPivot_'+s].matrix_world.to_3x3()@Vector((0,0,1));y=ref-z*ref.dot(z)
  assert y.length>1e-6;y.normalize();x=y.cross(z).normalized();o=bpy.data.objects['BraceRod_'+s];o.location=a;o.rotation_mode='QUATERNION';o.rotation_quaternion=Matrix((x,y,z)).transposed().to_quaternion();o.scale=(1,1,1)
 displacement=bpy.data.objects['BraceSpreader'].location.y-slider_at(0)
 for n,ratio in CONTRACT['phaseRatios'].items():
  o=bpy.data.objects[n];assert abs(o['screwLead']-CONTRACT['screwLead'])<1e-9;assert abs(o['phaseRatio']-ratio)<1e-9 and o['phaseSign']==-1;o.rotation_mode='QUATERNION';o.rotation_quaternion=Quaternion((0,1,0),math.remainder(-2*math.pi*displacement/CONTRACT['screwLead']*ratio,2*math.pi))
 bpy.context.view_layer.update()

def _helix_phase(obj,frame_inverse,axis_z=0.,lead=.032):
 verts=obj.data.vertices
 if len(verts)<8 or len(verts)%4:raise ValueError('Not four-corner constant-lead thread '+obj.name)
 transform=frame_inverse@obj.matrix_world;values=[]
 for i in range(0,len(verts),4):
  ring=[transform@verts[i+j].co for j in range(4)];yc=sum(p.y for p in ring)/4;angles=[math.atan2(p.x,p.z-axis_z)for p in ring];a=math.atan2(sum(math.sin(q)for q in angles),sum(math.cos(q)for q in angles));values.append(math.remainder(a-2*math.pi*yc/lead,2*math.pi))
 phase=math.atan2(sum(math.sin(a)for a in values),sum(math.cos(a)for a in values));spread=max(abs(math.remainder(a-phase,2*math.pi))for a in values)
 if spread>1e-4:raise ValueError('Not expected constant-lead helix '+obj.name)
 return phase,spread
