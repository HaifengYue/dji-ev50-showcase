"""One bounded finite static seat, only two pedestal mesh data replacements.

The annulus is explicitly defined by repository-relative data; no analysis mesh,
route or saved fixture is an authoring input. Hardware, hosts, moving supports,
parenting, object matrices and materials are unchanged. This is not acceptance.
"""
from pathlib import Path
import json,math,hashlib,sys
import bpy,bmesh
from mathutils import Vector

CONTRACT_PATH=Path(__file__).with_name('data')/'annotated-fixed-support.json'
CONTRACT=json.loads(CONTRACT_PATH.read_text())
assert CONTRACT['schema']=='transwing.annotated-fixed-support.v1'

def build_annotated_fixed_supports():
    thread_args=[sys.argv[i+1]for i,a in enumerate(sys.argv[:-1])if a in ('-t','--threads')]
    thread_args += [a.split('=',1)[1]for a in sys.argv if a.startswith('--threads=')]
    if not thread_args or any(a!='4'for a in thread_args):raise ValueError('Deterministic authoring requires Blender -t 4')
    C=CONTRACT;O=Vector(C['axisOriginRight']);A=Vector(C['axisDirectionRight']).normalized()
    E=Vector((-1,1,0)).normalized();F=A.cross(E).normalized();N=C['segments'];ta,tb=C['axisT'];ri,ro=C['innerRadius'],C['outerRadius']
    if not(-.010<=ta<tb<=-.004 and 0<ri<ro<=.045):raise ValueError('Fixed seat exceeds its authorized finite domain')
    states={}
    for side,sg in [('R',1),('L',-1)]:
        obj=bpy.data.objects['RootFixedBearingPedestal_'+side];pivot=bpy.data.objects['WingPivot_'+side]
        if obj.parent is not None or obj.modifiers or obj.animation_data:raise ValueError('Unexpected fixed-seat hierarchy')
        if obj.get('annotatedFixedSupportCandidate'):raise ValueError('Refusing repeated fixed-seat application')
        if (pivot.location-Vector((sg*O.x,O.y,O.z))).length>3e-7 or abs(pivot.rotation_quaternion.angle)>1e-7:raise ValueError('Requires original native cruise rest')
        states[side]=(obj,obj.matrix_world.copy(),obj.matrix_basis.copy(),tuple(obj.data.materials))
    vertices=[];faces=[]
    for t,r in [(ta,ri),(ta,ro),(tb,ro),(tb,ri)]:
        for k in range(N):
            d=E*math.cos(2*math.pi*k/N)+F*math.sin(2*math.pi*k/N);vertices.append(O+A*t+d*r)
    for a in range(4):
        b=(a+1)%4
        for k in range(N):j=(k+1)%N;faces.append((a*N+k,a*N+j,b*N+j,b*N+k))
    staged=[];rows=[]
    for side,sg in [('R',1),('L',-1)]:
        obj,world,basis,mats=states[side];inv=world.inverted();verts=[inv@Vector((sg*p.x,p.y,p.z))for p in vertices];fcs=faces if sg==1 else [f[::-1]for f in faces]
        data=bpy.data.meshes.new('BoundedFixedAnnularSeat_'+side);data.from_pydata(verts,[],fcs);data.update()
        for mat in mats:data.materials.append(mat)
        bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bmesh.ops.triangulate(bm,faces=list(bm.faces));row={'side':side,'triangleCount':len(bm.faces),'badEdges':sum(not e.is_manifold for e in bm.edges),'smallFaces':sum(f.calc_area()<=1e-18 for f in bm.faces),'volume':bm.calc_volume(signed=True)}
        if row['badEdges'] or row['smallFaces'] or row['volume']<=0:bm.free();raise ValueError('Fixed finite annulus is not a closed positive solid')
        bm.to_mesh(data);bm.free();data.update();staged.append((obj,data));rows.append(row)
    for obj,data in staged:obj.data=data;obj['annotatedFixedSupportCandidate']=True;obj['fixedSupportAccepted']=False
    bpy.context.view_layer.update()
    for side,(obj,world,basis,mats)in states.items():assert obj.parent is None and obj.matrix_world==world and obj.matrix_basis==basis and tuple(obj.data.materials)==mats
    return {'candidateOnly':True,'accepted':False,'fullMachinePassed':False,'parts':rows,'configurationSha256':hashlib.sha256(CONTRACT_PATH.read_bytes()).hexdigest(),'changesLimitedTo':['RootFixedBearingPedestal_L','RootFixedBearingPedestal_R'],'actualContactSpansNotYetMeasured':True,'movingSweepNotYetMeasured':True,'productionGeneratorIntegrated':False}
