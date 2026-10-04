"""按用户收翼图红箭头调整完整动力舱及等厚中央翼，全部为概念模型单位。"""
import math
import re
import bpy
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

CENTRAL_WING_LIFT = .029
NACELLE_LOWERING = .22
INNER_NACELLE_INSET = .35
HINGE_LIFT = .029
NACELLE_ROOT_PREFIXES=('Nacelle','Motor_cowl','Landing_wear_tip','Pod_U_access_panel',
              'Cowl_boundary','Pod_wing_saddle','Pod_mount_seam','MotorAxisStart',
              'MotorAxisEnd','Motor_spindle','Prop','MotorFrontBearing')

def is_nacelle_root(name):
    return bool(re.fullmatch(r'^(?:'+'|'.join(NACELLE_ROOT_PREFIXES)+r')_[LR]_(?:Front|Rear)(?:\.\d+)?$',name))


def smooth(value):
    t=max(0.,min(1.,value))
    return t*t*(3-2*t)


def lift_fixed_wing(obj):
    """两层蒙皮同量平移，保持实际竖直厚度；轴孔已保持原相对位置，完整实体等量抬升。"""
    for v in obj.data.vertices:v.co.z+=CENTRAL_WING_LIFT
    obj.data.update()


def reposition_nacelles(ctx):
    """仅平移所属翼的直属动力节点，Prop整个后代树因此只移动一次。"""
    prefixes=NACELLE_ROOT_PREFIXES
    rows=[]
    for side,sign in [('L',-1),('R',1)]:
        pivot=bpy.data.objects['WingPivot_'+side]
        for which in ('Front','Rear'):
            intent_delta=Vector((-sign*INNER_NACELLE_INSET if which=='Front' else 0.,0.,-NACELLE_LOWERING))
            rebase_delta=Vector((0.,0.,-HINGE_LIFT))
            delta=intent_delta+rebase_delta
            pattern=re.compile(r'^(?:'+ '|'.join(prefixes)+r')_'+side+'_'+which+r'(?:\.\d+)?$')
            children=sorted([o for o in pivot.children if pattern.fullmatch(o.name)],key=lambda o:o.name)
            if len(children)!=14:raise ValueError('完整动力舱直属层级不符：'+str((side,which,[o.name for o in children])))
            descendants=[]
            for obj in children:
                obj.location+=delta
                descendants.append(obj.name)
                descendants.extend(o.name for o in obj.children_recursive)
            # 既有构造测量位于父翼局部坐标；同刚体平移后整体转换其记录。
            support=ctx['SURFACE_SUPPORTS']
            moved_names=set(descendants)
            for record in support['changes']:
                if record['node'] not in moved_names:continue
                for key in ('beforeBoundsBlender','afterBoundsBlender'):
                    if key in record:record[key]=[list(Vector(p)+delta)for p in record[key]]
                record['assemblyLayoutDeltaBlender']=list(delta)
                record['transformPreserved']=False
            for record in support['finiteContactPairs']:
                if not set(record['pair'])<=moved_names:continue
                for key in ('finiteContactBoundsBlender','interiorWitnessesBlender'):
                    if key in record:record[key]=[list(Vector(p)+delta)for p in record[key]]
                record['assemblyLayoutDeltaBlender']=list(delta)
                record['layoutEvidence']='原同刚体材料测量整体平移；独立最终支承检查另验'
            rows.append({'key':side+'_'+which,'wingFrame':pivot.name,'deltaBlenderLocal':list(intent_delta),
                         'deltaGltfLocal':[intent_delta.x,intent_delta.z,-intent_delta.y],
                         'hingeRebaseDeltaBlenderLocal':list(rebase_delta),
                         'appliedNodeDeltaBlenderLocal':list(delta),
                         'directNodes':[o.name for o in children],'allMovedNodes':sorted(descendants),
                         'cruiseCenterAbsX':2.12-INNER_NACELLE_INSET if which=='Front' else 3.75,
                         'cruiseCenterZ':-.22-NACELLE_LOWERING,
                         'method':'直属节点整体平移一次；后代局部坐标、父级、折桨与旋转轴保持'})
    bpy.context.view_layer.update()
    return {'assemblies':rows,'wingSaddleAttachments':measure_wing_saddle_attachments(),'conceptElectronics':'电机/ESC功能示意资产仍为独立模块，无虚构的整机内部电子设备节点',
            'units':'概念模型单位','source':'用户2026-10-04收翼图四红箭头；先换算至所属翼局部坐标',
            'hingeRelocation':{'deltaBlender':[0,0,HINGE_LIFT],'deltaGltf':[0,HINGE_LIFT,0],'reason':'与中央翼等量上移，使原通孔关系及薄下皮材料恢复；真实硬件和低驱动闭环同步'},
            'fullStrokeRequiresNewCollisionEvidence':True}


