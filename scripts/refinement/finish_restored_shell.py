"""Restore only reconstructed shell shading from same-native analytic skin normals."""
import bpy,math,numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree

def fit_native_derivatives(body,stations):
 kd=KDTree(len(body.data.vertices));loops={v.index:[]for v in body.data.vertices}
 for v in body.data.vertices:kd.insert(v.co,v.index)
 kd.balance();ns=[n.vector.copy()for n in body.data.corner_normals]
 for i,l in enumerate(body.data.loops):loops[l.vertex_index].append(ns[i])
 records=[]
 for s in stations:
  eq=[];rhs=[]
  for sign in [-1,1]:
   for k in range(1,16):
    t=k*math.pi/32;co=math.cos(t);sn=math.sin(t);p=Vector((sign*s['width']*co**.83,s['y'],s['centerZ']+s['halfHeight']*sn**.84));pt,ix,d=kd.find(p)
    if d>1e-7:continue
    radial=Vector((sign*co,0,sn));candidates=[n for n in loops[ix]if n.length>.5 and n.dot(radial)>.4]
    if not candidates:continue
    n=max(candidates,key=lambda n:n.dot(radial));eq.append([n.x*sign*co**.83,n.z,n.z*sn**.84]);rhs.append(-n.y)
  a=np.asarray(eq);b=np.asarray(rhs);coef,res,rank,sv=np.linalg.lstsq(a,b,rcond=None);error=float(np.max(np.abs(a@coef-b)));assert rank==3 and error<.025 and max(abs(coef))<1.0,(s['y'],error,coef)
  records.append({'y':s['y'],'widthDerivative':float(coef[0]),'centerDerivative':float(coef[1]),'heightDerivative':float(coef[2]),'samples':len(eq),'normalEquationMaxResidual':error})
 return records

def analytic_normal(s,d,k,sign,inner):
 t=max(1e-7,min(math.pi/2-1e-7,k*math.pi/32));co=math.cos(t);sn=math.sin(t)
 # Lower half, parameter t positive downwards.
 xt=-sign*s['width']*.83*co**(-.17)*sn;zt=-s['halfHeight']*.65*sn**(-.35)*co
 if inner:xt+=sign*.006*sn;zt+=.006*co
 xy=sign*d['widthDerivative']*co**.83;zy=d['centerDerivative']-d['heightDerivative']*sn**.65
 normal=Vector((-sign*zt,sign*(xy*zt-zy*xt),sign*xt)).normalized()
 return -normal if inner else normal

def make_reference(vertices,faces,normals):
 return {'points':[Vector(p)for p in vertices],'triangles':faces,'normals':normals,'tree':BVHTree.FromPolygons(vertices,faces,all_triangles=True)}

def bary(p,a,b,c):
 u=b-a;v=c-a;w=p-a;uu=u.dot(u);uv=u.dot(v);vv=v.dot(v);wu=w.dot(u);wv=w.dot(v);den=uu*vv-uv*uv
 if abs(den)<1e-25:return(1.,0.,0.)
 b0=(vv*wu-uv*wv)/den;c0=(uu*wv-uv*wu)/den;return(1-b0-c0,b0,c0)

def apply_restored_normals(body,references):
 normals=[n.vector.copy()for n in body.data.corner_normals];changed=0;polygons=0
 for f in body.data.polygons:
  p=f.center
  if not(.0919<abs(p.x)<.4081 and .3979<p.y<1.9691 and -.3001<p.z<.1061):continue
  best=None
  for ref in references:
   hit,no,ix,dis=ref['tree'].find_nearest(p)
   if hit is None or dis>3e-7 or abs(f.normal.dot(no))<.9:continue
   if best is None or dis<best[0]:best=(dis,ref)
  if best is None:continue
  ref=best[1];f.use_smooth=True;polygons+=1
  for li in f.loop_indices:
   point=body.data.vertices[body.data.loops[li].vertex_index].co;hit,no,ix,dis=ref['tree'].find_nearest(point);ids=ref['triangles'][ix];aa,bb,cc=[ref['points'][i]for i in ids];weights=bary(hit,aa,bb,cc);n=sum((ref['normals'][i]*w for i,w in zip(ids,weights)),Vector()).normalized();normals[li]=n;changed+=1
 body.data.normals_split_custom_set(normals);body.data.update();bad=sum(not math.isfinite(n.vector.length)or n.vector.length<.5 for n in body.data.corner_normals);assert bad==0,bad
 return {'method':'Same-native upper-skin normal field fit for existing loft derivatives; analytic lower-skin corner interpolation only on reconstructed patch faces','patchedPolygons':polygons,'patchedCorners':changed,'geometryChangedByNormalFinish':False,'invalidCornerNormals':bad,'skinCutWallBoundariesRemainSplit':True}
