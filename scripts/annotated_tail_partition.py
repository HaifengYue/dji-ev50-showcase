"""Direct closed BRep for the same bounded trailing-skin union.

Cell-specific row loops share exact encoded coordinates at branch transitions.
No skin Boolean union and no geometry/acceptance threshold relaxation.
"""
import bisect,json,hashlib
from pathlib import Path
CONTRACT_PATH=Path(__file__).with_name('data')/'annotated-tail-partition.json'
CONTRACT=json.loads(CONTRACT_PATH.read_text())
if CONTRACT.get('schema')!='transwing.annotated-tail-partition.v7d.v1':raise ValueError('Unexpected segmented-tail contract')
FROZEN_PARAMETER_SHA256='96f0588c5398f2e308e191b7a1da6e93ea17bd3c7ceaff7cb7990d17a9e3e1f5'
if hashlib.sha256(json.dumps(CONTRACT['parameters'],sort_keys=True,separators=(',',':')).encode()).hexdigest()!=FROZEN_PARAMETER_SHA256:raise ValueError('Segmented-tail parameters differ from literal recipe')
START=-1.01215
FULL=-1.010
REPORTS=[]

def build_partition(ctx,side,sign,fixed,stations,pivot):
    import bpy,bmesh
    from mathutils import Vector
    from layered_wing_joint import _orient
    from annotated_root_interface import (YS,reference_curve,lower_curve,upper_gap,lower_gap,
        construction_top_allowance,construction_bottom_allowance,skin,smooth)
    source_ys=sorted(set([-3.,1.]+YS+[-1.91+.005*i for i in range(220)]))
    source=[]
    for y in source_ys:
        u=reference_curve(y)+(0. if fixed else upper_gap(y));l=lower_curve(y)+(0. if fixed else lower_gap(y))
        core=max(.16,min(1.80,min(u,l)-.075 if fixed else max(u,l)+.075))
        rt=min(skin(ctx,stations,sign*x,y,True)for x in [min(core,u)+abs(core-u)*j/16 for j in range(17)])-construction_top_allowance(y,fixed)
        rb=max(skin(ctx,stations,sign*x,y,False)for x in [min(core,l)+abs(core-l)*j/16 for j in range(17)])+construction_bottom_allowance(y)
        t,b=rt,rb
        if t<=b+.001:
            mid=(t+b)/2;t=mid+.0005;b=mid-.0005
        w=1-smooth((-1.015-y)/.035);target=min(u,l)if fixed else max(u,l)
        pc=(1-w)*core+w*target if w<1 else target
        source.append(dict(y=y,u=u,l=l,t=t,b=b,rt=rt,rb=rb,pc=pc))
    def interp(a,b,f):return {k:a[k]+(b[k]-a[k])*f for k in a}
    def sample(y):
        j=max(0,min(len(source_ys)-2,bisect.bisect_right(source_ys,y)-1))
        return interp(source[j],source[j+1],(y-source_ys[j])/(source_ys[j+1]-source_ys[j]))
    full=min(source_ys,key=lambda y:abs(y-FULL));assert abs(full-FULL)<1e-10
    ys=sorted(set(source_ys+[START]+[START+(full-START)*k/4 for k in (1,2,3)]))
    rows=[]
    for y in ys:
        row=source[source_ys.index(y)].copy()if y in source_ys else sample(y)
        row['y']=y
        if y>=START:
            w=smooth((y-START)/(full-START));row['t']+=w*(row['rt']-row['t']);row['b']+=w*(row['rb']-row['b'])
        rows.append(row)
    # Each downstream profile cell must have a single branch and a single
    # ordering of its two skin levels. Interpolate existing rows at all swaps.
    split_rows=[rows[0]];splits=[]
    for a,b in zip(rows,rows[1:]):
        inside=[]
        if a['y']>=START:
            for first,second in [('u','l'),('t','b')]:
                da=a[first]-a[second];db=b[first]-b[second]
                if da*db<0:
                    f=-da/(db-da);r=interp(a,b,f)
                    common=(r[first]+r[second])/2;r[first]=r[second]=common
                    inside.append(r);splits.append({'kind':[first,second],'Y':r['y'],'sourceInterval':[a['y'],b['y']]})
        split_rows.extend(sorted(inside,key=lambda r:r['y']));split_rows.append(b)
    origin=Vector()if fixed else pivot.location.copy();vertices=[];lookup={};faces=[];zero_dimensional=[]
    def ring(row,kind,branch=None,other_below=None):
        u,l,t,b,pc=[row[k]for k in ['u','l','t','b','pc']]
        if kind=='old':points=[(.10,-2.),(l,-2.),(l,b),(pc,b),(pc,t),(u,t),(u,2.),(.10,2.)]
        else:
            h=t if branch=='top'else b;other=b if branch=='top'else t
            if other_below:points=[(.10,-2.),(l,-2.),(l,other),(l,h),(u,h),(u,2.),(.10,2.)]
            else:points=[(.10,-2.),(l,-2.),(l,h),(u,h),(u,other),(u,2.),(.10,2.)]
        out=[]
        for x,z in points:
            co=tuple(Vector((sign*x,row['y'],z))-origin)
            if co not in lookup:lookup[co]=len(vertices);vertices.append(co)
            out.append(lookup[co])
        return out
    def face(ids):
        clean=[]
        for i in ids:
            if not clean or clean[-1]!=i:clean.append(i)
        if len(clean)>1 and clean[0]==clean[-1]:clean.pop()
        if len(set(clean))<3:zero_dimensional.append(ids);return
        if len(set(clean))!=len(clean):raise ValueError('Repeated nonadjacent material vertex in partition face')
        faces.append(tuple(clean))
    first_ring=last_ring=None
    for a,b in zip(split_rows,split_rows[1:]):
        if b['y']<=START:
            ra,rb=ring(a,'old'),ring(b,'old')
        else:
            assert a['y']>=START
            ud=(a['u']-a['l'])+(b['u']-b['l'])
            branch='top'if ((ud>=0)==fixed)else'bottom'
            other='b'if branch=='top'else't';h='t'if branch=='top'else'b'
            below=(a[other]-a[h])+(b[other]-b[h])<0
            ra,rb=ring(a,'new',branch,below),ring(b,'new',branch,below)
        if first_ring is None:first_ring=ra
        last_ring=rb
        assert len(ra)==len(rb)
        for k in range(len(ra)):j=(k+1)%len(ra);face([ra[k],ra[j],rb[j],rb[k]])
    face(first_ring[::-1]);face(last_ring)
    obj=ctx['mesh_object']('Temporary_true_tail_partition',vertices,faces,None,None if fixed else pivot,False)
    bm=bmesh.new();bm.from_mesh(obj.data)
    # Duplicate sample Y values from the historical row sources can encode to
    # identical coordinates. Canonical coordinates above already merge them.
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-10)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.normal_update()
    bad=[e for e in bm.edges if not e.is_manifold]
    if bad:
        report={'side':side,'fixed':fixed,'badEdges':len(bad),'edgeEndpoints':[[list(v.co)for v in e.verts]for e in bad]}
        bm.free()
        error=ValueError('Direct partition must be closed before touching natural stock')
        error.report=report
        raise error
    bm.to_mesh(obj.data);bm.free();obj.data.update();_orient(obj)
    REPORTS.append({'side':side,'fixed':fixed,'YStart':START,'YFull':full,'profileRows':len(split_rows),'exactCoordinateVertices':len(vertices),'zeroDimensionalRepeatedCornerFacesNotCreated':len(zero_dimensional),'splitRows':splits,'constructionOnly':True})
    return obj
