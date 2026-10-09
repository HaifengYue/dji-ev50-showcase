"""烘焙一个可独立播放的 glTF 倾转动作，无需网页专用驱动。
运行： blender -b assets/blender/xp4.blend --python scripts/export-transition.py
保留现有几何；这是理想化视觉机构，不是工程 CAD。
"""
import bpy, math, os, json, sys
from mathutils import Vector, Quaternion
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0,os.path.join(ROOT,'scripts'))
from kinematics import wing_rotation, update_linkage, hydrate_final_mechanism
hydrate_final_mechanism()
CLIP='TRANSWING_Hover_Cruise_Hover'

DRIVE_NAMES=['Drive_ScrewRotor','Drive_MotorRotor']+['Drive_PlanetRotor_'+str(i) for i in range(3)]
DRIVE_MAX_KEY_ANGLE=.70

def bake_drive_quaternions(end):
    """Bounded phase, dyadic source frames; unrelated tracks are untouched."""
    from internal_drive import LEAD, REDUCTION_RATIO
    from kinematics import slider_at
    slider=bpy.data.objects['BraceSpreader']
    fc=slider.animation_data.action.fcurves.find('location',index=1)
    knots=[tuple(k.co) for k in fc.keyframe_points]
    max_slope=max(abs((b[1]-a[1])/(b[0]-a[0])) for a,b in zip(knots,knots[1:]))
    divisions=4
    while max_slope*2*math.pi/LEAD*4/divisions>DRIVE_MAX_KEY_ANGLE:divisions*=2
    frames=sorted(set([i/divisions for i in range(end*divisions+1)]+[p[0] for p in knots]))
    positions=[fc.evaluate(f) for f in frames]
    for name,ratio in zip(DRIVE_NAMES,[1.,REDUCTION_RATIO,-4.,-4.,-4.]):
        obj=bpy.data.objects.get(name)
        if obj is None:continue
        obj.rotation_mode='QUATERNION';obj.animation_data_create()
        action=bpy.data.actions.new('V22 bounded phase '+name);obj.animation_data.action=action
        values=[];previous=None
        for position in positions:
            angle=math.remainder(-2*math.pi*(position-slider_at(0))/LEAD*ratio,2*math.pi)
            q=Quaternion((0,1,0),angle)
            if previous is not None and q.dot(previous)<0:q.negate()
            values.append(tuple(q));previous=q
        for component in range(4):
            curve=action.fcurves.new('rotation_quaternion',index=component)
            curve.keyframe_points.add(len(frames))
            curve.keyframe_points.foreach_set('co',[v for frame,q in zip(frames,values) for v in (frame,q[component])])
            for point in curve.keyframe_points:point.interpolation='LINEAR'
            # Sorted bulk keys intentionally skip FCurve.update(): Blender
            # de-duplicates sub-.01-frame keys there, losing high-speed phase.
    bpy.context.scene['driveSamplingV22']=json.dumps({'maximumKeyAngle':DRIVE_MAX_KEY_ANGLE,'dyadicSamplesPerFrame':divisions,'samples':len(frames),'boundedQuaternionPhase':True,'unrelatedTracksResampled':False})


def attach_native_drive_constraints():
    """Persistent local drivers evaluate the same single-DOF phase exactly.

    Blender FCurve short-key lookup and nlerp cannot guarantee subframe phase.
    Native sin/cos drivers depend only on the actual shared slider location;
    portable GLB has explicit phase-preserving quaternion keys instead.
    """
    from kinematics import slider_at
    from internal_drive import LEAD
    reference=slider_at(0)
    slider=bpy.data.objects['BraceSpreader']
    for name,ratio in zip(DRIVE_NAMES,[1.,3.,-4.,-4.,-4.]):
        o=bpy.data.objects.get(name)
        if o is None:continue
        o.rotation_mode='QUATERNION'
        for component in range(4):
            curve=o.driver_add('rotation_quaternion',component)
            driver=curve.driver;driver.type='SCRIPTED'
            for v in list(driver.variables):driver.variables.remove(v)
            variable=driver.variables.new();variable.name='slide';variable.type='SINGLE_PROP'
            variable.targets[0].id=slider;variable.targets[0].data_path='location[1]'
            angle=f'(-pi*(slide-({reference!r}))/({LEAD!r})*({ratio!r}))'
            driver.expression=('cos'+angle) if component==0 else (('sin'+angle) if component==2 else '0.0')
        o['nativePhaseConstraintV22']='quaternion sin/cos of the same evaluated BraceSpreader.location.y; no independent DOF'

