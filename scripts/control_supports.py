"""V21六舵面微型实体铰接。保留原轴线、舵角与薄唇外观。

两分离薄唇不能充当连续柔性支承；各舵面增加两处紧凑交错空心铰节，
只在对应轴段对原薄唇开真实局部让位，不填死运动微隙。
全部尺寸是原创概念可视化，不是原厂柔性铰链逆向或制造设计。
"""
import math
import bpy,bmesh
from mathutils import Vector


def build_control_supports(ctx):
    contacts=[];motion=[];new=[];changed=[]
    metal=ctx['metal'];cylinder=ctx['cylinder_between'];ring=ctx['ring_axis']
    def boolean(target,cutter,op):
        bpy.context.view_layer.update();mod=target.modifiers.new('V21舵面铰节实际孔及安装接合','BOOLEAN');mod.operation=op;mod.solver='EXACT';mod.object=cutter
        bpy.context.view_layer.objects.active=target;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
    def check(obj):
        bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-8);bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-8);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bmesh.ops.triangulate(bm,faces=list(bm.faces))
        assert all(e.is_manifold for e in bm.edges),obj.name
        assert all(f.calc_area()>1e-18 for f in bm.faces),obj.name
        bm.to_mesh(obj.data);bm.free();obj.data.update();obj.data.set_sharp_from_angle(angle=math.radians(40))
    def merge(parts,name):
        # 同一物件可含两处铰节，但每处均独立接在连续薄唇上；绝不以
        # 合并对象名称代替真实接合。QA须逐连通分量验证宿主材料接触。
        first=parts[0];first.name=name
        for part in parts[1:]:
            bm=bmesh.new();bm.from_mesh(first.data)
            temp=part.data.copy();temp.transform(first.matrix_basis.inverted()@part.matrix_basis);bm.from_mesh(temp);bpy.data.meshes.remove(temp)
            bm.to_mesh(first.data);bm.free();bpy.data.objects.remove(part,do_unlink=True)
        check(first);first['supportRevision']=21;first['conceptOnly']=True;new.append(first.name);return first
    def contact(a,b,p0,axis,spans,frame):
        for lo,hi in spans:
            start=p0+axis*lo;end=p0+axis*hi;pad=Vector((.0026,.0026,.0026));gl=ctx['gltf_vector'];u=gl(start-pad);v=gl(end+pad)
            # AABB由两端所有分量建立，避免左舵负向轴倒序。
            pts=[gl(start-pad),gl(start+pad),gl(end-pad),gl(end+pad)]
            contacts.append({'pair':[a,b],'frame':frame,'min':[min(p[i] for p in pts) for i in range(3)],'max':[max(p[i] for p in pts) for i in range(3)],'type':'fixed','reason':'微型铰节外圈与原薄唇局部材料接合','cylinder':{'center':gl(p0),'axis':gl(axis),'range':[lo,hi],'minimumRadius':.00135,'radius':.0026}})
    for row in ctx['DETAIL_MANIFEST']['controlSurfaces']:
        key=row['key'];fixed=bpy.data.objects['ControlFlexureFixed_'+key];moving=bpy.data.objects['ControlFlexureMoving_'+key]
        pivot=bpy.data.objects[row['pivot']];p0=pivot.location.copy();axis=(bpy.data.objects[row['axisEnd']].location-p0);length=axis.length;axis.normalize()
        fixed_parts=[];moving_parts=[];fixed_spans=[];moving_spans=[]
        for index,fraction in enumerate((.16,.80)):
            t=length*fraction;center=p0+axis*t
            # 贯通的小轴孔只覆盖对应短销段；保留绝大部分原柔性边外观。
            for target,base in [(fixed,p0),(moving,Vector())]:
                cut=cylinder('Temporary_control_pin_clearance',base+axis*(t-.0085),base+axis*(t+.0085),.0014,metal,target.parent,vertices=24,bevel_width=0)
                boolean(target,cut,'DIFFERENCE')
            # 固定双耳中间留活动耳空间，且给对侧薄唇切真实圆柱让位。
            for offset in (-.006,.006):
                c=center+axis*offset
                cut=cylinder('Temporary_opposite_lip_relief',axis*(t+offset-.0023),axis*(t+offset+.0023),.0028,metal,moving.parent,vertices=32,bevel_width=0)
                boolean(moving,cut,'DIFFERENCE');fixed_spans.append((t+offset-.0021,t+offset+.0021))
            # 固定双耳与中间小销是一个解析闭合实体。避免把微米级
            # 布尔共面误差带入薄铰件；活动耳仍保留独立真孔。
            u=axis.cross(Vector((0,0,1))).normalized();v=axis.cross(u)
            profile=[(-.008,.0025),(-.004,.0025),(-.004,.0012),(.004,.0012),(.004,.0025),(.008,.0025)]
            verts=[tuple(center+axis*d+r*(u*math.cos(k*2*math.pi/32)+v*math.sin(k*2*math.pi/32))) for d,r in profile for k in range(32)]
            faces=[]
            for j in range(len(profile)-1):
                for k in range(32):kk=(k+1)%32;faces.append((j*32+k,j*32+kk,(j+1)*32+kk,(j+1)*32+k))
            faces += [tuple(range(31,-1,-1)),tuple((len(profile)-1)*32+k for k in range(32))]
            pin=ctx['mesh_object']('Temporary_control_fixed_pin',verts,faces,metal,fixed.parent)
            fixed_parts.append(pin)
            sleeve=ring('Temporary_control_moving_ear',axis*t,axis,.0025,.0014,.006,metal,moving.parent);moving_parts.append(sleeve)
            cut=cylinder('Temporary_opposite_lip_relief',center-axis*.0033,center+axis*.0033,.0028,metal,fixed.parent,vertices=32,bevel_width=0)
            boolean(fixed,cut,'DIFFERENCE');moving_spans.append((t-.0031,t+.0031))
            motion.append({'key':key,'stationFraction':fraction,'fixed':'ControlHingeFixed_'+key,'moving':'ControlHingeMoving_'+key,'axisStart':row['axisStart'],'axisEnd':row['axisEnd'],'axis':ctx['gltf_vector'](axis),'centerAlongAxis':t,'shaftRadius':.0012,'boreRadius':.0014,'radialClearance':.0002,'axialEarGap':.001,'rangeDegrees':row['rangeDegrees'],'fixedKnuckleIntervals':[[t-.008,t-.004],[t+.004,t+.008]],'movingKnuckleInterval':[t-.003,t+.003]})
        fixed_obj=merge(fixed_parts,'ControlHingeFixed_'+key);moving_obj=merge(moving_parts,'ControlHingeMoving_'+key)
        contact(fixed_obj.name,fixed.name,p0,axis,fixed_spans,fixed.parent.name if fixed.parent else None)
        contact(moving_obj.name,moving.name,Vector(),axis,moving_spans,moving.parent.name)
        for obj in (fixed,moving):check(obj);changed.append(obj.name)
    return {'version':21,'conceptOnly':True,'newNodes':new,'changedNodes':changed,'fixedAttachmentInterfaces':contacts,'rotatingSupportInterfaces':motion,'oldLipMicrogapPreservedOutsideLocalHinges':.0006,'sourceBoundary':'六舵面微型短销/交错孔耳是为消除空铰轴的原创可视化支承，不宣称实机采用金属轴承；保留原舵轴、活动范围与必要孔隙'}
