"""低置丝杠总成、真实舱底支承及共用直连滑架的概念模型。
保留机身侧球心、低置布置与导程；翼侧球心、杆长和起始相位由当前实际机构求解。
具体布置不是原厂结构复刻或制造尺寸。
"""
import math
import bpy, bmesh
from mathutils import Vector
from drive_layout import (DRIVE_AXIS_Z, GUIDE_AXIS_Z, CROSSBEAM_Z, OUTPUT_SADDLE_Z,
    OUTPUT_SADDLE_SIZE, GUIDE_BRIDGE_Z, SUPPORT_FRAME_Z, SCREW_PEDESTAL_TOP_Z,
    GUIDE_PEDESTAL_TOP_Z, SUPPORT_FOOT_TOP_Z, MOTOR_MOUNT_Z, MOTOR_SADDLE_Z,
    MOTOR_FOOT_TOP_Z)

LEAD=.032
REDUCTION_RATIO=3.
SCREW_Z=DRIVE_AXIS_Z
NUT_OFFSET_Y=-.009
SCREW_THREAD_START=.855
SCREW_THREAD_END=1.95
BAY_START=.20
BAY_END=2.055
BAY_RADIAL_THICKNESS=.006
FRONT_SUPPORT_Y=.830
GUIDE_START=.820
MOTOR_LAYOUT_SHIFT=-.50


def _boolean(a,b,operation):
    bpy.context.view_layer.update()
    mod=a.modifiers.new('V19 finite internal drive bay' if operation=='DIFFERENCE' else 'V19 fixed construction','BOOLEAN')
    mod.operation=operation;mod.solver='EXACT';mod.object=b
    bpy.context.view_layer.objects.active=a;bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(b,do_unlink=True)


def add_contact_radial_bounds(contacts, slider_z):
    """Constrain press fits to actual narrow annular material, never whole gears."""
    bands={
      frozenset(('Drive_RingGear','Drive_ReductionHousing')):([0,SCREW_Z,0],[0.5729,0.5971],.0298,.0305),
      frozenset(('Drive_LeadScrewCore','Drive_LeadScrewThread')):([0,0,0],[SCREW_THREAD_START-.0041,SCREW_THREAD_END+.0041],.0074,.0081),
      frozenset(('Drive_NutCarriage','Drive_NutInternalThread')):([0,SCREW_Z-slider_z,0],[-.035,.017],.0119,.0129),
      frozenset(('Drive_SunGear','Drive_MotorShaft')):([0,0,0],[0.5729,0.5911],.0076,.0081),
      frozenset(('Drive_OutputCoupling','Drive_LeadScrewCore')):([0,0,0],[0.6448,0.6692],.0077,.0081),
      frozenset(('Drive_MotorHousing','Drive_MotorGearboxAdapter')):([0,SCREW_Z,0],[0.5179,0.5191],.0328,.0391),
      frozenset(('Drive_ReductionHousing','Drive_MotorGearboxAdapter')):([0,SCREW_Z,0],[0.5318,0.5342],.0298,.0371),
    }
    for c in contacts:
        band=bands.get(frozenset(c['pair']))
        if band:
            center,span,minimum,radius=band;c['cylinder']={'center':center,'axis':[0,0,-1],'range':span,'minimumRadius':minimum,'radius':radius}
        if 'Fuselage' in c['pair']:
            x=(c['min'][0]+c['max'][0])/2;z=(c['min'][2]+c['max'][2])/2
            c['cylinder']={'center':[x,0,z],'axis':[0,1,0],'range':[c['min'][1],c['max'][1]],'minimumRadius':0,'radius':.0072}
    return contacts