def unfold_at(frame):
    frame+=1
    t=max(0,min(1,(frame-1)/79)) if frame<=80 else (1 if frame<=120 else max(0,min(1,(200-frame)/80)))
    return t*t*(3-2*t)

def bake_transition():
    s=bpy.context.scene
    s.frame_start=0;s.frame_end=199;s.render.fps=24
    names=['WingPivot_'+side for side in ('L','R')]+['BladeFold_'+side+'_Rear_'+leaf for side in ('L','R') for leaf in ('A','B')]+['BraceRod_'+side for side in ('L','R')]+['BraceSpreader']+[n for n in ('Drive_ScrewRotor','Drive_MotorRotor','Drive_PlanetRotor_0','Drive_PlanetRotor_1','Drive_PlanetRotor_2') if n in bpy.data.objects]
    for name in names:bpy.data.objects[name].animation_data_clear()
    reference=[]
    rod_previous={}
    lo,hi=0.0,1.0
    for _ in range(60):
        mid=(lo+hi)/2
        if mid*mid*(3-2*mid)<.85:lo=mid
        else:hi=mid
    threshold=(lo+hi)/2
    sample_frames=sorted([i/4 for i in range(797)]+[79*threshold,199-80*threshold])
    for frame in sample_frames:
        s.frame_set(int(frame),subframe=frame-int(frame));u=unfold_at(frame)
        for side,sign in [('L',-1),('R',1)]:
            p=bpy.data.objects['WingPivot_'+side]
            p.rotation_mode='QUATERNION';p.rotation_quaternion=wing_rotation(sign,u);p.keyframe_insert('rotation_quaternion',frame=frame)
            for leaf,fsign in [('A',-1),('B',1)]:
                p=bpy.data.objects['BladeFold_'+side+'_Rear_'+leaf];p.rotation_euler.y=fsign*math.pi/2*max(0,(u-.85)/.15);p.keyframe_insert('rotation_euler',frame=frame)
        update_linkage()
        bpy.data.objects['BraceSpreader'].keyframe_insert('location',frame=frame)
        for drive_name in ('Drive_ScrewRotor','Drive_MotorRotor','Drive_PlanetRotor_0','Drive_PlanetRotor_1','Drive_PlanetRotor_2'):
            if drive_name in bpy.data.objects:pass  # V22 independent bounded quaternion bake below
        for side in ('L','R'):
            p=bpy.data.objects['BraceRod_'+side]
            if side in rod_previous and p.rotation_quaternion.dot(rod_previous[side])<0:p.rotation_quaternion.negate()
            rod_previous[side]=p.rotation_quaternion.copy()
            for prop in ('location','rotation_quaternion','scale'):p.keyframe_insert(prop,frame=frame)
        bpy.context.view_layer.update()
        # 以 glTF 坐标记录源文件参考位置：(x,z,-y)。
        reference.append({'frame':frame,'time':frame/24,'unfold':u,'nodes':{name:{'position':[o.matrix_world.translation.x,o.matrix_world.translation.z,-o.matrix_world.translation.y]} for name in names+['Prop_'+side+'_'+end for side in ('L','R') for end in ('Front','Rear')] for o in [bpy.data.objects[name]]}})
    bake_drive_quaternions(199)
    for name in names:
        action=bpy.data.objects[name].animation_data.action
        for fc in action.fcurves:
            for key in fc.keyframe_points:key.interpolation='LINEAR'
    s.frame_set(0);bpy.context.view_layer.update()
    s['transition_clip']=CLIP;s['transition_note']='第0–79帧由悬停转巡航，79–119帧保持巡航，119–199帧返回悬停。理想化视觉机构。'
    os.makedirs(os.path.join(ROOT,'assets/animation'),exist_ok=True)
    json.dump(reference,open(os.path.join(ROOT,'assets/animation/wing-transition-reference.json'),'w'),indent=2)

