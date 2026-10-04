"""V14 局部错层翼根与内嵌短轴：参考照片约束的原创实体重建。
同轴径向搭接只改变轴旁局部窗口，不推断整片双层机翼或内部传动。
"""
import math
import bpy
import bmesh
from mathutils import Vector

LAP_START=0.0
LAP_PEAK=0.0
LAP_END=.160
LAP_DEPTH=.030


def smooth(t):
    t=max(0.,min(1.,t));return t*t*(3-2*t)


def lap_weight(r):
    return 1-smooth(r/LAP_END)


def joint_profile(r):
    # 两个封闭根体仍位于同一旋转不变曲面的两侧；轴向局部错位形成
    # 真实承接舌和盖唇，不让固定片跨越活动侧运动空间。
    return .21*(1-math.exp(-(r/.42)**2))-.030*lap_weight(r)


def lip_factor(distance,r):
    # 保留既有圆顺薄唇厚度，只改变实体搭接截面的局部轴向位置。
    return .42+.58*smooth(distance/.10)


def add_fold_contract():
    rows=[]
    for side in ('L','R'):
        for end in ('Front','Rear'):
            key=side+'_'+end
            motor=bpy.data.objects['Prop_'+key]
            motor['motorId']=key;motor['parkPhaseRadians']=0.;motor['foldBeforeSpin']=True
            for leaf,sgn in [('A',1),('B',-1)]:
                o=bpy.data.objects['BladeFold_'+key+'_'+leaf]
                o['foldAxis']=[0.,0.,1.];o['foldSign']=sgn;o['foldAngleDeg']=90.;o['motorId']=key
                o['restPose']='展开';o['hingeRadius']=.170
                rows.append(o.name)
    return rows


def finish_embedded_joints(context):
    # 对盖唇切面显式指定解析法线，避免布尔三角化产生假的楔形高光。
    # 未涉及新窗口的角点保留已经验收的 V12/V13 源法线。
    rows=[]
    for side,sgn in [('L',-1),('R',1)]:
        axis=context['wing_axis'](sgn)
        for name,fixed in [('Fixed_root_'+side,True),('Composite_wing_'+side,False)]:
            obj=bpy.data.objects[name]
            origin=context['pivot_position'](sgn) if fixed else Vector((0,0,0))
            normals=[n.vector.copy() for n in obj.data.corner_normals];changed=0
            offset=context['ROOT_HALF_GAP']*(1 if fixed else -1)
            for face in obj.data.polygons:
                points=[obj.data.vertices[i].co for i in face.vertices]
                # 径向插值误差由更密的局部刀具环控制；禁止把皮肤面误归为切面。
                if not all(abs(context['joint_signed'](p,origin,axis,offset))<.0009 for p in points):continue
                for li in face.loop_indices:
                    p=obj.data.vertices[obj.data.loops[li].vertex_index].co-origin;t=p.dot(axis);radial=p-axis*t;r=radial.length
                    if r>=.165 or r<1e-8:continue
                    eps=1e-5;derivative=(joint_profile(r+eps)-joint_profile(r-eps))/(2*eps)
                    n=(axis-radial*(derivative/r)).normalized()*(-1 if fixed else 1)
                    if n.dot(face.normal)>.2:normals[li]=n;changed+=1
            obj.data.normals_split_custom_set(normals);obj.data.update()
            obj['jointRevision']=14;obj['jointConstruction']='同轴局部槽舌、真实封闭截面和贯通轴孔'
            rows.append({'node':name,'analyticLapCorners':changed})
    return {'version':14,'reconstructedNotMeasured':True,'profile':{'baseDepth':.21,'baseRadius':.42,'lapStart':LAP_START,'lapPeak':LAP_PEAK,'lapEnd':LAP_END,'lapDepth':LAP_DEPTH,'halfGap':context['ROOT_HALF_GAP']},'changedRootNormals':rows,'hardware':{'shaftHalfLength':.088,'shaftRadius':.014,'bearingCenters':[-.050,.060],'bearingOuterRadius':.028,'movingCarrierOuterRadius':.039,'boreRadius':.045},'foldNodes':add_fold_contract(),'sourceBoundary':'新参考2仅支持局部上盖唇、下承接边和开放间隙；新参考4仅支持短轴端在翼壳窄槽内露出。槽舌径向尺寸及承载细节为原创可视化拟合，不是实测原厂设计。'}
