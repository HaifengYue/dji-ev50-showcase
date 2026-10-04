"""核验保存的 Blender 两套实际动作以及四动力完整启停时序。"""
import bpy,os,runpy,math,json,hashlib
from mathutils import Quaternion,Vector
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.wm.open_mainfile(filepath=ROOT+'/assets/blender/xp4.blend')
ns=runpy.run_path(ROOT+'/scripts/export-transition.py',run_name='verify_motor')
ns['select_clip'](ns['MOTOR_CLIP'])
s=bpy.context.scene;previous={};phases={};rows=[];errors=[];max_axis_error=0.;max_folded_spin=0.;min_phase_step=0.
for i in range(673):
 f=i/4;s.frame_set(int(f),subframe=f-int(f));bpy.context.view_layer.update();row={'frame':f,'motors':{}}
 for side in ('L','R'):
  for end in ('Front','Rear'):
   key=side+'_'+end;o=bpy.data.objects['Prop_'+key]
   relative=Quaternion((1,0,0),math.pi/2).conjugated()@o.rotation_quaternion
   phase=2*math.atan2(relative.z,relative.w)
   old=previous.get(key,phase);delta=o['spinSign']*((phase-old+math.pi)%(2*math.pi)-math.pi)
   previous[key]=phase;phases[key]=phases.get(key,0)+delta;min_phase_step=min(min_phase_step,delta)
   start=bpy.data.objects['MotorAxisStart_'+key].matrix_world.translation;finish=bpy.data.objects['MotorAxisEnd_'+key].matrix_world.translation
   axis=(finish-start).normalized();normal=(o.matrix_world.to_3x3()@Vector((0,0,1))).normalized();max_axis_error=max(max_axis_error,(axis-normal).length)
   fold=[abs(bpy.data.objects['BladeFold_'+key+'_'+leaf].rotation_euler.y) for leaf in ('A','B')]
   if max(fold)>.00001:max_folded_spin=max(max_folded_spin,abs(delta))
   if abs(fold[0]-fold[1])>1e-6:errors.append({'frame':f,'motor':key,'reason':'两叶折角不对称'})
   if max(fold)>math.pi/2+1e-6:errors.append({'frame':f,'motor':key,'reason':'折角超限'})
   row['motors'][key]={'foldRadians':fold,'unwrappedPhaseRadians':phases[key]}
 rows.append(row)
for frame in [0,12,156,168]:
 row=rows[int(frame*4)]
 for key,m in row['motors'].items():
  if max(abs(a-math.pi/2) for a in m['foldRadians'])>1e-6:errors.append({'frame':frame,'motor':key,'reason':'停机端点未完整收折'})
assert min_phase_step>-1e-6
assert max_axis_error<1e-6
assert max_folded_spin<1e-6
assert all(abs(p-10*math.pi)<1e-5 for p in phases.values())
assert not errors,errors
report={'modelVersion':24,'passed':True,'blendSha256':hashlib.sha256(open(ROOT+'/assets/blender/xp4.blend','rb').read()).hexdigest(),'clip':ns['MOTOR_CLIP'],'durationSeconds':7,'sampleCount':len(rows),'maxRotorAxisError':max_axis_error,'maxPhaseStepWhileBladeFolded':max_folded_spin,'minimumPhaseStep':min_phase_step,'finalPhases':phases,'independentFoldNodes':8,'errors':errors,'samples':rows,'limitations':'保存源的673个四分之一帧检查，不替代全部机翼状态下的空间碰撞、真实发动机控制或安全认证。'}
json.dump(report,open(ROOT+'/qa/current/author/source-motor-animation.json','w'),ensure_ascii=False,indent=2)
print({k:v for k,v in report.items() if k!='samples'})