def export_transition(path):
    bpy.context.scene.frame_set(0);bpy.context.view_layer.update();bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',use_selection=True,export_yup=True,export_extras=True,export_animations=True,export_animation_mode='ACTIVE_ACTIONS',export_nla_strips_merged_animation_name=CLIP,export_frame_range=True,export_frame_step=1,export_force_sampling=False,export_optimize_animation_size=False,export_anim_slide_to_zero=True,export_cameras=False,export_lights=False)


# V14 保留机构回归动作，并增加四动力完整启停动作。
# 导出时按稳定节点名合并动作访问器，不复制第二套网格或运行时假动画。
MOTOR_CLIP='TRANSWING_Motors_Start_Stop'
MOTOR_END=168
_BASE_BAKE=bake_transition
_BASE_EXPORT=export_transition


def _attach_actions(clip):
    for obj in bpy.data.objects:
        if not obj.animation_data or not obj.animation_data.action:continue
        action=obj.animation_data.action;action.name=clip+'__'+obj.name;action.use_fake_user=True
        action['clip']=clip;action['target']=obj.name
        track=obj.animation_data.nla_tracks.new();track.name=clip;track.mute=True
        strip=track.strips.new(clip,0,action);strip.extrapolation='NOTHING'
        obj.animation_data.action=None


def motor_state(frame):
    def eased(x):
        x=max(0.,min(1.,x));return x*x*(3-2*x)
    if frame<12:fold=1.
    elif frame<36:fold=1-eased((frame-12)/24)
    elif frame<132:fold=0.
    elif frame<156:fold=eased((frame-132)/24)
    else:fold=1.
    # 一秒平顺加速，一秒半匀速，一秒减速；速度单位仅为演示弧度/秒。
    if frame<=36:phase=0.;speed=0.
    elif frame<60:
        x=(frame-36)/24;phase=12*(x**3-.5*x**4);speed=12*eased(x)
    elif frame<96:phase=6+12*(frame-60)/24;speed=12.
    elif frame<120:
        x=(frame-96)/24;phase=24+12*(x-x**3+.5*x**4);speed=12*(1-eased(x))
    elif frame<132:
        x=(frame-120)/12;phase=30+(10*math.pi-30)*eased(x);speed=(10*math.pi-30)*6*x*(1-x)*2
    else:phase=10*math.pi;speed=0.
    return fold,phase,speed


def select_clip(clip=CLIP):
    """在 Blender 文本编辑器调用以切换完整动作；静态中立基准始终展开。"""
    for obj in bpy.data.objects:
        if obj.animation_data:
            for track in obj.animation_data.nla_tracks:track.mute=True
            obj.animation_data.action=None
    for side,sign in [('L',-1),('R',1)]:
        p=bpy.data.objects['WingPivot_'+side];p.rotation_mode='QUATERNION';p.rotation_quaternion=wing_rotation(sign,0)
        for end in ('Front','Rear'):
            p=bpy.data.objects['Prop_'+side+'_'+end];p.rotation_mode='QUATERNION';p.rotation_quaternion=Quaternion((1,0,0),math.pi/2)
            for leaf in ('A','B'):
                p=bpy.data.objects['BladeFold_'+side+'_'+end+'_'+leaf];p.rotation_mode='XYZ';p.rotation_euler=(0,0,0)
    update_linkage()
    for obj in bpy.data.objects:
        action=bpy.data.actions.get(clip+'__'+obj.name)
        if action:obj.animation_data_create();obj.animation_data.action=action
    s=bpy.context.scene;s.frame_start=0;s.frame_end=199 if clip==CLIP else MOTOR_END;s.frame_set(0);bpy.context.view_layer.update()
    s['active_demo_clip']=clip