def measure_wing_saddle_attachments():
    """只读作者材料见证；最终独立合同与双编码支承门另外核验。"""
    from surface_supports import _contact
    bpy.context.view_layer.update()
    rows=[]
    for side in ('L','R'):
        for which in ('Front','Rear'):
            saddle=bpy.data.objects['Pod_wing_saddle_'+side+'_'+which]
            wing=bpy.data.objects['Composite_wing_'+side]
            row=_contact(saddle,wing,'下挂动力舱原薄鞍座与所属活动翼的有限同刚体固定嵌合')
            row['type']='fixed'
            row['evidenceScope']='作者构造记录；最终独立合同与双编码support门另验，不是跨刚体碰撞豁免'
            rows.append(row)
    return rows


def _closest_triangle_weights(p,a,b,c):
    # Double arithmetic on the stored coordinates; return a point on the finite triangle.
    sub=lambda x,y:tuple(i-j for i,j in zip(x,y))
    dot=lambda x,y:sum(i*j for i,j in zip(x,y))
    ab,ac,ap=sub(b,a),sub(c,a),sub(p,a);d1,d2=dot(ab,ap),dot(ac,ap)
    if d1<=0 and d2<=0:return (1.,0.,0.)
    bp=sub(p,b);d3,d4=dot(ab,bp),dot(ac,bp)
    if d3>=0 and d4<=d3:return (0.,1.,0.)
    vc=d1*d4-d3*d2
    if vc<=0 and d1>=0 and d3<=0:
        v=d1/(d1-d3);return (1-v,v,0.)
    cp=sub(p,c);d5,d6=dot(ab,cp),dot(ac,cp)
    if d6>=0 and d5<=d6:return (0.,0.,1.)
    vb=d5*d2-d1*d6
    if vb<=0 and d2>=0 and d6<=0:
        w=d2/(d2-d6);return (1-w,0.,w)
    va=d3*d6-d5*d4
    if va<=0 and d4-d3>=0 and d5-d6>=0:
        w=(d4-d3)/((d4-d3)+(d5-d6));return (0.,1-w,w)
    den=va+vb+vc
    if den<=0:raise ValueError('Host triangle closest point is degenerate')
    v,w=vb/den,vc/den;return (1-v-w,v,w)