def build_internal_drive(ctx):
    mesh=ctx['mesh_object'];plate=ctx['plate'];cylinder=ctx['cylinder_between'];ring=ctx['ring_axis'];empty=ctx['empty']
    metal=ctx['metal'];carbon=ctx['carbon'];spreader=bpy.data.objects['BraceSpreader']
    body=bpy.data.objects['Fuselage'];contacts=[];new=[]
    def track(o,role):
        if o.type=='MESH':
            bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();o.data.update()
        o['internalDriveVersion']=22;o['conceptOnly']=True;o['driveRole']=role;new.append(o.name);return o
    def cyl(name,a,b,r,mat=metal,parent=None,role='fixed support',bevel=.0006):
        return track(cylinder('Drive_'+name,a,b,r,mat,parent,vertices=24,bevel_width=bevel),role)
    def ann(name,c,outer,inner,length,mat=metal,parent=None,role='fixed bearing'):
        return track(ring('Drive_'+name,c,(0,1,0),outer,inner,length,mat,parent),role)
    def block(name,c,size,mat=metal,parent=None,role='fixed support'):
        return track(plate('Drive_'+name,c,size,mat,parent,bevel=.001),role)
    def fixed(a,b,lo,hi,frame=None,reason='finite rigid mounting overlap'):
        # All bounds are in glTF coordinates in the named frame (world if null).
        gl=lambda v:[v[0],v[2],-v[1]]
        p,q=gl(lo),gl(hi)
        contacts.append({'pair':[a.name if hasattr(a,'name') else a,b.name if hasattr(b,'name') else b], 'frame':frame,'min':[min(x,y) for x,y in zip(p,q)],'max':[max(x,y) for x,y in zip(p,q)],'reason':reason,'type':'fixed'})

    # A genuine finite cavity, with outer mold-line unchanged. The offset uses
    # exactly the outer loft stations and angular samples. It opens naturally
    # into the actual extended and widened lower-side output slots.
    stations=[BAY_START]+[s[0] for s in ctx['body_dense'] if BAY_START<s[0]<BAY_END]+[BAY_END]
    verts=[ctx['fuselage_point'](y,k*2*math.pi/64,-BAY_RADIAL_THICKNESS) for y in stations for k in range(64)]
    faces=[]
    for j in range(len(stations)-1):
        for k in range(64):n=(k+1)%64;faces.append((j*64+k,j*64+n,(j+1)*64+n,(j+1)*64+k))
    faces += [tuple(range(63,-1,-1)),tuple((len(stations)-1)*64+k for k in range(64))]
    chamber=mesh('Temporary_V19_drive_chamber',verts,faces,None,smooth=True)
    bm=bmesh.new();bm.from_mesh(chamber.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(chamber.data);bm.free();chamber.data.update()
    if 'triangulate_slot_input'in ctx:ctx['triangulate_slot_input'](chamber)
    bm=bmesh.new();bm.from_mesh(body.data);before_volume=abs(bm.calc_volume(signed=True));bm.free()
    _boolean(body,chamber,'DIFFERENCE')
    bm=bmesh.new();bm.from_mesh(body.data);after_volume=abs(bm.calc_volume(signed=True));bm.free()
    if before_volume-after_volume<.02:raise ValueError('V19 cavity Boolean did not remove a real finite volume: '+str((before_volume,after_volume)))
    body['internalCavityVersion']=22;body['internalCavityRadialOffset']=BAY_RADIAL_THICKNESS
    body['internalCavityBlenderY']=[BAY_START,BAY_END]

    # 所有平移件继续共用同一滑架；低鞍座与单直件不增加运动自由度。
    slider_z=ctx['SLIDER_Z']
    beam_z=CROSSBEAM_Z-slider_z;saddle_z=OUTPUT_SADDLE_Z-slider_z
    guide_bridge_z=GUIDE_BRIDGE_Z-slider_z;guide_bush_z=GUIDE_AXIS_Z-slider_z
    beam=cyl('Crossbeam',(-.12,NUT_OFFSET_Y,beam_z),(.12,NUT_OFFSET_Y,beam_z),.007,carbon,spreader,'低位同步横梁')
    for side,sign in [('L',-1),('R',1)]:
        fixed(beam,'BraceBodyCarriage_'+side,(sign*.12-.0071,-.0161,beam_z-.0071),(sign*.12+.0071,-.0019,beam_z+.0071),'BraceSpreader','横梁端与单根直斜件的有限固定搭接')
    web=block('OutputWeb',(0,NUT_OFFSET_Y,saddle_z),OUTPUT_SADDLE_SIZE,metal,spreader,'螺母下方低鞍座，避开丝杠与中心通孔')
    fixed(beam,web,(-.0131,-.0161,max(beam_z-.007,saddle_z-.007)-.0001),(.0131,-.0019,min(beam_z+.007,saddle_z+.007)+.0001),'BraceSpreader','低鞍座落在横梁实体上')
    nut_z=SCREW_Z-slider_z
    nut=ann('NutCarriage',(0,NUT_OFFSET_Y,nut_z),.025,.012,.058,metal,spreader,'带真实通孔的平移螺母')
    fixed(web,nut,(-.0131,-.0241,nut_z-.0251),(.0131,.0061,saddle_z+.0071),'BraceSpreader','低鞍座只搭接螺母孔下方的外壁')
    fixed(beam,nut,(-.0251,-.0161,nut_z-.0251),(.0251,-.0019,beam_z+.0071),'BraceSpreader','横梁在螺母底部外壁形成有限直接支承，不穿中心孔')
    for side,sign in [('L',-1),('R',1)]:
        arm=block('GuideBridge_'+side,(sign*.030,NUT_OFFSET_Y,guide_bridge_z),(.050,.032,.009),metal,spreader,'低位导套安装桥')
        sleeve=ann('GuideBushing_'+side,(sign*.045,NUT_OFFSET_Y,guide_bush_z),.014,.0089,.048,carbon,spreader,'与下移导轨同轴的真实有孔导套')
        xmin,xmax=(.0049,.0131)if sign>0 else(-.0131,-.0049)
        fixed(arm,web,(xmin,-.0241,max(guide_bridge_z-.0045,saddle_z-.007)-.0001),(xmax,.0061,min(guide_bridge_z+.0045,saddle_z+.007)+.0001),'BraceSpreader','导套安装桥固定在低鞍座侧部')
        fixed(arm,sleeve,(sign*.045-.0141,-.0251,guide_bush_z-.0142),(sign*.045+.0141,.0071,guide_bridge_z+.0047),'BraceSpreader','导套安装桥仅接外壁下缘，通孔不被堵塞')
        fixed(beam,arm,(sign*.030-.0251,-.0161,guide_bridge_z-.0046),(sign*.030+.0251,-.0019,guide_bridge_z+.0046),'BraceSpreader','低位安装桥与同步横梁直接固定')
        fixed(beam,sleeve,(sign*.045-.0141,-.0161,guide_bush_z-.0141),(sign*.045+.0141,-.0019,beam_z+.0071),'BraceSpreader','同步横梁搭接导套下部外壁，保留孔下方正间隙')

    # Coaxial drive spindle and motor shafts rotate independently of the fixed
    # housings. The nut has no angular DOF and is carried on two fixed rails.
    screw=track(empty('Drive_ScrewRotor',(0,0,SCREW_Z)),'rotating lead-screw shaft')
    motor=track(empty('Drive_MotorRotor',(0,0,SCREW_Z)),'motor rotor before illustrative reduction')
    for obj,ratio in [(screw,1.),(motor,REDUCTION_RATIO)]:
        obj.rotation_mode='XYZ';obj['driveAxis']=[0,0,-1];obj['screwLead']=LEAD;obj['phaseRatio']=ratio
        obj['phaseSign']=-1;obj['sliderRestY']=ctx['slider_at'](0);obj['driveInputNode']='BraceSpreader'
    shaft=cyl('LeadScrewCore',(0,.600,0),(0,1.998,0),.008,metal,screw,'rotating screw root',bevel=.0004)
    def thread(name,parent,y0,y1,z,inner,outer,phase,halfroot,halfcrest):
        steps=math.ceil((y1-y0)/LEAD*24);v=[];f=[]
        profile=[(inner,-halfroot),(outer,-halfcrest),(outer,halfcrest),(inner,halfroot)]
        for i in range(steps+1):
            y=y0+(y1-y0)*i/steps;a=2*math.pi*(y-SCREW_THREAD_START)/LEAD+phase
            for r,dy in profile:v.append((r*math.sin(a),y+dy,z+r*math.cos(a)))
        for i in range(steps):
            for k in range(4):n=(k+1)%4;f.append((i*4+k,i*4+n,(i+1)*4+n,(i+1)*4+k))
        f += [(3,2,1,0),tuple(steps*4+k for k in range(4))]
        return track(mesh('Drive_'+name,v,f,metal,parent,smooth=False),'original trapezoidal concept thread, not a manufacturing profile')
    male=thread('LeadScrewThread',screw,SCREW_THREAD_START,SCREW_THREAD_END,0,.0075,.0105,0,.0038,.0015)
    fixed(shaft,male,(-.0081,SCREW_THREAD_START-.0041,-.0081),(.0081,SCREW_THREAD_END+.0041,.0081),'Drive_ScrewRotor','same rotating rigid shaft, thread roots overlap core')
    phase=2*math.pi*ctx['slider_at'](0)/LEAD+math.pi
    female=thread('NutInternalThread',spreader,NUT_OFFSET_Y-.022,NUT_OFFSET_Y+.022,nut_z,.0092,.0128,phase,.0038,.0015)
    fixed(nut,female,(-.013,-.035,nut_z-.013),(.013,.017,nut_z+.013),'BraceSpreader','female thread outer root fixed into bored nut wall')
    coupling=ann('OutputCoupling',(0,0.657,0),.016,.0078,.024,metal,screw,'output coupling after reduction')
    fixed(coupling,shaft,(-.0081,0.6448,-.0081),(.0081,0.6692,.0081),'Drive_ScrewRotor')
    # A colored witness, solidly attached to the rotating coupling, makes spin
    # visible without strobing decorative arrows or changing the rotation rate.
    witness=cyl('CouplingWitness',(.014,0.645,0),(.014,0.669,0),.002,carbon,screw,'rotation witness',bevel=.0002)
    fixed(witness,coupling,(.0119,0.6448,-.0021),(.0161,0.6692,.0021),'Drive_ScrewRotor')
    rotor=cyl('MotorShaft',(0,0.361,0),(0,0.591,0),.008,metal,motor,'motor shaft',bevel=.0004)
    motor_disc=cyl('MotorRotorDisc',(0,0.362,0),(0,0.378,0),.030,carbon,motor,'visible motor end rotor',bevel=.0006)
    fixed(rotor,motor_disc,(-.0081,0.3618,-.0081),(.0081,0.3782,.0081),'Drive_MotorRotor')
    mark=cyl('MotorWitness',(.025,0.36,0),(.025,0.379,0),.002,metal,motor,'motor rotor witness',bevel=.0002)
    fixed(mark,motor_disc,(.0229,0.3618,-.0021),(.0271,0.3782,.0021),'Drive_MotorRotor')
    motor_h=ann('MotorHousing',(0,0.45,SCREW_Z),.039,.033,.138,carbon,role='fixed brushless motor housing; internals simplified')
    gearbox=ann('ReductionHousing',(0,0.588,SCREW_Z),.037,.030,.112,metal,role='fixed planetary reduction housing; removable in internal inspection')
    adapter=ann('MotorGearboxAdapter',(0,0.526,SCREW_Z),.039,.009,.016,metal)
    fixed(motor_h,adapter,(-.0391,0.518-.0001,SCREW_Z-.0391),(.0391,0.519+.0001,SCREW_Z+.0391))
    fixed(gearbox,adapter,(-.0371,0.5318,SCREW_Z-.0371),(.0371,0.5342,SCREW_Z+.0371))
    # Visible same-axis planetary reduction: 12-tooth sun, 24-tooth fixed
    # internal ring, three 6-tooth planets. Tooth profiles intentionally use
    # generous backlash, not an involute manufacturing definition.
    def gear(name,parent,teeth,pitch,inner=False,phase=0):
        points=[]
        for tooth in range(teeth):
            for f,rr in [(-.5,pitch+(.0008 if inner else -.0008)),(-.28,pitch+(.0008 if inner else -.0008)),(-.12,pitch+(-.00065 if inner else .00065)),(.12,pitch+(-.00065 if inner else .00065)),(.28,pitch+(.0008 if inner else -.0008))]:
                a=phase+(tooth+f)*2*math.pi/teeth
                points.append((a,rr))
        n=len(points);v=[]
        for y,outside in [(0.573,True),(0.597,True),(0.573,False),(0.597,False)]:
            for a,r in points:
                radius=(.0304 if inner else r) if outside else (r if inner else (.0077 if teeth==12 else .0018))
                v.append((radius*math.cos(a),y,radius*math.sin(a)))
        f=[]
        for i in range(n):
            j=(i+1)%n;f.extend([(i,j,n+j,n+i),(2*n+j,2*n+i,3*n+i,3*n+j),(j,i,2*n+i,2*n+j),(n+i,n+j,3*n+j,3*n+i)])
        obj=track(mesh('Drive_'+name,v,f,metal,parent,smooth=False),'simplified clearance tooth profile, not machining geometry')
        obj['teeth']=teeth;obj['pitchRadius']=pitch;obj['internalGear']=inner
        return obj
    sun=gear('SunGear',motor,12,.010)
    fixed(sun,rotor,(-.0081,0.5729,-.0081),(.0081,0.5911,.0081),'Drive_MotorRotor','sun gear hub press-fit to motor shaft')
    fixed_ring=gear('RingGear',None,24,.020,True)
    fixed_ring.location.z=SCREW_Z
    fixed(fixed_ring,gearbox,(-.0305,0.5729,SCREW_Z-.0305),(.0305,0.5971,SCREW_Z+.0305),reason='fixed outer ring-gear rim seated in fixed gearbox housing')
    carrier=cyl('PlanetCarrier',(0,0.607,0),(0,0.616,0),.025,carbon,screw,'planet carrier rigidly connected to screw output',bevel=.0005)
    fixed(carrier,shaft,(-.0081,0.6069,-.0081),(.0081,0.6161,.0081),'Drive_ScrewRotor')
    for i in range(3):
        a=2*math.pi*i/3;x=.015*math.cos(a);z=.015*math.sin(a)
        planet=track(empty('Drive_PlanetRotor_'+str(i),(x,0,z),screw),'planet rotation relative to carrier')
        planet.rotation_mode='XYZ';planet['driveAxis']=[0,0,-1];planet['screwLead']=LEAD;planet['phaseRatio']=-4.;planet['phaseSign']=-1;planet['driveInputNode']='BraceSpreader'
        gear('PlanetGear_'+str(i),planet,6,.005,phase=math.pi/6)
        pin=cyl('PlanetPin_'+str(i),(x,0.568,z),(x,0.615,z),.0015,metal,screw,'planet bearing pin fixed to output carrier',bevel=.00015)
        fixed(pin,carrier,(x-.0016,0.6069,z-.0016),(x+.0016,0.6151,z+.0016),'Drive_ScrewRotor')
        for label,y in [('Front',0.57),('Rear',0.6)]:
            washer=ann('PlanetRetainer_'+str(i)+'_'+label,(x,y,z),.003,.0014,.002,metal,screw,'planet axial retainer, clear of spinning gear')
            fixed(washer,pin,(x-.0016,y-.0011,z-.0016),(x+.0016,y+.0011,z+.0016),'Drive_ScrewRotor')
    # Axial clearance to motor shaft / output coupling, both bored housings.
    motor_mount=block('MotorMount',(0,0.45,MOTOR_MOUNT_Z),(.102,.078,.015),metal)
    for sign in (-1,1):
        saddle=block('MotorSaddle_'+('L' if sign<0 else 'R'),(sign*.034,0.45,MOTOR_SADDLE_Z),(.014,.050,.025),metal)
        fixed(saddle,motor_h,(sign*.034-.0071,0.4249,SCREW_Z-.0391),(sign*.034+.0071,0.4751,MOTOR_SADDLE_Z+.0126))
        fixed(saddle,motor_mount,(sign*.034-.0071,0.4249,MOTOR_SADDLE_Z-.0126),(sign*.034+.0071,0.4751,MOTOR_MOUNT_Z+.0076))

    # 下移后重新构建支座和真实贴底脚，不把旧支承脚整体平移进蒙皮。
    floor_mounts=[]
    for label,y in [('Front',FRONT_SUPPORT_Y),('Rear',1.982)]:
        base=cyl(label+'Support',(-.073,y,SUPPORT_FRAME_Z),(.073,y,SUPPORT_FRAME_Z),.007,metal)
        center=cyl(label+'ScrewPedestal',(0,y,SUPPORT_FRAME_Z),(0,y,SCREW_PEDESTAL_TOP_Z),.009,metal)
        fixed(base,center,(-.0091,y-.0091,SUPPORT_FRAME_Z-.0001),(.0091,y+.0091,SUPPORT_FRAME_Z+.0071))
        bearing=ann(label+'ScrewBearing',(0,y,SCREW_Z),.022,.0088,.025,metal)
        fixed(center,bearing,(-.0091,y-.0091,SCREW_Z-.0222),(.0091,y+.0091,SCREW_PEDESTAL_TOP_Z+.0002))
        for side,sign in [('L',-1),('R',1)]:
            p=cyl(label+'GuidePedestal_'+side,(sign*.045,y,SUPPORT_FRAME_Z),(sign*.045,y,GUIDE_PEDESTAL_TOP_Z),.007,metal)
            r=ann(label+'GuideSeat_'+side,(sign*.045,y,GUIDE_AXIS_Z),.016,.0083,.023,metal)
            fixed(base,p,(sign*.045-.0071,y-.0071,SUPPORT_FRAME_Z-.0001),(sign*.045+.0071,y+.0071,SUPPORT_FRAME_Z+.0071))
            fixed(p,r,(sign*.045-.0071,y-.0071,GUIDE_AXIS_Z-.0162),(sign*.045+.0071,y+.0071,GUIDE_PEDESTAL_TOP_Z+.0002))
            fixed(base,r,(sign*.045-.0161,y-.0071,GUIDE_AXIS_Z-.0162),(sign*.045+.0161,y+.0071,SUPPORT_FRAME_Z+.0072),reason='低置导轨座下部外壁落在横座上，实际孔下方保持正净空')
            floor_mounts.append((label+'Foot_'+side,sign*.064,y,base,SUPPORT_FOOT_TOP_Z,SUPPORT_FRAME_Z-.0072))
    for side,sign in [('L',-1),('R',1)]:
        rail=cyl('GuideRail_'+side,(sign*.045,GUIDE_START,GUIDE_AXIS_Z),(sign*.045,1.992,GUIDE_AXIS_Z),.0085,metal,role='低置固定导轨，与移动导套同轴',bevel=.0003)
        for label,y in [('Front',FRONT_SUPPORT_Y),('Rear',1.982)]:
            fixed(rail,'Drive_'+label+'GuideSeat_'+side,(sign*.045-.0086,y-.0116,GUIDE_AXIS_Z-.0086),(sign*.045+.0086,y+.0116,GUIDE_AXIS_Z+.0086),reason='固定导轨在有孔支座中的有限压配区域')
    for side,sign in [('L',-1),('R',1)]:floor_mounts.append(('MotorFoot_'+side,sign*.038,.450,motor_mount,MOTOR_FOOT_TOP_Z,MOTOR_MOUNT_Z-.0077))
    bpy.context.view_layer.update()
    for name,x,y,support,foot_top,seat_bottom in floor_mounts:
        hit,point,normal,index=body.ray_cast(Vector((x,y,.080)),Vector((0,0,-1)))
        if not hit:raise ValueError('驱动安装脚未命中真实内舱底板：'+name)
        bottom_points=[];surfaces=[]
        for i in range(24):
            a=2*math.pi*i/24;px=x+.007*math.cos(a);py=y+.007*math.sin(a)
            hit,p,n,index=body.ray_cast(Vector((px,py,.080)),Vector((0,0,-1)))
            if not hit:raise ValueError('驱动脚完整足迹离开真实底板：'+name)
            bottom_points.append((px,py,p.z-.0006));surfaces.append(p.z)
        if foot_top-max(surfaces)<=.003:raise ValueError('低置支承脚缺少有限正高度：'+name)
        fv=bottom_points+[(p[0],p[1],foot_top)for p in bottom_points]
        ff=[(i,(i+1)%24,(i+1)%24+24,i+24)for i in range(24)]+[tuple(range(23,-1,-1)),tuple(range(24,48))]
        foot=track(mesh('Drive_'+name,fv,ff,metal,smooth=False),'按真实内底板贴合的低置有限支承脚')
        fixed(foot,body,(x-.0072,y-.0072,min(surfaces)-.0008),(x+.0072,y+.0072,max(surfaces)+.0003),reason='足迹随原内底板曲面，材料嵌入量仍为.0006')
        fixed(foot,support,(x-.0072,y-.0072,seat_bottom),(x+.0072,y+.0072,foot_top+.0002),reason='支承脚上部与低置固定座有限搭接')
    # End stops remain clear of the normal stroke; represent mechanical limits.
    # V22红点球心要求约.91—1.90行程；真实前支承、导轨、螺纹和电机已重排。
    # 前限位环按真实导套前端重置，保持0.004轴向净空。
    front_stop=ctx['slider_at'](0)+NUT_OFFSET_Y-.024-.004-.004
    if front_stop-.004<FRONT_SUPPORT_Y+.0115:raise ValueError('前限位环与原导轨支座没有足够空间')
    for label,y in [('Front',front_stop),('Rear',1.947)]:
        for side,sign in [('L',-1),('R',1)]:
            stop=ann(label+'TravelStop_'+side,(sign*.045,y,GUIDE_AXIS_Z),.013,.0083,.008,carbon)
            fixed(stop,'Drive_GuideRail_'+side,(sign*.045-.0086,y-.0041,GUIDE_AXIS_Z-.0086),(sign*.045+.0086,y+.0041,GUIDE_AXIS_Z+.0086),reason='fixed guide-rail stop collar')
    return {'version':22,'conceptOnly':True,'nodePrefix':'Drive_','crossbeamNode':'Drive_Crossbeam','sliderNode':'BraceSpreader','screwNode':'Drive_ScrewRotor','motorNode':'Drive_MotorRotor','screwLead':LEAD,'reductionRatio':REDUCTION_RATIO,'phaseSign':-1,'axis':[0,0,-1],'sliderOffsetY':NUT_OFFSET_Y,'screwAxisHeightBlender':SCREW_Z,'loweredLayout':{'conceptOnly':True,'axisZ':SCREW_Z,'guideAxisZ':GUIDE_AXIS_Z,'crossbeamZ':CROSSBEAM_Z,'saddleZ':OUTPUT_SADDLE_Z,'saddleSize':list(OUTPUT_SADDLE_SIZE),'frameZ':SUPPORT_FRAME_Z,'bodyBallAndWingTrajectoryUnchanged':False,'output':'每侧单根直斜件连接原球销，左右继续共用同一滑架'},'stroke':[ctx['slider_at'](0),ctx['slider_at'](1)],'travelStopCentersBlenderY':[front_stop,1.947],'layoutV22':{'motorAssemblyTranslationBlender':[0,MOTOR_LAYOUT_SHIFT,0],'frontSupportY':FRONT_SUPPORT_Y,'guideSpan':[GUIDE_START,1.992],'screwCoreSpan':[.600,1.998],'screwThreadSpan':[SCREW_THREAD_START,SCREW_THREAD_END],'reason':'低置固定布局保留；实际新翼侧球心与定长杆闭合重新决定滑架行程，不使用伸缩杆或虚假球心'},'planetaryReduction':{'sunTeeth':12,'ringTeeth':24,'planetTeeth':6,'planetCount':3,'fixedRingNode':'Drive_RingGear','carrierNode':'Drive_ScrewRotor','sunNode':'Drive_MotorRotor','planetNodes':['Drive_PlanetRotor_'+str(i) for i in range(3)],'planetRelativeRatio':-4.,'gearRatio':3.,'toothProfile':'simplified clearance trapezoid, not manufacturing involute','pitchRadii':[.010,.020,.005],'orbitRadius':.015},'newNodes':new,'fixedAttachmentInterfaces':add_contact_radial_bounds(contacts,ctx['SLIDER_Z']),'movingClearances':{'guideRailRadius':.0085,'guideBoreRadius':.0089,'screwCoreRadius':.008,'supportBoreRadius':.0088,'maleThreadMajorRadius':.0105,'femaleThreadMinorRadius':.0092,'lead':LEAD,'maleFemalePhaseOffsetRadians':math.pi,'threadAxialHalfRootWidth':.0038},'cavity':{'host':'Fuselage','operation':'actual Boolean DIFFERENCE, finite hollow rear bay','blenderYRange':[BAY_START,BAY_END],'radialOffset':BAY_RADIAL_THICKNESS,'radialSamples':64,'blenderStations':stations,'materialVolumeBefore':before_volume,'materialVolumeAfter':after_volume,'removedVolume':before_volume-after_volume,'outerMoldLinePreserved':True,'existingSideSlotsPreserved':False,'actualOutputSlotEnvelope':{'centerX':ctx['SLOT_CENTER_X'],'width':ctx['SLOT_WIDTH'],'bottomZ':ctx['SLOT_BOTTOM_Z'],'topZ':ctx['SLOT_TOP_Z'],'stroke':[ctx['slot_min'],ctx['slot_max']],'actualRoundedOutlineRightXY':ctx['SLOT_OUTLINE']}},'sourceBoundary':'UAFM describes brushless motor, reduction gearbox, lead screw and shuttle; particular layout, guide count, dimensions, thread profile and ratio are original conceptual visualization. Planetary gearing is an original illustrative implementation; loads, tolerances and manufacturing selection are not established.'}


def update_internal_drive():
    if 'Drive_ScrewRotor' not in bpy.data.objects:return
    from mathutils import Quaternion
    from kinematics import slider_at
    displacement=bpy.data.objects['BraceSpreader'].location.y-slider_at(0)
    for name,ratio in [('Drive_ScrewRotor',1.),('Drive_MotorRotor',REDUCTION_RATIO)]+[('Drive_PlanetRotor_'+str(i),-4.) for i in range(3)]:
        o=bpy.data.objects[name];o.rotation_mode='QUATERNION'
        o.rotation_quaternion=Quaternion((0,1,0),math.remainder(-2*math.pi*displacement/LEAD*ratio,2*math.pi))