def bake_transition():
    _BASE_BAKE();_attach_actions(CLIP)
    for obj in bpy.data.objects:
        if obj.animation_data:obj.animation_data.action=None
    names=['WingPivot_'+side for side in ('L','R')]+['BladeFold_'+side+'_'+end+'_'+leaf for side in ('L','R') for end in ('Front','Rear') for leaf in ('A','B')]+['Prop_'+side+'_'+end for side in ('L','R') for end in ('Front','Rear')]+['BraceRod_'+side for side in ('L','R')]+['BraceSpreader']+[n for n in ('Drive_ScrewRotor','Drive_MotorRotor','Drive_PlanetRotor_0','Drive_PlanetRotor_1','Drive_PlanetRotor_2') if n in bpy.data.objects]
    s=bpy.context.scene;s.frame_end=MOTOR_END
    reference=[];previous={}
    for i in range(MOTOR_END*4+1):
        frame=i/4;s.frame_set(int(frame),subframe=frame-int(frame));fold,phase,speed=motor_state(frame)
        for side,sign in [('L',-1),('R',1)]:
            p=bpy.data.objects['WingPivot_'+side];p.rotation_mode='QUATERNION';p.rotation_quaternion=wing_rotation(sign,0);p.keyframe_insert('rotation_quaternion',frame=frame)
            for end in ('Front','Rear'):
                p=bpy.data.objects['Prop_'+side+'_'+end];p.rotation_mode='QUATERNION';p.rotation_quaternion=Quaternion((1,0,0),math.pi/2)@Quaternion((0,0,1),p.get('spinSign',1)*phase)
                if p.name in previous and p.rotation_quaternion.dot(previous[p.name])<0:p.rotation_quaternion.negate()
                previous[p.name]=p.rotation_quaternion.copy();p.keyframe_insert('rotation_quaternion',frame=frame)
                for leaf,sgn in [('A',-1),('B',1)]:
                    p=bpy.data.objects['BladeFold_'+side+'_'+end+'_'+leaf];p.rotation_mode='XYZ';p.rotation_euler=(0,sgn*math.pi/2*fold,0);p.keyframe_insert('rotation_euler',frame=frame)
        update_linkage();bpy.data.objects['BraceSpreader'].keyframe_insert('location',frame=frame)
        for drive_name in ('Drive_ScrewRotor','Drive_MotorRotor','Drive_PlanetRotor_0','Drive_PlanetRotor_1','Drive_PlanetRotor_2'):
            if drive_name in bpy.data.objects:pass  # V22 independent bounded quaternion bake below
        for side in ('L','R'):
            p=bpy.data.objects['BraceRod_'+side]
            for prop in ('location','rotation_quaternion','scale'):p.keyframe_insert(prop,frame=frame)
        reference.append({'frame':frame,'time':frame/24,'fold':fold,'phase':phase,'angularSpeed':speed})
    bake_drive_quaternions(MOTOR_END)
    for name in names:
        for fc in bpy.data.objects[name].animation_data.action.fcurves:
            for key in fc.keyframe_points:key.interpolation='LINEAR'
    _attach_actions(MOTOR_CLIP)
    attach_native_drive_constraints()
    s['motor_demo_note']='0–12帧停机收桨；12–36帧先展开；36–60帧加速；60–96帧转动；96–120帧减速；120–132帧正向寻位；132–156帧收桨；156–168帧停机。时序与转速为演示参数，不是原厂控制律。'
    text=bpy.data.texts.new('切换演示动作.py')
    text.write('"""在 Blender 中运行此文本即可切换完整四电机动作；把 MOTOR_CLIP 改为 CLIP 可回到整翼基准。"""\nimport os,runpy,bpy\nroot=os.path.abspath(os.path.join(os.path.dirname(bpy.data.filepath),\"../..\"))\nif not os.path.exists(root+\"/scripts/export-transition.py\"):root=os.path.abspath(os.path.join(root,\"..\"))\nns=runpy.run_path(root+\"/scripts/export-transition.py\",run_name=\"v14_select\")\nns[\"select_clip\"](ns[\"MOTOR_CLIP\"])\n')
    os.makedirs(os.path.join(ROOT,'assets/animation'),exist_ok=True)
    json.dump(reference,open(os.path.join(ROOT,'assets/animation/motor-reference.json'),'w'),indent=2)
    select_clip(CLIP)


