"""V11局部轮廓校正：鼻罩前端微下垂、短圆钝接地端。
来源限定于蓝白N273PD照片与本轮公开视频交叉证据；数值为可视化拟合。
"""
import bpy, bmesh, math
from mathutils import Vector


def refine_nose(context):
    globals().update(context)
    hood=bpy.data.objects['CargoHoodShell']
    onset=-2.05
    tip=-2.72
    drop=.12
    origin=hood.parent.location.copy()
    changed=0
    before=[];after=[]
    for vertex in hood.data.vertices:
        p=vertex.co+origin
        before.append(tuple(p))
        t=max(0.,min(1.,(onset-p.y)/(onset-tip)))
        # 同一连续位移场用于内外壁；接缝处位移和一阶斜率都为零。
        delta=drop*t*t*(3-2*t)
        if delta>0:
            vertex.co.z-=delta;changed+=1
        after.append(tuple(vertex.co+origin))
    hood.data.update()
    hood.data.set_sharp_from_angle(angle=math.radians(42))
    hood['refinementVersion']=11
    hood['refinementEvidence']='照片7；B站02:06/125.184秒与02:02可读N273PD同一镜头；00:15展台帧交叉。'
    hood['refinementLimitation']='局部鼻端下垂为轮廓拟合，0.12不是实机测量；舱口和转轴未改。'
    def bounds(points):return {'min':[min(v[i] for v in points) for i in range(3)],'max':[max(v[i] for v in points) for i in range(3)]}
    fore_before=[p for p in before if p[1]<tip+.001]
    fore_after=[p for p in after if p[1]<tip+.001]
    return {'node':'CargoHoodShell','affectedVertices':changed,'blenderCoordinateAxis':'鼻向负Y，竖直Z','deformationStartY':onset,'noseEndY':tip,'maximumVerticalDrop':drop,'reconstructedNotMeasured':True,'noseTerminalBefore':bounds(fore_before),'noseTerminalAfter':bounds(fore_after),'shellBoundsBefore':bounds(before),'shellBoundsAfter':bounds(after),'preserved':['舱口曲折接缝','开盖轴和0–55°检视行程','压边与搭扣','后机身及翼根机构'],'source':'照片7；B站02:06/125.184s，身份由同镜头02:02/121.387s的N273PD确认；00:15/14.439s展台帧仅交叉外形'}


def refine_landing_tips(context):
    globals().update(context)
    rows=[]
    for side,sign in [('L',-1),('R',1)]:
        pivot=bpy.data.objects['WingPivot_'+side]
        for which,position in [('Front',2.12),('Rear',3.75)]:
            name='Landing_wear_tip_'+side+'_'+which
            old=bpy.data.objects[name]
            # 保持原接地终点和上接圈，最后一段使用解析半椭圆收束。
            # 原版并非开口或数学针尖；本轮改的是偏尖的小平端轮廓。
            base_sections=catmull(pod_sections,4)
            join=section_at(base_sections,.994)
            sections=[(.994,join[1]+.0008,join[2]+.0008,join[3]),(1.005,.0305,.033,-.0344),(1.017,.0265,.029,-.0348),(1.026,.024,.027,-.035)]
            for i in range(1,9):
                a=math.pi*.5*i/8
                sections.append((1.026+.026*math.sin(a),max(.001,.024*math.cos(a)),max(.001,.027*math.cos(a)),-.035))
            # 旧罩与40分段舱壳穿插形成锯齿色界。本轮同分段建模，内壁
            # 沿原舱壳留0.0002径向/端面净空；封闭薄罩不是重叠色片。
            inner=[join]+[st for st in base_sections if st[0]>.994]
            inner=[(yy+( .0002 if k==len(inner)-1 else 0),w+.0002,h+.0002,z) for k,(yy,w,h,z) in enumerate(inner)]
            # 外壁也必须始终在真实舱壳之外。将两套折线的所有纵向站点
            # 合并后逐截面留量，故站点之间线性面片也不会下切原壳面。
            outer_knots=sorted(set([q[0] for q in sections]+[q[0] for q in base_sections if q[0]>.994]+[1.0402]))
            clean_outer=[]
            for yy in outer_knots:
                _,w,h,z=section_at(sections,yy)
                if yy<=1.0402:
                    _,bw,bh,bz=section_at(base_sections,min(yy,1.04))
                    w=max(w,bw+.0008);h=max(h,bh+.0008);z=bz
                clean_outer.append((yy,w,h,z))
            sections=clean_outer
            radial=40;vertices=[];faces=[];x=sign*(position-PIVOT_X)
            for yy,w,h,z in sections+inner:
                for i in range(radial):
                    a=2*math.pi*i/radial
                    vertices.append((x+w*math.cos(a),.02+yy,z+h*math.sin(a)))
            def connect(start,count,reverse=False):
                for k in range(count-1):
                    for i in range(radial):
                        j=(i+1)%radial
                        face=((start+k)*radial+i,(start+k)*radial+j,(start+k+1)*radial+j,(start+k+1)*radial+i)
                        faces.append(tuple(reversed(face)) if reverse else face)
            connect(0,len(sections));connect(len(sections),len(inner),True)
            inner_start=len(sections)*radial
            for i in range(radial):
                j=(i+1)%radial
                faces.append((i,inner_start+i,inner_start+j,j))
            faces.append(tuple((len(sections)-1)*radial+i for i in range(radial)))
            faces.append(tuple((len(sections)+len(inner)-1)*radial+i for i in range(radial-1,-1,-1)))
            replacement=mesh_object('Temporary_V11_landing_end',vertices,faces,wear,pivot)
            bm=bmesh.new();bm.from_mesh(replacement.data)
            bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(replacement.data);bm.free()
            replacement.data.set_sharp_from_angle(angle=math.radians(48))
            # 替换原网格而非叠加包皮；父节点、名字和运动合同不变。
            old.data=replacement.data
            bpy.data.objects.remove(replacement,do_unlink=True)
            old['refinementVersion']=11
            old['refinementEvidence']='N273PD照片2/3/7及B站02:06/125.184秒的短圆钝深色接地端。'
            old['refinementLimitation']='曲率、接地材质和尺寸为原创外观重建，不代表原厂接地结构。'
            rows.append(name)
    return {'nodes':rows,'upperJoinY':.994,'terminalY':1.052,'terminalUnchanged':True,'innerRadialClearance':.0002,'innerEndClearance':.0002,'joinRimRadialThickness':.0006,'radialSegments':40,'capCurve':'末端轴向半径0.026、横向0.024、竖向0.027的椭圆圆钝收束','reconstructedNotMeasured':True,'source':'照片2/3/7；B站02:06/125.184s与00:15/14.439s交叉','preserved':['四动力舱主体','动力舱长度与轴端位置','折桨机构和所有轴节点']}


def build_refinements(context):
    return {'version':11,'nose':refine_nose(context),'landingEnds':refine_landing_tips(context),'excluded':'不改全局比例、V尾尖或探头；不添加未经识别的舵机、线束或内部设备。'}
