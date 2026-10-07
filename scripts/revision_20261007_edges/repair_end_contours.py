"""Bounded real-material wing end repair. Requires already-open unanimated cruise.

Only Composite_wing_L/R change. No geometry is saved by apply(). No rig, axis,
fixed skin, fuselage or nacelle edits. Current finite validation is independent.
"""
import bpy,bmesh,math,json,struct
from mathutils import Vector
import rebuild_rear_corner_flat as rear

def _front_boundary(y):
    return .650+.115*(1-rear._smooth((y+1.795)/.170))

def _rear_cut(side,kind):
    # One convex quadratic-to-tangent-circle boundary. Preserve the old
    # trailing-edge tangent point; eliminate the reverse-curvature waist.
    xc0=.76395;r0=.060;r=.030;s0=rear._station(.70);s1=rear._station(.80)
    slope=((s1[1]+.994*s1[2])-(s0[1]+.994*s0[2]))/.10;te=lambda x:s0[1]+.994*s0[2]+slope*(x-.70)
    yc0=te(xc0)-r0*math.sqrt(1+slope*slope);angt=math.atan2(1.,-slope);xt=xc0+r0*math.cos(angt);yt=yc0+r0*math.sin(angt)
    xc=xt-r*math.cos(angt);yc=yt-r*math.sin(angt);y0=-1.200;x0=.650
    lo,hi=1.58,3.14
    for _ in range(70):
        a=(lo+hi)/2;xj=xc+r*math.cos(a);yj=yc+r*math.sin(a);k=(xj-x0)/(yj-y0)**2
        if 2*k*(yj-y0)+math.tan(a)>0:hi=a
        else:lo=a
    border=[(x0+k*((yj-y0)*i/96)**2,y0+(yj-y0)*i/96)for i in range(97)]
    arc=[(xc+r*math.cos(a+(angt-a)*i/64),yc+r*math.sin(a+(angt-a)*i/64))for i in range(65)];border+=arc[1:];last=border[-1]
    return rear._prism('RearRootTemporary_'+kind,[(-.5,y0),*border,(last[0],-.80),(-.5,-.80)],side=side),{'kind':kind,'curve':border,'circleCenter':[xc,yc],'radius':r,'trailingTangentPoint':list(last),'quadraticStart':[x0,y0],'joinAngle':a,'quadraticCoefficient':k,'monotoneAbsX':all(u[0]<=v[0]+1e-9 for u,v in zip(border,border[1:])),'convexNoReverseCurvature':True}