def follow_lifted_host_details(host,old_vertices,triangles):
    """Only four existing skin details follow their real hosts; no new parts or fit exemptions.

    Each front join vertex carries its original world offset from the closest old
    Fuselage triangle's barycentric material point. The tube follows the bounded
    surface deformation; it is not claimed to retain rigid cross-sections.
    """
    if host.parent is not None or host.matrix_world!=Matrix.Identity(4):
        raise ValueError('Fuselage detail transport expects the unchanged world frame')
    old=[tuple(p)for p in old_vertices];new=[tuple(v.co)for v in host.data.vertices]
    tree=BVHTree.FromPolygons(old,triangles,all_triangles=True,epsilon=0.)
    rows=[]
    for name in ('Lower_fuselage_join','Lower_fuselage_join.002'):
        obj=bpy.data.objects[name]
        if obj.parent is not None or obj.matrix_world!=Matrix.Identity(4):
            raise ValueError('Front join host frame changed: '+name)
        original=[tuple(v.co)for v in obj.data.vertices]
        old_faces=[tuple(f.vertices)for f in obj.data.polygons]
        if any(len(f)!=3 for f in old_faces):raise ValueError('Join transport requires actual original triangles')
        old_normals=[[tuple(obj.data.corner_normals[li].vector)for li in f.loop_indices]for f in obj.data.polygons]
        old_smooth=[f.use_smooth for f in obj.data.polygons]
        old_material=[f.material_index for f in obj.data.polygons]
        def mapping(p,i):
            hit,normal,ti,distance=tree.find_nearest(Vector(p))
            if hit is None or distance>.010:raise ValueError('Front join lost its original host: '+name)
            ids=triangles[ti];weights=_closest_triangle_weights(p,*(old[j]for j in ids))
            anchor=tuple(sum(w*old[j][k]for w,j in zip(weights,ids))for k in range(3))
            delta=sum(w*(new[j][2]-old[j][2])for w,j in zip(weights,ids))
            return {'vertex':i,'beforeBlender':list(p),'hostTriangle':ti,'hostVertexIndices':list(ids),
                    'hostOriginalTriangleBlender':[list(old[j])for j in ids],
                    'barycentricWeights':list(weights),'hostAnchorBeforeBlender':list(anchor),
                    'originalWorldOffset':[p[k]-anchor[k]for k in range(3)],'carriedHostDeltaZ':delta}
        records=[mapping(p,i)for i,p in enumerate(original)]
        original_changed={r['vertex']for r in records if r['carriedHostDeltaZ']}
        patch={i for i,f in enumerate(old_faces)if any(v in original_changed for v in f)}
        if len(patch)!=16:raise ValueError('Unexpected join refinement scope: '+str((name,patch)))
        before=list(original);faces=list(old_faces);provenance=list(range(len(faces)))
        # Conforming bisection in the unchanged original material. Only the sixteen
        # approved faces may split; all four-sided tube section boundary edges are short.
        while True:
            edges={tuple(sorted((f[j],f[(j+1)%3])))for f,source in zip(faces,provenance)if source in patch for j in range(3)}
            long=[e for e in sorted(edges)if sum((before[e[0]][k]-before[e[1]][k])**2 for k in range(3))>.025**2]
            if not long:break
            u,v=max(long,key=lambda e:(sum((before[e[0]][k]-before[e[1]][k])**2 for k in range(3)),e))
            if any(source not in patch and u in f and v in f for f,source in zip(faces,provenance)):
                raise ValueError('Refinement would split a protected original boundary')
            m=len(before);before.append(tuple((before[u][k]+before[v][k])/2 for k in range(3)))
            updated=[];parents=[]
            for f,source in zip(faces,provenance):
                if u in f and v in f:
                    j=next(j for j in range(3)if {f[j],f[(j+1)%3]}=={u,v})
                    x,y,z=f[j],f[(j+1)%3],f[(j+2)%3]
                    updated.extend([(x,m,z),(m,y,z)]);parents.extend([source,source])
                else:updated.append(f);parents.append(source)
            faces,provenance=updated,parents
        if len(before)>len(original):
            obj.data.clear_geometry();obj.data.from_pydata(before,[],faces);obj.data.update()
            # Use the actual stored Float32 points for transport and proof, including
            # finite-triangle rounding of newly inserted original-material midpoints.
            before=[tuple(v.co)for v in obj.data.vertices]
            records=[mapping(p,i)for i,p in enumerate(before)]
        changed=set()
        for r in records:
            i=r['vertex'];delta=r['carriedHostDeltaZ']
            if delta:obj.data.vertices[i].co.z=before[i][2]+delta;changed.add(i)
            r['afterBlender']=list(obj.data.vertices[i].co)
        for f,source in zip(obj.data.polygons,provenance):
            f.use_smooth=old_smooth[source];f.material_index=old_material[source]
        obj.data.update()
        obj.data.normals_split_custom_set([(0.,0.,0.)for _ in obj.data.loops]);obj.data.update()
        geometric=[n.vector.copy()for n in obj.data.corner_normals]
        normals=[]
        for f,source in zip(obj.data.polygons,provenance):
            normals.extend([geometric[li]for li in f.loop_indices]if source in patch else old_normals[source])
        obj.data.normals_split_custom_set(normals);obj.data.update()
        support=[original[i]for source in patch for i in old_faces[source]]
        rows.append({'node':name,'host':'Fuselage','method':'original finite-triangle refinement then old actual host barycentric displacement plus unchanged per-point world offset',
                     'originalVertexCount':len(original),'originalFaces':old_faces,'refinedOriginalFaces':sorted(patch),
                     'originalMaterialMaximumEdge':.025,'outputFaceOriginalSources':provenance,
                     'changedVertexIndices':sorted(changed),'originalChangedVertexIndices':sorted(original_changed),
                     'unchangedVerticesExact':all(tuple(obj.data.vertices[i].co)==p for i,p in enumerate(original)if i not in original_changed),
                     'xyAndOriginalProtectedTopologyPreserved':all(tuple(v.co)[:2]==before[v.index][:2]for v in obj.data.vertices)and all(f==old_faces[source]for f,source in zip(faces,provenance)if source not in patch),
                     'affectedTriangleSupportBlender':[[min(p[k]for p in support)for k in range(3)],[max(p[k]for p in support)for k in range(3)]],
                     'vertexMapping':records,'crossSectionClaim':'bounded skin-following deformation, not rigid tube-section preservation'})
    for side in ('L','R'):
        obj=bpy.data.objects['Root_access_cover_'+side]
        if obj.parent is not None:raise ValueError('Root access cover parent changed')
        before=list(obj.location);obj.location.z+=CENTRAL_WING_LIFT
        rows.append({'node':obj.name,'host':'Fixed_root_'+side,'method':'same whole-host translation; mesh data and hierarchy unchanged',
                     'deltaBlender':[0.,0.,CENTRAL_WING_LIFT],'beforeLocation':before,'afterLocation':list(obj.location)})
    bpy.context.view_layer.update()
    return {'parts':rows,'scope':'only four original details associated with lifted fixed-wing skin or bounded Fuselage saddle',
            'claimBoundary':'author transport record; all283 support paths and all40 decoration offsets still require independent verification'}