def _read_glb(path):
    import struct
    data=open(path,'rb').read();n=struct.unpack_from('<I',data,12)[0]
    return json.loads(data[20:20+n]),data[28+n:]


def _write_glb(path,doc,data):
    import struct
    j=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode();j+=b' '*((-len(j))%4);data+=b'\0'*((-len(data))%4)
    open(path,'wb').write(struct.pack('<III',0x46546c67,2,28+len(j)+len(data))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(data),0x004e4942)+data)


def align_serialized_drive_phases(doc,data):
    import struct,bisect
    def read(index,components):
        a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']]
        start=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',components*4)
        return [struct.unpack_from('<'+'f'*components,data,start+i*stride) for i in range(a['count'])]
    def append_accessor(rows,components,kind):
        data.extend(b'\0'*((-len(data))%4));offset=len(data)
        for row in rows:data.extend(struct.pack('<'+'f'*components,*row))
        view=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(rows)*components*4})
        accessor={'bufferView':view,'componentType':5126,'count':len(rows),'type':kind}
        if components==1:accessor.update({'min':[rows[0][0]],'max':[rows[-1][0]]})
        index=len(doc['accessors']);doc['accessors'].append(accessor);return index
    def write(index,rows):
        a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']]
        start=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',16)
        for i,row in enumerate(rows):struct.pack_into('<ffff',data,start+i*stride,*row)
    nodes={n['name']:(i,n) for i,n in enumerate(doc['nodes'])}
    si,sn=nodes['BraceSpreader'];rest=-sn['translation'][2]
    reports=[]
    for clip in doc['animations']:
        channel=next(c for c in clip['channels'] if c['target']['node']==si and c['target']['path']=='translation')
        sampler=clip['samplers'][channel['sampler']];times=[p[0] for p in read(sampler['input'],1)];positions=[-p[2] for p in read(sampler['output'],3)]
        def slider(t):
            j=max(0,min(len(times)-2,bisect.bisect_right(times,t)-1));u=max(0,min(1,(t-times[j])/(times[j+1]-times[j])))
            return positions[j]*(1-u)+positions[j+1]*u
        for name in DRIVE_NAMES:
            if name not in nodes:continue
            ni,n=nodes[name];extra=n['extras'];q=n.get('rotation',[0,0,0,1]);base=Quaternion((q[3],q[0],q[1],q[2]))
            ch=next(c for c in clip['channels'] if c['target']['node']==ni and c['target']['path']=='rotation');sa=clip['samplers'][ch['sampler']]
            native=bpy.data.actions[clip['name']+'__'+name].fcurves.find('rotation_quaternion',index=0)
            encoded_times=sorted(set(struct.unpack('<f',struct.pack('<f',float(k.co.x)/24))[0] for k in native.keyframe_points))
            sa['input']=append_accessor([(t,) for t in encoded_times],1,'SCALAR')
            result=[];previous=None;maxstep=0.;lastangle=None
            for t in encoded_times:
                angle=-2*math.pi*(slider(t)-rest)/extra['screwLead']*extra['phaseRatio']
                # Native Quaternion construction truncates angle to float32.
                # Build sin/cos in Python double before final glTF Float32 write.
                half=math.remainder(angle,4*math.pi)/2;axis=extra['driveAxis'];x,y,z,w=q
                sx,sy,sz=[v*math.sin(half) for v in axis];sw=math.cos(half)
                out=[w*sx+x*sw+y*sz-z*sy,w*sy-x*sz+y*sw+z*sx,w*sz+x*sy-y*sx+z*sw,w*sw-x*sx-y*sy-z*sz]
                if previous is not None and sum(a*b for a,b in zip(previous,out))<0:out=[-v for v in out]
                if lastangle is not None:maxstep=max(maxstep,abs(angle-lastangle))
                result.append(out);previous=out;lastangle=angle
            if maxstep>DRIVE_MAX_KEY_ANGLE+1e-4:raise ValueError('Drive exported key angle exceeds safe bound: '+str((name,maxstep)))
            sa['output']=append_accessor(result,4,'VEC4');reports.append({'clip':clip['name'],'node':name,'samples':len(result),'maximumAngleStep':maxstep})
    doc['buffers'][0]['byteLength']=len(data)
    doc.setdefault('extras',{})['drivePhaseEncodingV22']={'method':'five drive quaternions recomputed from the same serialized float32 slider samples and time keys','maximumKeyAngle':DRIVE_MAX_KEY_ANGLE,'tracks':reports,'unrelatedTracksUntouched':True}
    return data

