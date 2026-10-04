"""V15演示旋向与叶片几何同源；尺寸/扭转为原创可视化参数，不是原厂数据。"""
import bpy, math
from propeller_shape import _erase, _boolean, _clean, HINGE_RADIUS, BORE_RADIUS, ROTOR_RADIUS

# 只定义演示中的两种手性；不从四旋翼惯例推断实际P4电机旋向。
SPIN_SIGNS={'L_Front':-1,'R_Front':1,'L_Rear':1,'R_Rear':-1}
CONVENTION='从MotorAxisEnd正端沿轴看向MotorAxisStart：+1为CCW逆时针，-1为CW顺时针；仅演示旋向'
TIP_X=math.sqrt(ROTOR_RADIUS**2-.149**2)-HINGE_RADIUS
# 距铰点展長、后掠量、弦长、弦向安装角、相对厚度；中心线始终在桨盘内。
STATIONS=[(.002,0,.055,6.,.10),(.080,.014,.098,14.,.095),(.240,.057,.123,10.,.075),(.395,.100,.108,7.5,.065),(.515,.129,.058,6.5,.060),(TIP_X,.140,.018,6.,.060)]

def _slopes(column):
    # 单调三次Hermite插值：峰值处导数归零，各段不产生过冲。
    h=[b[0]-a[0] for a,b in zip(STATIONS,STATIONS[1:])]
    d=[(b[column]-a[column])/step for a,b,step in zip(STATIONS,STATIONS[1:],h)]
    m=[d[0]]
    for i in range(1,len(STATIONS)-1):
        if d[i-1]*d[i]<=0:m.append(0.)
        else:
            w1=2*h[i]+h[i-1];w2=h[i]+2*h[i-1]
            m.append((w1+w2)/(w1/d[i-1]+w2/d[i]))
    m.append(d[-1]);return m

SLOPES={i:_slopes(i) for i in range(1,5)}

def _station(x):
    for k,(a,b) in enumerate(zip(STATIONS,STATIONS[1:])):
        if a[0]-1e-8<=x<=b[0]+1e-8:
            h=b[0]-a[0];u=max(0.,min(1.,(x-a[0])/h))
            return (x,)+tuple((2*u**3-3*u**2+1)*a[i]+(u**3-2*u**2+u)*h*SLOPES[i][k]+(-2*u**3+3*u**2)*b[i]+(u**3-u**2)*h*SLOPES[i][k+1] for i in range(1,5))
    return STATIONS[0] if x<STATIONS[0][0] else STATIONS[-1]

def _blade(ctx,name,parent,spin):
    # 构造正旋向母叶：B叶径向+X，速度+Y，圆前缘位于弦向+Y。
    # 负旋向仅反射切向Y并重算法线，轴向Z及真实轴套不变，保持同一+轴螺距。
    # A叶随后绕Z旋转180°，绝不通过反射展向来颠倒第二叶的螺距。
    # 六个约束截面间采用三等分保形采样，减轻原直段的肩部折线。
    dense=[]
    for a,b in zip(STATIONS,STATIONS[1:]):
        for k in range(3):dense.append(_station(a[0]+(b[0]-a[0])*k/3))
    dense.append(STATIONS[-1])
    sections=[(x,-sweep-chord/2,chord,0,ratio) for x,sweep,chord,pitch,ratio in dense]
    blade=ctx['wing'](name,sections,ctx['carbon'],parent)
    for v in blade.data.vertices:
        x,sweep,chord,pitch,ratio=_station(v.co.x)
        center=-sweep;dy=-(v.co.y-center);z=v.co.z;angle=math.radians(pitch)
        v.co.y=spin*(center+dy*math.cos(angle)-z*math.sin(angle))
        v.co.z=dy*math.sin(angle)+z*math.cos(angle)
    _clean(blade)
    sleeve=ctx['ring_axis']('Temporary_v15_blade_sleeve',(0,0,0),(0,1,0),.022,BORE_RADIUS,.058,ctx['carbon'],parent)
    _boolean(blade,sleeve,'UNION')
    bore=ctx['cylinder_between']('Temporary_v15_root_bore',(0,-.09,0),(0,.09,0),BORE_RADIUS,ctx['metal'],parent,vertices=36,bevel_width=0)
    _boolean(blade,bore,'DIFFERENCE');_clean(blade)
    return blade

def build_rotor_handedness(ctx):
    changed=[]
    for key,spin in SPIN_SIGNS.items():
        motor=bpy.data.objects['Prop_'+key]
        motor['rotorContractVersion']=15;motor['spinSign']=spin
        motor['spinDirection']='CCW' if spin>0 else 'CW'
        motor['spinConvention']=CONVENTION
        motor['handedness']=spin
        motor['directionIsIllustrative']=True
        motor['bladePitchAxis']='MotorAxisStart→MotorAxisEnd正轴；几何螺距，不代表已验证气动力'
        for letter in ('A','B'):_erase('Blade_'+key+'_'+letter)
        master=_blade(ctx,'Blade_'+key+'_B',bpy.data.objects['BladeFold_'+key+'_B'],spin)
        other=master.copy();other.data=master.data.copy();other.name='Blade_'+key+'_A'
        other.parent=bpy.data.objects['BladeFold_'+key+'_A'];bpy.context.collection.objects.link(other)
        for v in other.data.vertices:v.co.x*=-1;v.co.y*=-1
        other.data.update()
        for blade in (master,other):
            blade['geometryHandedness']=spin;blade['geometryIsIllustrative']=True
            changed.append(blade.name)
    return {'version':15,'directionIsIllustrative':True,'spinSigns':SPIN_SIGNS,'spinConvention':CONVENTION,'positiveThrustAxis':'MotorAxisStart→MotorAxisEnd；仅几何螺距方向，未做气动力或飞控验证','interpolation':'保形单调三次Hermite，六个约束截面间三等分；不在极值处过冲','radialSections':[{'spanFromHinge':x,'sweep':s,'chord':c,'pitchDegrees':p,'thicknessRatio':r} for x,s,c,p,r in STATIONS],'hingeRadius':HINGE_RADIUS,'maxRotorRadius':ROTOR_RADIUS,'rootHoleAndForkPreserved':True,'twoBladesRelatedBy180DegreeRotation':True,'bladeCenterlinePlanar':True,'changedMeshNodes':changed,'evidenceBoundary':'原参考支持薄桨、短根和向舱后收折；具体四旋向、叶型和径向扭转未获原厂确认。'}