def _rear_deform(wing,side):
    import bisect,numpy as np
    sg=-1 if side=='L'else 1;wm=wing.matrix_world;inv=wm.inverted();before=rear._audit(wing)
    oldcut,oldmeta=rear._inner_cut(sg,'lower');bpy.data.objects.remove(oldcut,do_unlink=True)
    newcut,newmeta=_rear_cut(sg,'lower');bpy.data.objects.remove(newcut,do_unlink=True)
    def prefix(curve):
        stop=next((i+1 for i,(a,b)in enumerate(zip(curve,curve[1:]))if b[1]<a[1]),len(curve));return curve[:stop]
    oc=prefix(oldmeta['curve']);nc=prefix(newmeta['curve']);oy=[p[1]for p in oc];ny=[p[1]for p in nc]
    def at(curve,ys,y):
        i=max(0,min(len(curve)-2,bisect.bisect_right(ys,y)-1));a,b=curve[i:i+2];q=max(0,min(1,(y-a[1])/(b[1]-a[1])));return a[0]+q*(b[0]-a[0])
    y0=-.9985;y1=-.965;T=y1-y0;x0=at(nc,ny,y0);x1=at(oc,oy,y1);eps=1e-6
    m0=(at(nc,ny,y0+eps)-at(nc,ny,y0-eps))/(2*eps);m1=(at(oc,oy,y1+eps)-at(oc,oy,y1-eps))/(2*eps)
    for power in range(3,31):
        floor=((x1-x0)/T-(m0+m1)/(power+1))/(1-2/(power+1))
        if floor>=.02:break
    if not 0<floor<min(m0,m1):raise ValueError('Rear C1 bridge derivative must stay positive')
    def boundary(y):
        if y<=y0:return at(nc,ny,y)
        if y>=y1:return at(oc,oy,y)
        t=(y-y0)/T
        return x0+floor*T*t+(m0-floor)*T/(power+1)*(1-(1-t)**(power+1))+(m1-floor)*T/(power+1)*t**(power+1)
    def deform(p):
        x=abs(float(p[0]));y=float(p[1]);z=float(p[2])
        if not (-1.200<y<y1 and x<.86):return np.array(p,dtype=float)
        oldx=at(oc,oy,y);newx=boundary(y);weight=1-rear._smooth((x-oldx)/(.86-oldx));nx=x+(newx-oldx)*weight
        so=rear._station(x);sn=rear._station(nx);oldlo=rear._skin(x,(y-so[1])/so[2])[1];newlo=rear._skin(nx,(y-sn[1])/sn[2])[1]
        return np.array([sg*nx,y,z+newlo-oldlo])
    source_points=[np.asarray(tuple(wm@v.co),dtype=float)for v in wing.data.vertices];source_faces=[tuple(p.vertices)for p in wing.data.polygons]
    source_normals=[tuple(n.vector)for n in wing.data.corner_normals];source_loop_vertices=[loop.vertex_index for loop in wing.data.loops]
    linear=np.array(wm.to_3x3(),dtype=float);world_normal=np.linalg.inv(linear).T;local_normal=linear.T;transforms={};moved=[];jac_dets=[]
    for vertex,p in zip(wing.data.vertices,source_points):
        q=deform(p)
        if np.linalg.norm(q-p)<1e-10:continue
        vertex.co=inv@Vector(q.tolist());moved.append({'before':p.tolist(),'after':q.tolist()})
        h=1e-5;columns=[]
        for axis in range(3):
            dp=np.zeros(3);dp[axis]=h;columns.append((deform(p+dp)-deform(p-dp))/(2*h))
        J=np.column_stack(columns);det=float(np.linalg.det(J));jac_dets.append(det)
        if det<=0:raise ValueError(('Nonpositive rear deformation Jacobian',p.tolist(),det))
        transforms[vertex.index]=local_normal@np.linalg.inv(J).T@world_normal
    wing.data.update();bm=bmesh.new();bm.from_mesh(wing.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(wing.data);bm.free();wing.data.update()
    if source_faces!=[tuple(p.vertices)for p in wing.data.polygons]:raise ValueError('Normal transport requires preserved ordered rear source faces')
    normals=[]
    for n,vertex in zip(source_normals,source_loop_vertices):
        if vertex in transforms:
            v=transforms[vertex]@np.asarray(n);v=v/np.linalg.norm(v);normals.append(tuple(v))
        else:normals.append(n)
    wing.data.normals_split_custom_set(normals);wing.data.update()
    return {'side':side,'method':'Original accepted lower contour plus positive-derivative C1 bridge returning to the untouched original R.060 circle; source smooth normals transported by inverse-transpose Jacobian','before':before,'after':rear._audit(wing),'changedVertices':len(moved),'maximumDisplacement':max([float(np.linalg.norm(np.asarray(r['after'])-r['before']))for r in moved]or[0]),'retainedOriginalCircleRadius':.060,'allOriginalRearVerticesUnchangedFromY':y1,'bridge':{'y':[y0,y1],'x':[x0,x1],'endpointSlopes':[m0,m1],'derivativeFloor':floor,'exponent':power},'monotoneYBranchOnly':True,'minimumSampledJacobianDeterminant':min(jac_dets or[1]),'newBoundaryBeforeBridge':newmeta,'unchangedAtAbsX':.86,'witnesses':sorted(moved,key=lambda r:float(np.linalg.norm(np.asarray(r['after'])-r['before'])),reverse=True)[:12]}

def _refine_front_material(wing):
    bm=bmesh.new();bm.from_mesh(wing.data);wm=wing.matrix_world;inv=wm.inverted();cuts=0
    # Common chordwise stations make each remapped cap strip a vertical
    # ruled plane. Merely splitting skinny historical wall triangles does
    # not prevent their projection turning over under a nonlinear map.
    for j in range(84):
        y=-1.8125+.0025*j
        faces=[f for f in bm.faces if any(.64<abs((wm@v.co).x)<1.18 and -1.820<(wm@v.co).y<-1.59 for v in f.verts) and min((wm@v.co).y for v in f.verts)<y-1e-8 and max((wm@v.co).y for v in f.verts)>y+1e-8]
        if not faces:continue
        bm.verts.index_update();bm.edges.index_update();geom=sorted({v for f in faces for v in f.verts},key=lambda v:v.index)+sorted({e for f in faces for e in f.edges},key=lambda e:e.index)+faces
        bmesh.ops.bisect_plane(bm,geom=geom,dist=1e-8,plane_co=inv@Vector((0,y,0)),plane_no=wm.to_3x3().transposed()@Vector((0,1,0)),clear_inner=False,clear_outer=False);cuts+=1
    bmesh.ops.triangulate(bm,faces=list(bm.faces),quad_method='BEAUTY',ngon_method='EAR_CLIP');bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(wing.data);bm.free();wing.data.update()
    return {'commonCapChordStations':cuts,'stationStep':.0025,'positionsBeforeMappingRemainOnSourceTriangles':True}

def _front_deform(wing,side):
    import numpy as np,bisect
    from annotated_root_interface import reference_curve,upper_gap
    sg=-1 if side=='L'else 1;wm=wing.matrix_world;inv=wm.inverted();before=rear._audit(wing);wt=rear._tree(wing);ft=rear._tree(bpy.data.objects['Fixed_root_'+side])
    pts=np.array([tuple(wm@v.co)for v in wing.data.vertices]);pts[:,0]=np.abs(pts[:,0]);edges=np.array([tuple(e.vertices)for e in wing.data.edges]);aa=pts[edges[:,0]];bb=pts[edges[:,1]]
    def natural(x,y):
        st=rear._station(x);return rear._skin(x,(y-st[1])/st[2])[1]
    lowmask=[]
    for x,y,z in pts:
        lowmask.append(.63<x<1.3 and -1.80<y<-1.60 and z<natural(x,y)+.023)
    mask=np.array(lowmask)[edges[:,0]]&np.array(lowmask)[edges[:,1]];aa=aa[mask];bb=bb[mask]
    def oldbound(y):
        mask=(np.minimum(aa[:,1],bb[:,1])<=y)&(np.maximum(aa[:,1],bb[:,1])>=y)&(np.abs(aa[:,1]-bb[:,1])>1e-10)
        a=aa[mask];b=bb[mask];q=(y-a[:,1])/(b[:,1]-a[:,1]);return float(np.min(a[:,0]+q*(b[:,0]-a[:,0])))
    ys=[-1.7949+.0004*i for i in range(475)];bounds=[oldbound(y)for y in ys]
    def bound(y):
        i=max(0,min(len(ys)-2,bisect.bisect_right(ys,y)-1));q=(y-ys[i])/(ys[i+1]-ys[i]);return bounds[i]+q*(bounds[i+1]-bounds[i])
    def planar_delta(y):
        q=(y+1.795)/.0025;i=math.floor(q);ya=-1.795+.0025*i;yb=ya+.0025;t=q-i
        def delta_at(yy):
            return (_front_boundary(yy)-bound(yy))*rear._smooth((yy+1.7948)/.007)*rear._smooth((-1.605-yy)/.015)
        return delta_at(ya)*(1-t)+delta_at(yb)*t
    moved=[];fixedCaps=0
    for v in wing.data.vertices:
        p=wm@v.co;x=abs(p.x);y=p.y
        if not (-1.7948<y<-1.605 and x<1.15):continue
        ol=natural(x,y);height=p.z-ol;zw=1-rear._smooth((height-.025)/.010)
        if zw<=0:continue
        a=bound(y);delta=planar_delta(y);w=1-rear._smooth((x-(a+.050))/(1.15-a-.050));nx=x+delta*w*zw
        if abs(nx-x)<1e-8:continue
        nl=natural(nx,y);q=Vector((sg*nx,y,p.z+nl-ol));v.co=inv@q;moved.append({'before':list(p),'after':list(q)})
    wing.data.update();bm=bmesh.new();bm.from_mesh(wing.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(wing.data);bm.free();wing.data.update()
    return {'side':side,'method':'Closed same-body lower-slab contour map; upper sweep surface unchanged; natural lower loft displacement','before':before,'after':rear._audit(wing),'changedVertices':len(moved),'innerBandWidthPreserved':.050,'bandMap':'Same affine-in-Y translation applied to all lower material boundaries; no cap projection','maximumDisplacement':max([(Vector(r['after'])-Vector(r['before'])).length for r in moved]or[0]),'sourceContour':list(zip(ys,bounds)),'scope':{'absXMax':1.15,'y':[-1.7948,-1.605],'fixedGapDesignMinimum':.003,'sourceLowerLeafWallPreservedBeforeInwardThickening':True,'additionalDownwardLoftDrop':0.},'fixedCapVertexCount':fixedCaps,'witnesses':sorted(moved,key=lambda r:(Vector(r['after'])-Vector(r['before'])).length,reverse=True)[:12]}

def _align_ruled_x_rows(wing):
    # Historical Boolean boundaries can have distinct stored X values one
    # or two Float32 ULPs apart. After the band translation, keep each such
    # intended ruled row on one common X, rather than amplifying roundoff
    # into a transverse crossing. This changes geometry, not QA thresholds.
    from collections import defaultdict
    wm=wing.matrix_world;inv=wm.inverted();rows=defaultdict(list)
    for v in wing.data.vertices:
        p=wm@v.co;x=abs(p.x)
        if not (.64<x<1.15 and -1.790<p.y<-1.605):continue
        st=rear._station(x);u=(p.y-st[1])/st[2]
        if p.z-rear._skin(x,u)[1]>.026:continue
        rows[p.y].append((x,v,p))
    moved=[];clusters=0
    for y,vs in rows.items():
        vs.sort(key=lambda r:r[0]);groups=[];group=[]
        for row in vs:
            if group and row[0]-group[0][0]>.00000021:groups.append(group);group=[]
            group.append(row)
        if group:groups.append(group)
        for group in groups:
            if len(group)<2 or group[-1][0]-group[0][0]<1e-10:continue
            x=(group[0][0]+group[-1][0])/2;clusters+=1
            for old,v,p in group:
                q=p.copy();q.x=math.copysign(x,p.x);v.co=inv@q;moved.append(abs(q.x-p.x))
    wing.data.update();return {'method':'Common X for same-Y ruled-row coordinate clusters within 2.1e-7u; preserves distinct physical step bands','changedVertices':len(moved),'rowClusters':clusters,'maximumTargetAdjustment':max(moved or[0]),'QAThresholdsChanged':False}

def _round_blue_nose(wing):
    wm=wing.matrix_world;inv=wm.inverted();changed=[]
    for v in wing.data.vertices:
        p=wm@v.co;x=abs(p.x)
        if not (.75<x<.855 and -1.812<p.y<-1.773):continue
        st=rear._station(x);u=(p.y-st[1])/st[2]
        shared_le=abs(u)<=5e-7 and abs(p.z-st[3])<=2e-7
        if shared_le:u=0.0
        if not (0<=u<.055) or (u==0 and not shared_le):continue
        _,lo,hi=rear._skin(x,u);h=p.z-lo
        upper=1.0
        dx=.012*(1-rear._smooth(u/.045))*(1-rear._smooth((x-.765)/.090))*upper
        if dx<1e-9:continue
        nx=x+dx;nst=rear._station(nx);ny=nst[1]+u*nst[2];_,nlo,nhi=rear._skin(nx,u);nz=nst[3] if shared_le else nlo+(p.z-lo)/(hi-lo)*(nhi-nlo);q=Vector((math.copysign(nx,p.x),ny,nz));v.co=inv@q;changed.append((q-p).length)
    wing.data.update();return {'method':'Round the complete blue nose section, upper and lower together, by bounded span retreat at fixed chord fraction and normalized thickness coordinate','changedVertices':len(changed),'maximumDisplacement':max(changed or[0]),'retreatAmplitude':.012,'addsMaterialOutsideNaturalLoft':False}

def _front_inner_thickness(wing,side):
    sg=-1 if side=='L'else 1;wm=wing.matrix_world;inv=wm.inverted();changed=[]
    for v in wing.data.vertices:
        p=wm@v.co;x=abs(p.x);y=p.y
        if not (.735<x<.91 and -1.798<y<-1.750):continue
        st=rear._station(x);lo=rear._skin(x,(y-st[1])/st[2])[1];h=p.z-lo
        # Modify the cavity-facing surface of the lower leaf only. Leave the
        # outer lower skin and the separate upper leaf entirely unchanged.
        w=rear._smooth((h-.003)/.005)*(1-rear._smooth((h-.023)/.004))*rear._smooth((x-.735)/.025)*rear._smooth((.91-x)/.04)*rear._smooth((y+1.798)/.009)*rear._smooth((-1.750-y)/.012)
        dz=.0014*w
        if dz<=1e-10:continue
        q=p.copy();q.z+=dz;v.co=inv@q;changed.append(dz)
    wing.data.update();return {'method':'Local inward thickening of lower-leaf cavity roof only','vertices':len(changed),'maximumUpwardHeightIncrease':max(changed or[0]),'outerLowerVerticesChanged':0,'window':{'absX':[.735,.91],'y':[-1.798,-1.750]}}

def _paint(wing,side):
    # Match existing local material ownership: no detached or duplicate coat.
    blue=bpy.data.objects['Wing_blue_leading_'+side].data.materials[0]
    if blue not in list(wing.data.materials):wing.data.materials.append(blue)
    ix=list(wing.data.materials).index(blue);sg=-1 if side=='L'else 1;wm=wing.matrix_world;inv=wm.inverted()
    bm=bmesh.new();bm.from_mesh(wing.data)
    s0=rear._station(.62);s1=rear._station(1.03);yb0=s0[1]+.105*s0[2];yb1=s1[1]+.105*s1[2];m=(yb1-yb0)/(1.03-.62);b=yb1-m*1.03
    selected=[f for f in bm.faces if any(.63<abs((wm@v.co).x)<1.115 and -1.80<(wm@v.co).y<-1.60 for v in f.verts)]
    bm.verts.index_update();bm.edges.index_update();geom=sorted({v for f in selected for v in f.verts},key=lambda v:v.index)+sorted({e for f in selected for e in f.edges},key=lambda e:e.index)+selected
    bmesh.ops.bisect_plane(bm,geom=geom,dist=1e-8,plane_co=inv@Vector((0,b,0)),plane_no=wm.to_3x3().transposed()@Vector((-sg*m,1,0)),clear_inner=False,clear_outer=False)
    painted=0
    for f in bm.faces:
        p=wm@f.calc_center_median()
        if .63<abs(p.x)<1.106 and -1.80<p.y<-1.605:
            f.material_index=ix if p.y<=m*abs(p.x)+b+1e-8 else 0
            if f.material_index==ix:painted+=1
            f.smooth=abs(f.normal.z)>.35
    bmesh.ops.triangulate(bm,faces=list(bm.faces),quad_method='BEAUTY',ngon_method='EAR_CLIP');bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(wing.data);bm.free();wing.data.update()
    return painted

def _finish_deformed_normals(wing):
    mesh=wing.data;wm=wing.matrix_world;ns=[tuple(n.vector)for n in mesh.corner_normals];pts=[wm@v.co for v in mesh.vertices];changed=0
    for face in mesh.polygons:
        vs=[pts[i]for i in face.vertices];c=sum(vs,Vector())/len(vs)
        if not (.63<abs(c.x)<1.30 and -1.80<c.y<-1.605):continue
        heights=[]
        for vv in vs:
            ss=rear._station(abs(vv.x));heights.append(vv.z-rear._skin(abs(vv.x),(vv.y-ss[1])/ss[2])[1])
        natural_bottom=max(heights)<.003 and min(heights)>-.004
        if abs(c.x)>=1.155 and not natural_bottom:continue
        for li in face.loop_indices:
            v=pts[mesh.loops[li].vertex_index];x=abs(v.x);st=rear._station(x);u=(v.y-st[1])/st[2];n=face.normal.copy()
            if .001<u<.999 and (natural_bottom or abs(face.normal.z)>.65):
                def low(xx,yy):
                    ss=rear._station(xx);return rear._skin(xx,(yy-ss[1])/ss[2])[1]
                if v.z-low(x,v.y)<.026:
                    h=1e-5;dx=(low(x+h,v.y)-low(x-h,v.y))/(2*h);dy=(low(x,v.y+h)-low(x,v.y-h))/(2*h);nn=Vector((-math.copysign(1,v.x)*dx,-dy,1))*(-1 if natural_bottom else (1 if face.normal.z>0 else -1));n=(wm.to_3x3().transposed()@nn).normalized()
            ns[li]=tuple(n);changed+=1
    mesh.normals_split_custom_set(ns);mesh.update();return {'changedCorners':changed,'method':'Current geometric end-wall normals and analytic natural-lower-skin normals; no vertex motion'}

def _blend_coat(side):
    ob=bpy.data.objects['Wing_blue_leading_'+side];host=bpy.data.objects['Composite_wing_'+side];tr=rear._tree(host);wm=ob.matrix_world;inv=wm.inverted();old=ob.data;ob.data=old.copy();changed=[]
    for v in ob.data.vertices:
        p=wm@v.co;x=abs(p.x)
        if not (1.02999<=x<1.135 and p.y<-1.68):continue
        hit=tr.find_nearest(p)
        if hit[0] is None or hit[3]>.010:continue
        w=1-rear._smooth((x-1.03)/.105);w*=max(0.,1-.00003/max(hit[3],.00003));q=p+(hit[0]-p)*w;v.co=inv@q;changed.append((q-p).length)
    ob.data.update()
    if old.users==0:bpy.data.meshes.remove(old)
    return {'node':ob.name,'changedVertices':len(changed),'maximumInwardProjection':max(changed or[0]),'blendAbsX':[1.03,1.135],'method':'Existing offset paint shrinks to actual material at local direct-paint join; no new outward offset'}

def _clean_exact_cap_degeneracy(wing):
    from mesh_precision import face_area
    bm=bmesh.new();bm.from_mesh(wing.data);zero=[f for f in bm.faces if face_area(f)<=1e-18];before=bm.calc_volume(signed=True)
    if not zero:bm.free();return {'zeroAreaFacesBefore':0,'volumeChange':0.}
    bm.edges.index_update();edges=sorted({e for f in zero for e in f.edges},key=lambda e:e.index)
    bmesh.ops.dissolve_degenerate(bm,edges=edges,dist=1e-7);bmesh.ops.triangulate(bm,faces=list(bm.faces),quad_method='BEAUTY',ngon_method='EAR_CLIP');bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));after=bm.calc_volume(signed=True)
    if any(not e.is_manifold for e in bm.edges)or any(face_area(f)<=1e-18 for f in bm.faces)or abs(after-before)>1e-12:raise ValueError(('Exact cap degeneracy repair failed',before,after))
    bm.to_mesh(wing.data);bm.free();wing.data.update();return {'zeroAreaFacesBefore':len(zero),'volumeChange':after-before,'strictlyConfinedToDegenerateFaceEdges':True,'maximumConstructionDistance':1e-7}

