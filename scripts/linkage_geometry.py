"""V18紧凑直出滑架与正装翼上球座，尺寸仅用于概念重建。

执行器坐标沿机身纵向水平移动。短斜球销是转接关节的安装轴，并非第二执行器。
翼面底座仅在明确限定的固定连接区域内与宿主翼体搭接；活动杆眼保持在外部，
必须另外通过独立全行程碰撞检查。导出extras的既有英文值保持稳定，中文说明见V18文档。
"""
import math
import bpy
from mathutils import Vector
from drive_layout import output_top_local, OUTPUT_LINK_RADIUS, OUTPUT_STUD_DISTANCE

BODY_STUD = (-.664, -.307, .679)
WING_SEAT_RADIUS = .0245
WING_SEAT_DEPTH = .0015
WING_SEAT_AUTHORED_DEPTH = .0014
# Minimum finite outer-wall rise measured on both actual pre-edit saved seats.
# Retain it when the annotated footprint reaches a steeper part of the wing.
WING_SEAT_MIN_OUTER_RISE = .00036976905539631844


def build_linkage_details(ctx):
    cylinder=ctx['cylinder_between']; plate=ctx['plate']; mesh=ctx['mesh_object']
    metal=ctx['metal']; body=ctx['body']; spreader=bpy.data.objects['BraceSpreader']
    contacts=[]
    for side, sign in [('L',-1),('R',1)]:
        ball=Vector((sign*ctx['SLIDER_X'],0,0))
        stud=Vector((-sign*.664,-.307,.679)).normalized()
        # 单根直斜件从低位横梁直接连接原球销，不再拼接竖柱和折弯鼻部。
        top=Vector(output_top_local(sign,ctx['SLIDER_Z']))
        pin_mount=ball+stud*OUTPUT_STUD_DISTANCE
        carriage=cylinder('BraceBodyCarriage_'+side,pin_mount,top,OUTPUT_LINK_RADIUS,metal,spreader,vertices=24,bevel_width=.001)
        carriage['purpose']='低位共同滑架的单根直斜输出件；机身侧球心及球销保持，运动按当前定长闭环求解'
        carriage['straightOutputEndpointsLocal']=[list(pin_mount),list(top)]
        carriage['straightOutputRadius']=OUTPUT_LINK_RADIUS
        carriage['motion']='inherits BraceSpreader; translation only, no extra linkage DOF'
        # 底座直接贴合最终真实翼网格，只有限定的小范围固定搭接，
        # 不保留旧版凸起椭圆垫和斜撑。
        wing=bpy.data.objects['Composite_wing_'+side]
        anchor=ctx['brace_wing_local'](sign)
        pivot=bpy.data.objects['WingPivot_'+side]
        verts=[];n=48
        base=[]
        for i in range(n):
            a=i*2*math.pi/n;x=anchor.x+WING_SEAT_RADIUS*math.cos(a);y=anchor.y+WING_SEAT_RADIUS*math.sin(a)
            hit,p,normal,index=wing.ray_cast(Vector((x,y,.5)),Vector((0,0,-1)))
            if not hit or normal.z<=0:raise ValueError('Wing-top seat footprint leaves the actual outward moving-wing skin: '+side)
            base.append((x,y,p.z-WING_SEAT_AUTHORED_DEPTH))
        # Keep the exact old shoulder whenever it retains the original finite
        # outer-wall rise. At a steeper host footprint only this shoulder rises;
        # the ball, pin, footprint, embed depth and two upper rings stay put.
        nominal_shoulder=anchor.z-.0285
        shoulder=max(nominal_shoulder,max(p[2] for p in base)+WING_SEAT_MIN_OUTER_RISE)
        if shoulder>=anchor.z-.026:
            raise ValueError('Final wing skin cannot retain the seat wall below its unchanged upper ring: '+side)
        verts.extend(base)
        for radius,z in [(WING_SEAT_RADIUS,shoulder),(.017,anchor.z-.026),(.008,anchor.z-.024)]:
            for i in range(n):
                a=i*2*math.pi/n;x=anchor.x+radius*math.cos(a);y=anchor.y+radius*math.sin(a)
                verts.append((x,y,z))
        faces=[]
        for ring in range(3):
            for i in range(n):j=(i+1)%n;faces.append((ring*n+i,ring*n+j,(ring+1)*n+j,(ring+1)*n+i))
        faces += [tuple(range(n-1,-1,-1)),tuple(3*n+i for i in range(n))]
        seat=mesh('BraceWingSeat_'+side,verts,faces,metal,pivot,smooth=True)
        seat.data.set_sharp_from_angle(angle=math.radians(40))
        seat['purpose']='直接贴合当前翼型的低轮廓正装球座'
        seat['attachmentRadius']=WING_SEAT_RADIUS
        seat['attachmentDepth']=WING_SEAT_DEPTH
        seat['wingHost']=wing.name
        seat['outerShoulderLift']=shoulder-nominal_shoulder
        seat['minimumOuterWallRise']=WING_SEAT_MIN_OUTER_RISE
        contacts.append({'pair':[seat.name,wing.name],'type':'fixed bonded mounting footprint','wingLocalCenter':[anchor.x,anchor.y,0], 'radius':WING_SEAT_RADIUS,'maximumDepthBelowHostSurface':WING_SEAT_DEPTH,'maximumSeatTopZ':anchor.z-.024, 'outerShoulderLift':shoulder-nominal_shoulder,'minimumOuterWallRise':WING_SEAT_MIN_OUTER_RISE})
    return {'version':22,'conceptOnly':True,'bodyOutput':'低置共用滑架，每侧一根直斜输出件连接原球销；不增设运动自由度', 'wingOutput':'按当前标注向翼弦内部移动实际球心；安装足迹直接贴最终活动翼网格，实际主轴位置由layeredWingJoint定义', 'oldWingAnchorLocal':{'L':[.26,.18,.04176],'R':[-.26,.18,.04176]}, 'newWingAnchorLocal':{side:list(ctx['brace_wing_local'](sign)) for side,sign in [('L',-1),('R',1)]}, 'baselineVersion':21,'newNodes':[],'changedNodes':['BraceWingSeat_L','BraceWingSeat_R','BraceBodyCarriage_L','BraceBodyCarriage_R'], 'removedNodePrefixes':[], 'bodyAnchorChange':{'oldLateral':.16,'newLateral':.16,'oldHeight':-.02,'newHeight':-.02}, 'preserved':['spherical eye dimensions and .0005 nominal seat gap','机身及旋翼部件局部几何和材质；翼根实际曲面及运动另验','wing rotation API','rigid rod scale=1'], 'fixedAttachmentInterfaces':contacts, 'claimBoundary':'原创机构简化与运动可视化；非原厂内部结构、制造设计、强度或适航证明'}
