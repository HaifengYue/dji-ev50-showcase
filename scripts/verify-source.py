"""Blender 原始文件的共轴、定长、默认姿态和弧面检查；不替代独立 GLB 碰撞审查。"""
import bpy, os, sys, json, hashlib
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0,os.path.join(ROOT,'scripts'))
from kinematics import *
from embedded_joint_surfaces import joint_profile
bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/blender/xp4.blend'))
s=bpy.context.scene
errors={'braceEndpoint':0.,'braceLength':0.,'braceScale':0.,'coaxialCenters':0.,'rotorEndpointAxes':0.,'rootCurveDeviation':0.}
lengths={side:[] for side in ('L','R')}
points={side:[] for side in ('L','R')}
sliders=[]
for k in range(1001):
    f=199*k/1000;s.frame_set(int(f),subframe=f-int(f));bpy.context.view_layer.update()
    sliders.append(bpy.data.objects['BraceSpreader'].location.y)
    for side,sign in [('L',-1),('R',1)]:
        p=bpy.data.objects['WingPivot_'+side];a=bpy.data.objects['BraceBody_'+side].matrix_world.translation;b=bpy.data.objects['BraceWing_'+side].matrix_world.translation
        points[side].append(b.copy())
        rod=bpy.data.objects['BraceRod_'+side];length=brace_length(sign)
        errors['braceEndpoint']=max(errors['braceEndpoint'],(rod.matrix_world@Vector((0,0,0))-a).length,(rod.matrix_world@Vector((0,0,length))-b).length)
        errors['braceLength']=max(errors['braceLength'],abs((b-a).length-length))
        errors['braceScale']=max(errors['braceScale'],max(abs(v-1) for v in rod.scale));lengths[side].append((b-a).length)
        axis=wing_axis(sign);origin=pivot_position(sign)
        for node in ['RootAxisStart_'+side,'RootAxisEnd_'+side,'RootBearingCenter_'+side+'_Front','RootBearingCenter_'+side+'_Rear']:
            d=bpy.data.objects[node].matrix_world.translation-origin
            errors['coaxialCenters']=max(errors['coaxialCenters'],d.cross(axis).length)
        for name,sgn in [('Fixed_root_'+side,1),('Composite_wing_'+side,-1)]:
            o=bpy.data.objects[name]
            for v in o.data.vertices:
                q=o.matrix_world@v.co-origin;t=q.dot(axis);radius=(q-axis*t).length
                curved=joint_profile(radius);distance=(t-curved)*sgn
                errors['rootCurveDeviation']=max(errors['rootCurveDeviation'],max(0,.003-distance))
        if k in (0,500,1000):
            expected=Vector((0,0,1)) if k in (0,1000) else Vector((0,-1,0))
            for end in ('Front','Rear'):
                axis=bpy.data.objects['Prop_'+side+'_'+end].matrix_world.to_3x3()@Vector((0,0,1))
                errors['rotorEndpointAxes']=max(errors['rotorEndpointAxes'],(axis.normalized()-expected).length)
assert all(v<(0.00015 if k=='rootCurveDeviation' else 1e-5) for k,v in errors.items()),errors
deploy=[sliders[k] for k in range(1001) if 199*k/1000<=79]
assert all(b>=a-1e-6 for a,b in zip(deploy,deploy[1:])), 'Slider reverses during deployment'
assert max(sliders)-min(sliders)>.05
assert all(max((p-points[side][0]).length for p in points[side])>.05 for side in points)
s.frame_set(0)
report={'modelVersion':24,'passed':True,'fractionalSamples':1001,'frames':[0,199],'fps':24,'source':'assets/blender/xp4.blend','sourceSha256':hashlib.sha256(open(os.path.join(ROOT,'assets/blender/xp4.blend'),'rb').read()).hexdigest(),'runtimeSha256':hashlib.sha256(open(os.path.join(ROOT,'public/models/xp4.glb'),'rb').read()).hexdigest(),'sliderMonotonicDuringUnfold':True,'sliderTravel':[min(sliders),max(sliders)],'wingAnchorDisplacement':{side:max((p-points[side][0]).length for p in points[side]) for side in points},'maxErrors':errors,'braceLengths':{side:{'min':min(v),'max':max(v),'relativeVariation':max(v)/min(v)-1} for side,v in lengths.items()},'limitations':'仅核对源动作与坐标；压缩GLB独立网格干涉、渲染外观及浏览器操作需另行检查。'}
out=os.path.join(ROOT,'qa/current/author/source-kinematics.json');json.dump(report,open(out,'w'),indent=2);print(json.dumps(report,indent=2))
json.dump(report,open(os.path.join(ROOT,'assets/source-animation-validation.json'),'w'),indent=2)
