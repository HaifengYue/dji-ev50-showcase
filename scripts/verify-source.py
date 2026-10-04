"""Blender 原始文件共轴、定长、默认姿态和实际分层截面；不替代独立GLB全程审查。"""
import bpy, os, sys, json, hashlib
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0,os.path.join(ROOT,'scripts'))
from kinematics import *
bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/blender/xp4.blend'))
s=bpy.context.scene
errors={'braceEndpoint':0.,'braceLength':0.,'braceScale':0.,'coaxialCenters':0.,'rotorEndpointAxes':0.}
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
        if k in (0,500,1000):
            expected=Vector((0,0,1)) if k in (0,1000) else Vector((0,-1,0))
            for end in ('Front','Rear'):
                axis=bpy.data.objects['Prop_'+side+'_'+end].matrix_world.to_3x3()@Vector((0,0,1))
                errors['rotorEndpointAxes']=max(errors['rotorEndpointAxes'],(axis.normalized()-expected).length)
assert all(v<1e-5 for v in errors.values()),errors
deploy=[sliders[k] for k in range(1001) if 199*k/1000<=79]
assert all(b>=a-1e-6 for a,b in zip(deploy,deploy[1:])), 'Slider reverses during deployment'
assert max(sliders)-min(sliders)>.05
assert all(max((p-points[side][0]).length for p in points[side])>.05 for side in points)
# 旧旋转不变t=f(r)边界已被用户要求的非轴对称层叠翼根取代。
# 检查实际材料的竖直射线截面，不能用放宽旧曲面偏差来冒充新几何证据。
contract_path=os.path.join(ROOT,'qa/contracts/layered-wing-refinement.json')
contract=json.load(open(contract_path));assert contract['reviewed']
witnesses=contract['design']['lowerWrapWitnessesBlender'];assert len(witnesses)>=8
s.frame_set(79);bpy.context.view_layer.update()
def section(obj,x,y):
    obj.data.calc_loop_triangles();hits=[]
    for t in obj.data.loop_triangles:
        a,b,c=[obj.matrix_world@obj.data.vertices[i].co for i in t.vertices]
        den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y)
        if abs(den)<=1e-18:continue
        u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/den
        v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/den
        if min(u,v,1-u-v)>=-1e-10:hits.append(u*a.z+v*b.z+(1-u-v)*c.z)
    hits.sort(reverse=True);unique=[]
    for z in hits:
        if not unique or abs(z-unique[-1])>1e-9:unique.append(z)
    return unique
sections=[]
for side,sign in [('L',-1),('R',1)]:
    fixed=bpy.data.objects['Fixed_root_'+side];moving=bpy.data.objects['Composite_wing_'+side]
    for sample in witnesses:
        x,y=sample['x']*sign,sample['y'];a=section(fixed,x,y);b=section(moving,x,y)
        assert len(a)==2 and len(b)==2,('需要固定翼单闭区间与活动下唇单闭区间；不接受岛状或缺失蒙皮',side,x,y,a,b)
        gap=a[1]-b[0];thickness=b[0]-b[1]
        assert sample['minimumGap']<=gap<=sample['maximumGap'],('真实上下间隙不符',side,x,y,gap)
        assert sample['minimumSkinThickness']<=thickness<=sample['maximumSkinThickness'],('真实下唇厚度不符',side,x,y,thickness)
        sections.append({'side':side,'x':x,'y':y,'fixedZ':a,'movingZ':b,'gap':gap,'thickness':thickness})
s.frame_set(0)
report={'modelVersion':24,'passed':True,'fractionalSamples':1001,'frames':[0,199],'fps':24,'source':'assets/blender/xp4.blend','sourceSha256':hashlib.sha256(open(os.path.join(ROOT,'assets/blender/xp4.blend'),'rb').read()).hexdigest(),'runtimeSha256':hashlib.sha256(open(os.path.join(ROOT,'public/models/xp4.glb'),'rb').read()).hexdigest(),'sliderMonotonicDuringUnfold':True,'sliderTravel':[min(sliders),max(sliders)],'wingAnchorDisplacement':{side:max((p-points[side][0]).length for p in points[side]) for side in points},'maxErrors':errors,'braceLengths':{side:{'min':min(v),'max':max(v),'relativeVariation':max(v)/min(v)-1} for side,v in lengths.items()},'limitations':'仅核对源动作与坐标；压缩GLB独立网格干涉、渲染外观及浏览器操作需另行检查。'}
report['layeredSkinSections']={'contractSha256':hashlib.sha256(open(contract_path,'rb').read()).hexdigest(),'samples':sections,'method':'实际Blender闭合三角材料的竖直射线，两个材料区间配对；不导入生成器边界函数','limitations':'独立GLB还须验证双编码截面、支承及完整受影响运动域；这些有限截面不是连续净空证明'}
out=os.path.join(ROOT,'qa/current/author/source-kinematics.json');json.dump(report,open(out,'w'),indent=2);print(json.dumps(report,indent=2))
json.dump(report,open(os.path.join(ROOT,'assets/source-animation-validation.json'),'w'),indent=2)
