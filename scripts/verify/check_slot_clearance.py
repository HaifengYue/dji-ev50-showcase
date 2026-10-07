"""Finite-pose exact triangle distance screen, with conservative expanded AABBs."""
from pathlib import Path
import bpy,sys,json,math,hashlib,argparse,time
import numpy as np
from mathutils import Quaternion,Vector
args=sys.argv[sys.argv.index('--')+1:]if '--'in sys.argv else[];p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--expected-sha');p.add_argument('--contract',type=Path,default=Path(__file__).with_name('current-linkage-qa-contract.json'));p.add_argument('--step',type=float,default=.25);o=p.parse_args(args);sha=hashlib.sha256(o.source.read_bytes()).hexdigest()
if o.expected_sha and sha!=o.expected_sha:raise ValueError('SHA mismatch')
sys.path.insert(0,str(Path(__file__).resolve().parent));import native_contract_qa as kin
bpy.ops.wm.open_mainfile(filepath=str(o.source));kin.configure(json.loads(o.contract.read_text()))
for ob in bpy.data.objects:ob.animation_data_clear()
kin.hydrate_final_mechanism()

def tris(obj):
 obj.data.calc_loop_triangles();mat=np.asarray(obj.matrix_world,dtype=np.float64);pts=np.asarray([v.co[:]for v in obj.data.vertices],dtype=np.float64)@mat[:3,:3].T+mat[:3,3];return pts[np.asarray([t.vertices[:]for t in obj.data.loop_triangles])]

def point_seg(p,a,b):
 ab=b-a;den=np.einsum('...i,...i->...',ab,ab);t=np.clip(np.einsum('...i,...i->...',p-a,ab)/np.maximum(den,1e-40),0,1);q=a+t[...,None]*ab;return np.einsum('...i,...i->...',p-q,p-q)

def point_tri(p,t):
 a=t[:,0];b=t[:,1];c=t[:,2];u=b-a;v=c-a;w=p-a;n=np.cross(u,v);den=np.einsum('ij,ij->i',n,n);signed=np.einsum('ij,ij->i',w,n);proj=p-(signed/np.maximum(den,1e-40))[:,None]*n;ww=proj-a;vb=np.einsum('ij,ij->i',np.cross(ww,v),n)/np.maximum(den,1e-40);vc=np.einsum('ij,ij->i',np.cross(u,ww),n)/np.maximum(den,1e-40);inside=(vb>=0)&(vc>=0)&(vb+vc<=1);edge=np.minimum(np.minimum(point_seg(p,a,b),point_seg(p,b,c)),point_seg(p,c,a));return np.where(inside,signed*signed/np.maximum(den,1e-40),edge)

def seg_seg(a,b,c,d):
 # Infinite-line closest solution is admitted only inside both segments;
 # otherwise one endpoint realizes the exact constrained segment minimum.
 u=b-a;v=d-c;w=a-c;aa=np.einsum('ij,ij->i',u,u);bb=np.einsum('ij,ij->i',u,v);cc=np.einsum('ij,ij->i',v,v);dd=np.einsum('ij,ij->i',u,w);ee=np.einsum('ij,ij->i',v,w);den=aa*cc-bb*bb;valid=den>1e-30;s=np.divide(bb*ee-cc*dd,den,out=np.zeros_like(den),where=valid);t=np.divide(aa*ee-bb*dd,den,out=np.zeros_like(den),where=valid);valid&=(s>=0)&(s<=1)&(t>=0)&(t<=1);delta=w+s[:,None]*u-t[:,None]*v;interior=np.einsum('ij,ij->i',delta,delta);end=np.minimum(np.minimum(point_seg(a,c,d),point_seg(b,c,d)),np.minimum(point_seg(c,a,b),point_seg(d,a,b)));return np.where(valid,np.minimum(interior,end),end)

def distances(a,b):
 q=np.full(len(a),np.inf)
 for i in range(3):q=np.minimum(q,point_tri(a[:,i],b));q=np.minimum(q,point_tri(b[:,i],a))
 for i in range(3):
  for j in range(3):q=np.minimum(q,seg_seg(a[:,i],a[:,(i+1)%3],b[:,j],b[:,(j+1)%3]))
 return np.sqrt(np.maximum(q,0))
