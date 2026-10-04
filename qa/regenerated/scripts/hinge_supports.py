"""V21 真正闭合的主轴外座与舱盖小铰节；不是原厂承载或制造设计。

保留所有既有运动轴和开合范围。支承以实际壳面采样形成有限贴合，
销—动铰耳继续有真实孔隙，不用填满旋转间隙来满足连接图。
"""
import math
import bpy
import bmesh
from mathutils import Vector


def _closed(obj):
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    assert all(e.is_manifold for e in bm.edges),obj.name
    assert all(f.calc_area()>1e-18 for f in bm.faces),obj.name
    assert abs(bm.calc_volume(signed=True))>1e-10,obj.name
    bm.to_mesh(obj.data);bm.free();obj.data.update()
    obj.data.set_sharp_from_angle(angle=math.radians(42))


def build_hinge_supports(ctx):
    contacts=[];new=[];pairs=[]
    ring=ctx['ring_axis'];cylinder=ctx['cylinder_between'];mesh=ctx['mesh_object'];metal=ctx['metal']
    def track(obj,role):
        _closed(obj);new.append(obj.name);obj['supportRevision']=21;obj['conceptOnly']=True;obj['supportRole']=role
        return obj
    def fixed(a,b,lo,hi,frame=None,reason='有限固定安装面'):
        gl=lambda p:[p[0],p[2],-p[1]]
        x,y=gl(lo),gl(hi)
        contacts.append({'pair':[a.name if hasattr(a,'name') else a,b.name if hasattr(b,'name') else b],
            'frame':frame,'min':[min(p,q) for p,q in zip(x,y)],'max':[max(p,q) for p,q in zip(x,y)],'reason':reason,'type':'fixed'})
    # 两个静态轴承外圈由紧凑同轴外座连接。套筒位于已有活动回转套孔内，
    # 不增加外部斜架，不改变主斜轴、轴承位置或活动翼的自由度。
    for side,sign in [('L',-1),('R',1)]:
        axis=ctx['wing_axis'](sign);origin=ctx['pivot_position'](sign)
        sleeve=track(ring('RootBearingHousing_'+side,origin+axis*.005,axis,.0277,.0258,.132,metal), '两固定主轴承外圈之间的同轴薄壁座')
        for end,t in [('Front',-.050),('Rear',.060)]:
            for kind,radius in [('Fixed',.028),('Seal',.026)]:
                other='RootBearing'+kind+'_'+side+'_'+end
                c=origin+axis*t
                fixed(sleeve,other,c-Vector((.043,.043,.043)),c+Vector((.043,.043,.043)),reason='外圈与同轴轴承座的有限径向接合')
                contacts[-1]['cylinder']={'center':ctx['gltf_vector'](origin),'axis':ctx['gltf_vector'](axis),'range':[max(-.061,t-(.011 if kind=='Fixed' else .013)),min(.071,t+(.011 if kind=='Fixed' else .013))],'minimumRadius':.0257,'radius':min(.0278,radius+.0001)}
        # 原后轴承短支座也可在同一后端环带接入新外座；范围仅限
        # 后轴承安装区，不将整组运动零件当作碰撞豁免。
        c=origin+axis*.060
        fixed(sleeve,'RootFixedBearingPedestal_'+side,c-Vector((.045,.045,.045)),c+Vector((.045,.045,.045)),reason='原后轴承短支座接入新固定外座的后端有限环带')
        contacts[-1]['cylinder']={'center':ctx['gltf_vector'](origin),'axis':ctx['gltf_vector'](axis),'range':[.028,.072],'minimumRadius':.0257,'radius':.0278}
    # 舱盖轴仍为原CargoHoodPivot。交错铰耳分别固连两片实际壳体，中央
    # 固定耳承接短销，两个活动耳绕销转动。不是以空父节点代替连接。
    pivot=bpy.data.objects['CargoHoodPivot'];origin=pivot.location.copy()
    hull=bpy.data.objects['Fuselage'];hood=bpy.data.objects['CargoHoodShell']
    def at(x,y,host):
        world=origin+Vector((x,y,-.04));inv=host.matrix_world.inverted()
        hit,p,n,index=host.ray_cast(inv@world,inv.to_3x3()@Vector((0,0,1)))
        if not hit:raise ValueError('舱盖铰叶安装点缺少真实壳面')
        p=host.matrix_world@p-origin
        if not -.01<p.z<.06:raise ValueError('舱盖铰叶射线未命中下部真实壳面')
        return p.z
    def leaf(name,cx,width,moving):
        host=hood if moving else hull;parent=pivot if moving else None
        ys=[-.040,-.030,-.020,-.006] if moving else [.006,.026,.037,.047]
        xs=[cx-width/2,cx,cx+width/2]
        vv=[]
        for layer in (0,1):
            for y in ys:
                for x in xs:
                    mounted=(moving and y<=-.020) or (not moving and y>=.037)
                    if mounted:
                        skin=at(x,y,host);z=skin+(.0006 if layer else -.003)
                    else:
                        z=(.006 if abs(y)<.01 else .004) if layer else -.004
                    p=Vector((x,y,z));vv.append(tuple(p if moving else p+origin))
        n=len(xs)*len(ys);ff=[]
        for j in range(len(ys)-1):
            for k in range(len(xs)-1):
                a=j*len(xs)+k;b=a+len(xs)
                ff.extend([(a,b,b+1,a+1),(n+a,n+a+1,n+b+1,n+b)])
        perimeter=[0,1,2,5,8,11,10,9,6,3]
        for a,b in zip(perimeter,perimeter[1:]+perimeter[:1]):ff.append((a,b,n+b,n+a))
        return mesh(name,vv,ff,metal,parent,False)
    def seat(name,cx,length,moving):
        parent=pivot if moving else None;center=Vector((cx,0,0))+(Vector() if moving else origin)
        obj=ring(name,center,(1,0,0),.010,.0051 if moving else .0044,length,metal,parent)
        piece=leaf('Temporary_V21_hinge_leaf',cx,length*.86,moving)
        bpy.context.view_layer.update();mod=obj.modifiers.new('短铰叶与空心铰耳实体相接','BOOLEAN');mod.operation='UNION';mod.solver='EXACT';mod.object=piece
        bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(piece,do_unlink=True)
        track(obj,'带真实销孔、按实际壳面贴合的短铰叶')
        host=hood if moving else hull
        lo=Vector((cx-length/2,-.041 if moving else .036,-.010));hi=Vector((cx+length/2,-.019 if moving else .048,.06))
        if not moving:lo+=origin;hi+=origin
        fixed(obj,host,lo,hi,pivot.name if moving else None,'仅铰叶末端按真实壳面埋入0.0006')
        return obj
    # 左侧腹部传感器占据原对称铰叶区。整套铰节仅沿同一横轴
    # 向右平移0.035，原轴线与开盖运动不变，避免移动/隐藏传感器。
    offset_x=.035;shaft_origin=origin+Vector((offset_x,0,0))
    fixed_seat=seat('CargoHingeFixedSeat',offset_x,.040,False)
    moving_seats=[seat('CargoHingeMovingSeat_'+side,cx,.024,True) for side,cx in [('L',offset_x-.037),('R',offset_x+.037)]]
    pin=track(cylinder('CargoHingePin',shaft_origin+Vector((-.055,0,0)),shaft_origin+Vector((.055,0,0)),.0045,metal,vertices=24,bevel_width=.0002),'保持原舱盖开合轴的固定短销')
    fixed(pin,fixed_seat,shaft_origin-Vector((.0201,.0046,.0046)),shaft_origin+Vector((.0201,.0046,.0046)),reason='中央固定铰耳孔的有限过盈配合')
    contacts[-1]['cylinder']={'center':ctx['gltf_vector'](shaft_origin),'axis':[1,0,0],'range':[-.0201,.0201],'minimumRadius':.0043,'radius':.0046}
    for side,x in [('L',offset_x-.055),('R',offset_x+.055)]:
        cap=track(cylinder('CargoHingeCap_'+side,origin+Vector((x-.0015,0,0)),origin+Vector((x+.0015,0,0)),.0065,metal,vertices=24,bevel_width=.0002),'销轴端部薄挡圈')
        fixed(cap,pin,origin+Vector((x-.0016,-.0066,-.0066)),origin+Vector((x+.0016,.0066,.0066)),reason='销轴端部有限挡圈接合')
    for obj in moving_seats:
        pairs.append({'moving':obj.name,'shaft':pin.name,'axisStart':'CargoHoodAxisStart','axisEnd':'CargoHoodAxisEnd','shaftRadius':.0045,'boreRadius':.0051,'nominalRadialClearance':.0006,'axialInterval':[offset_x-.049,offset_x-.025] if obj.name.endswith('_L') else [offset_x+.025,offset_x+.049], 'maximumAngleDegrees':55,'requiredChecks':'实孔径向/端面净空及0–55度全程；空父级不是支承证明'})
    return {'version':21,'conceptOnly':True,'newNodes':new,'fixedAttachmentInterfaces':contacts,'rotatingSupportInterfaces':pairs,'cargoHingeAxialOffset':offset_x,'preservedAxes':['WingPivot_L','WingPivot_R','CargoHoodPivot'],'sourceBoundary':'外观连接与运动可视化的原创短轴/轴座概念；不是原厂隐藏安装方式、材料、紧固、载荷或制造公差'}