def lift_central_attachment():
    """在已保留原机壳的同一网格局部变形，避免重新布尔改变机鼻与直槽。

    固定翼接合断面|X|=.62全量上移。机壳关联域内以C1权重归零，
    中央翼薄鞍上下皮共用相同量，远处机壳顶点及全部拓扑不变。
    """
    obj=bpy.data.objects['Fuselage'];changed=[];normals=[n.vector.copy()for n in obj.data.corner_normals]
    original=[v.co.copy()for v in obj.data.vertices]
    obj.data.calc_loop_triangles();triangles=[tuple(t.vertices)for t in obj.data.loop_triangles]
    def weight(p):
        x,y,z=p
        return smooth((abs(x)-.25)/.19)*smooth((y+1.97)/.14)*smooth((-.75-y)/.14)*(1-smooth((z+.10)/.12))
    for v in obj.data.vertices:
        delta=CENTRAL_WING_LIFT*weight(v.co)
        if delta:
            changed.append({'index':v.index,'before':list(v.co),'deltaZ':delta})
            v.co.z+=delta
    obj.data.update()
    # 用实际坐标映射雅可比变换已有逐角外法线，保留域外原法线。
    result=[];eps=1e-5
    for loop,n in zip(obj.data.loops,normals):
        p=original[loop.vertex_index]
        if weight(p)==0:result.append(n);continue
        gradients=[]
        for axis in range(3):
            a=p.copy();b=p.copy();a[axis]+=eps;b[axis]-=eps
            gradients.append(CENTRAL_WING_LIFT*(weight(a)-weight(b))/(2*eps))
        a,b,c=gradients;nz=n.z/(1+c)
        result.append(Vector((n.x-a*nz,n.y-b*nz,nz)).normalized())
    obj.data.normals_split_custom_set(result);obj.data.update()
    changed_ids={r['index']for r in changed}
    affected_faces=[f for f in obj.data.polygons if any(i in changed_ids for i in f.vertices)]
    affected_points=[original[i]for f in affected_faces for i in f.vertices]
    support_bounds={'minimumAbsX':min(abs(p.x)for p in affected_points),'maximumAbsX':max(abs(p.x)for p in affected_points),'y':[min(p.y for p in affected_points),max(p.y for p in affected_points)],'z':[min(p.z for p in affected_points),max(p.z for p in affected_points)]}
    details=follow_lifted_host_details(obj,original,triangles)
    return {'node':obj.name,'centralWingLift':CENTRAL_WING_LIFT,'hostSurfaceDetails':details,
            'affectedBlenderBounds':{'absXMin':.25,'y':[-1.97,-.75],'zMax':.02},
            'fullLiftRegion':{'absXMin':.44,'y':[-1.83,-.89],'zMax':-.10},
            'blend':'C1 smoothstep products, vertical deformation only; exact unchanged topology',
            'changedVertices':changed,'unmodifiedVertexCount':len(original)-len(changed),
            'fixedWingInterfaceAbsX':.62,'outsideDomainExact':True,'affectedTriangleSupportBlender':support_bounds,'affectedPolygonCount':len(affected_faces)}