body=tris(bpy.data.objects['Fuselage']);blo=body.min(1);bhi=body.max(1);radius=.008
# Explicit scope: all hull triangles that could be involved with forward slot
# material, including retained skin and cut edge. AABB culls remain conservative.
mask=(((bhi[:,0]>=.12)&(blo[:,0]<=.26))|((bhi[:,0]>=-.26)&(blo[:,0]<=-.12)))&(bhi[:,1]>=.40)&(blo[:,1]<=.85)&(bhi[:,2]>=-.10)&(blo[:,2]<=.11);ids=np.nonzero(mask)[0];bt=body[mask];bl=blo[mask];bh=bhi[mask]
names=[ob.name for ob in bpy.data.objects if ob.type=='MESH'and(ob.parent and ob.parent.name in ['BraceRod_R','BraceRod_L','BraceSpreader'])];rows=[];near=[];globalmin=None;newmin=None;pairs_count=0;t0=time.time()
for i in range(round(120/o.step)+1):
 angle=i*o.step
 for s,sg in [('L',-1),('R',1)]:bpy.data.objects['WingPivot_'+s].rotation_quaternion=Quaternion(Vector((-sg,-1,1)).normalized(),sg*math.radians(angle))
 bpy.context.view_layer.update();kin.update_linkage()
 for name in names:
  at=tris(bpy.data.objects[name]);al=at.min(1);ah=at.max(1);valid=(((ah[:,0]>=.12-radius)&(al[:,0]<=.26+radius))|((ah[:,0]>=-.26-radius)&(al[:,0]<=-.12+radius)))&(ah[:,1]>=.40-radius)&(al[:,1]<=.85+radius)&(ah[:,2]>=-.10-radius)&(al[:,2]<=.11+radius);aids=np.nonzero(valid)[0];aa=at[valid];alo=al[valid];ahi=ah[valid]
  if not len(aa):continue
  delta=np.maximum(0,np.maximum(bl[None,:,:]-ahi[:,None,:],alo[:,None,:]-bh[None,:,:]));aix,bix=np.nonzero(np.einsum('ijk,ijk->ij',delta,delta)<=radius*radius)
  if not len(aix):continue
  ds=distances(aa[aix],bt[bix]);pairs_count+=len(ds);mi=int(ds.argmin());record={'distance':float(ds[mi]),'angle':angle,'owner':name,'movingTriangle':int(aids[aix[mi]]),'hullTriangle':int(ids[bix[mi]]),'hullTrianglePoints':bt[bix[mi]].tolist()}
  if globalmin is None or record['distance']<globalmin['distance']:globalmin=record
  # Newly extended aperture is ahead of original old local tip Y=.7221376.
  newmask=bt[bix].max(1)[:,1]<.7221375
  if np.any(newmask):
   ni=np.nonzero(newmask)[0][np.argmin(ds[newmask])];nr={'distance':float(ds[ni]),'angle':angle,'owner':name,'movingTriangle':int(aids[aix[ni]]),'hullTriangle':int(ids[bix[ni]]),'hullTrianglePoints':bt[bix[ni]].tolist()}
   if newmin is None or nr['distance']<newmin['distance']:newmin=nr
  for ix in np.nonzero(ds<.004)[0]:near.append({'distance':float(ds[ix]),'angle':angle,'owner':name,'movingTriangle':int(aids[aix[ix]]),'hullTriangle':int(ids[bix[ix]]),'hullYSpan':[float(bl[bix[ix],1]),float(bh[bix[ix],1])]})
 if i%80==0:print('POSE',angle,'pairs',pairs_count,'below004',len(near),'minimum',globalmin and globalmin['distance'],'elapsed',time.time()-t0,flush=True)
res={'sourceSha256':sha,'samples':round(120/o.step)+1,'stepDegrees':o.step,'requiredClearance':.004,'conservativeAabbDistanceRadius':radius,'exactTrianglePairChecks':pairs_count,'minimumInForwardSlotDomain':globalmin,'minimumAheadOfOriginalTip':newmin,'pairsBelow004':near,'testMethod':'Double-precision minimum of all six vertex-triangle and nine edge-edge distances for every triangle pair with Euclidean AABB separation <=.008. Full surface-intersection scan is a separate mandatory test. Omitted pairs have lower bound >.008.','domain':'Both-side hull candidate AABBs abs(X)[.12,.26],Y[.40,.85],Z[-.10,.11]; new extension defined conservatively by complete hull triangle Ymax<.7221375; preserved old-slot contacts reported separately by their explicit triangle Y spans.','notContinuousMotionProof':True,'passedAllForwardDomain004':not near,'passedForwardNewExtension004':newmin is None or newmin['distance']>=.004};o.output.parent.mkdir(parents=True,exist_ok=True);o.output.write_text(json.dumps(res,indent=2));print(json.dumps({k:v for k,v in res.items()if k!='pairsBelow004'},indent=2),flush=True)

if not res['passedAllForwardDomain004']:raise SystemExit('Finite forward-slot triangle clearance below .004')
