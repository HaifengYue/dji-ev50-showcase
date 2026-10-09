import numpy as np

def normalized_plane(t):
 n=np.cross(t[1]-t[0],t[2]-t[0]);a=float(np.linalg.norm(n));return (n/a,a*.5) if a>1e-24 else (n,0.)
def unique(ps,tol=1e-10):
 out=[]
 for p in ps:
  if not any(np.linalg.norm(p-q)<tol for q in out):out.append(p)
 return out

def plane_section(t,d,eps=1e-12):
 out=[t[i].copy() for i in range(3) if abs(d[i])<=eps]
 for i in range(3):
  j=(i+1)%3
  if (d[i]<-eps and d[j]>eps)or(d[i]>eps and d[j]<-eps):out.append(t[i]+d[i]/(d[i]-d[j])*(t[j]-t[i]))
 return unique(out)

def bary(t,p):
 a=t[1]-t[0];b=t[2]-t[0];v=p-t[0];aa=a@a;bb=b@b;ab=a@b;den=aa*bb-ab*ab
 if abs(den)<1e-30:return np.array([float('nan')]*3)
 u=(bb*(v@a)-ab*(v@b))/den;w=(aa*(v@b)-ab*(v@a))/den;return np.array([1-u-w,u,w])

def clip_polygon(A,B):
 def cross(a,b):return a[0]*b[1]-a[1]*b[0]
 orient=1 if cross(B[1]-B[0],B[2]-B[0])>=0 else -1
 poly=[x.copy()for x in A]
 for i in range(3):
  if not poly:break
  p=B[i];q=B[(i+1)%3];out=[];s=poly[-1];ds=orient*cross(q-p,s-p)
  for e in poly:
   de=orient*cross(q-p,e-p)
   if de>=-1e-15:
    if ds<-1e-15:out.append(s+(e-s)*ds/(ds-de))
    out.append(e)
   elif ds>=-1e-15:out.append(s+(e-s)*ds/(ds-de))
   s=e;ds=de
  poly=out
 return unique(poly,1e-12)

def classify(A,B):
 A=np.asarray(A,dtype=np.float64);B=np.asarray(B,dtype=np.float64);nA,aA=normalized_plane(A);nB,aB=normalized_plane(B)
 out={'areaA':aA,'areaB':aB,'sharedCoordinatePairs':[[i,j]for i in range(3)for j in range(3)if np.linalg.norm(A[i]-B[j])<=1e-10]}
 if min(aA,aB)<1e-18:return out|{'class':'degenerate_triangle'}
 da=(A-B[0])@nB;db=(B-A[0])@nA;cross=np.cross(nA,nB);sine=float(np.linalg.norm(cross));md=max(np.max(np.abs(da)),np.max(np.abs(db)))
 out|={'normalSine':sine,'AtoPlaneB':da.tolist(),'BtoPlaneA':db.tolist(),'maxPlaneDistance':float(md)}
 if sine<1e-8 and md<1e-10:
  k=int(np.argmax(np.abs(nA)));ix=[i for i in range(3) if i!=k];poly=clip_polygon(A[:,ix],B[:,ix]);area=0.
  if len(poly)>=3:area=abs(sum(p[0]*q[1]-p[1]*q[0]for p,q in zip(poly,poly[1:]+poly[:1])))*.5/abs(nA[k])
  out|={'coplanarOverlapArea':float(area),'projectedIntersectionPolygon':[x.tolist()for x in poly]}
  if area>1e-14:return out|{'class':'coplanar_area_overlap'}
  return out|{'class':'coplanar_edge_or_point_contact'if poly else 'coplanar_disjoint'}
 if (np.min(da)>1e-12 or np.max(da)<-1e-12 or np.min(db)>1e-12 or np.max(db)<-1e-12):
  return out|{'class':'separated_planes','nearCoplanarWithin1e7':bool(md<1e-7)}
 if sine<1e-12:return out|{'class':'parallel_tolerance_contact'}
 pa=plane_section(A,da);pb=plane_section(B,db)
 if not pa or not pb:return out|{'class':'no_plane_section'}
 axis=cross/sine;origin=pa[0];sa=sorted(float((p-origin)@axis)for p in pa);sb=sorted(float((p-origin)@axis)for p in pb);lo=max(sa[0],sb[0]);hi=min(sa[-1],sb[-1]);length=hi-lo
 if length<-1e-10:return out|{'class':'disjoint_line_intervals','intervalGap':float(-length)}
 pp=origin+axis*lo;qq=origin+axis*hi;mid=(pp+qq)/2;ba=bary(A,mid);bb=bary(B,mid)
 out|={'segment':[pp.tolist(),qq.tolist()],'segmentLength':float(max(0,length)),'midpoint':mid.tolist(),'midpointBarycentricA':ba.tolist(),'midpointBarycentricB':bb.tolist()}
 penA=float(min(max(0.,-np.min(da)),max(0.,np.max(da))));penB=float(min(max(0.,-np.min(db)),max(0.,np.max(db))));out|={'planeStraddleDepthA':penA,'planeStraddleDepthB':penB}
 # World-space distance to the boundary for the midpoint (barycentric * altitude).
 edgesA=np.linalg.norm(np.array([A[2]-A[1],A[0]-A[2],A[1]-A[0]]),axis=1);edgesB=np.linalg.norm(np.array([B[2]-B[1],B[0]-B[2],B[1]-B[0]]),axis=1)
 marginA=float(np.min(ba*2*aA/edgesA));marginB=float(np.min(bb*2*aB/edgesB));out|={'midpointEdgeMarginA':marginA,'midpointEdgeMarginB':marginB}
 if length>1e-10 and min(marginA,marginB)>1e-10 and min(penA,penB)>1e-12:
  return out|{'class':'proper_transverse_crossing','robustOver1e7':bool(min(length,marginA,marginB,penA,penB)>1e-7)}
 return out|{'class':'edge_or_point_contact_or_subtolerance_crossing'}
