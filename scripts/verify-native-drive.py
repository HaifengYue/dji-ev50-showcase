import bpy,sys,os,json,math,hashlib
from mathutils import Quaternion
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.wm.open_mainfile(filepath=os.path.join(root,'assets/blender/xp4.blend'))
scene=bpy.context.scene
names=['Drive_ScrewRotor','Drive_MotorRotor']+['Drive_PlanetRotor_'+str(i) for i in range(3)]
driver_rows=[]
for n in names:
 o=bpy.data.objects[n];curves=list(o.animation_data.drivers)
 assert len(curves)==4,n
 for curve in curves:
  d=curve.driver
  assert d.is_simple_expression and d.is_valid,(n,d.expression)
  assert len(d.variables)==1 and d.variables[0].targets[0].id.name=='BraceSpreader' and d.variables[0].targets[0].data_path=='location[1]'
  driver_rows.append({'node':n,'component':curve.array_index,'expression':d.expression,'simpleExpression':d.is_simple_expression,'input':'BraceSpreader.location[1]'})
scene.frame_set(0);rest=float(bpy.data.objects['BraceSpreader'].location.y);rests={n:bpy.data.objects[n].rotation_quaternion.copy().normalized() for n in names};maximum=0;worst=None
for i in range(2001):
 f=199*i/2000;scene.frame_set(int(f),subframe=f-int(f));y=float(bpy.data.objects['BraceSpreader'].location.y)
 for n,r in zip(names,[1,3,-4,-4,-4]):
  q=bpy.data.objects[n].rotation_quaternion.copy().normalized();half=math.remainder(-math.pi*(y-rest)/.032*r,2*math.pi);expected=rests[n]@Quaternion((math.cos(half),0,math.sin(half),0));expected.normalize();dot=sum(float(a)*float(b) for a,b in zip(q,expected));dot/=math.sqrt(sum(float(a)*float(a) for a in q)*sum(float(a)*float(a) for a in expected));error=1-abs(dot)
  if error>maximum:maximum=error;worst={'frame':f,'name':n,'qerror':error,'sliderY':y}
r={'modelVersion':24,'passed':maximum<1e-10,'samples':2001,'maxQerror':maximum,'worst':worst,'reopenedSavedBlend':True,'driverConstraints':driver_rows,'automaticExecutionFailed':bool(bpy.app.autoexec_fail),'sourceBlendSha256':hashlib.sha256(open(bpy.data.filepath,'rb').read()).hexdigest()};json.dump(r,open(root+'/qa/current/author/source-native-drive.json','w'),indent=2);print(json.dumps(r,indent=2));assert r['passed'],r