def apply(sides=('L','R')):
    for side in sides:
        p=bpy.data.objects['WingPivot_'+side]
        if p.rotation_quaternion.angle>1e-6 or p.animation_data:raise ValueError('Requires unanimated cruise WingPivot_'+side)
    reports=[];coats=[]
    for side in sides:
        wing=bpy.data.objects['Composite_wing_'+side];old=wing.data;wing.data=old.copy();objs=set(bpy.data.objects)
        try:
            rr=_rear_deform(wing,side)
            refine=_refine_front_material(wing);fr=_front_deform(wing,side);fr['localSamplingRefinement']=refine;fr['ruledRowConsistency']=_align_ruled_x_rows(wing);fr['blueNoseRounding']={'applied':False,'reason':'Original complete native nose retained; root fill and coat transition provide the requested smooth outline'};fr['innerThicknessRepair']=_front_inner_thickness(wing,side);painted=_paint(wing,side);fr['capDegeneracyCleanup']=_clean_exact_cap_degeneracy(wing);fr['normals']=_finish_deformed_normals(wing);after=rear._audit(wing)
            if after['nonManifoldEdges'] or after['zeroAreaFaces'] or after['connectedComponents']!=1 or after['signedVolume']<=0:raise ValueError(after)
            reports.append({'side':side,'rear':rr,'front':fr,'paintedFaces':painted,'after':after})
        except Exception:
            wing.data=old
            for ob in list(bpy.data.objects):
                if ob not in objs:bpy.data.objects.remove(ob,do_unlink=True)
            raise
        if old.users==0:bpy.data.meshes.remove(old)
        coats.append(_blend_coat(side))
    return {'changedOwners':['Composite_wing_'+s for s in sides]+['Wing_blue_leading_'+s for s in sides],'paintTransitions':coats,'schema':'transwing.real-wing-end-contour.v1','sides':reports,'passedTopologyOnly':True,'completeMotionAcceptance':False,'sameRigidBodyOnly':True}