def export_transition(path):
    import tempfile,copy
    os.makedirs(os.path.dirname(path),exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        paths=[]
        for clip in (CLIP,MOTOR_CLIP):
            select_clip(clip);p=os.path.join(tmp,clip+'.glb');paths.append(p)
            bpy.ops.object.select_all(action='SELECT')
            bpy.ops.export_scene.gltf(filepath=p,export_format='GLB',use_selection=True,export_yup=True,export_extras=True,export_animations=True,export_animation_mode='ACTIVE_ACTIONS',export_nla_strips_merged_animation_name=clip,export_frame_range=True,export_frame_step=1,export_force_sampling=False,export_optimize_animation_size=False,export_anim_slide_to_zero=True,export_cameras=False,export_lights=False)
        a,ab=_read_glb(paths[0]);b,bb=_read_glb(paths[1]);data=bytearray(ab);nodes={n['name']:i for i,n in enumerate(a['nodes'])};accessors={};views={}
        animation=copy.deepcopy(b['animations'][0]);animation['name']=MOTOR_CLIP
        for channel in animation['channels']:
            target=channel['target'];target['node']=nodes[b['nodes'][target['node']]['name']]
        for sampler in animation['samplers']:
            for key in ('input','output'):
                old=sampler[key]
                if old not in accessors:
                    accessor=copy.deepcopy(b['accessors'][old]);viewid=accessor['bufferView']
                    if viewid not in views:
                        view=copy.deepcopy(b['bufferViews'][viewid]);offset=view.get('byteOffset',0);chunk=bb[offset:offset+view['byteLength']];data.extend(b'\0'*((-len(data))%4));view['byteOffset']=len(data);view['buffer']=0;views[viewid]=len(a['bufferViews']);a['bufferViews'].append(view);data.extend(chunk)
                    accessor['bufferView']=views[viewid];accessors[old]=len(a['accessors']);a['accessors'].append(accessor)
                sampler[key]=accessors[old]
        a['animations'].append(animation);a['buffers'][0]['byteLength']=len(data)
        data=align_serialized_drive_phases(a,data)
        mechanism=bpy.context.scene.get('annotatedMechanismJSON')
        if mechanism is None:raise ValueError('Annotated source export requires the persisted actual-fit mechanism')
        a.setdefault('extras',{})['annotatedMechanism']=json.loads(mechanism)
        _write_glb(path,a,bytes(data))
    select_clip(CLIP)

if __name__=='__main__':
    bake_transition()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'assets/blender/xp4.blend'))
    export_transition(os.path.join(ROOT,'assets/blender/xp4-source.glb'))
