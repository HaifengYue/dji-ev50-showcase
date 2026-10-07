"""仅重建本轮局部实体的表面法线；记录坐标不变，真实侧壁保留几何法线。"""
import math,hashlib,json
from mathutils import Vector
from wing_surfaces import ROOT_LOFT

def finish(obj,center,axis):
 mesh=obj.data
 before=hashlib.sha256(b''.join(__import__('struct').pack('<3f',*v.co)for v in mesh.vertices)).hexdigest()
 def height(x,y,top):
  for a,b in zip(ROOT_LOFT,ROOT_LOFT[1:]):
   if a[0]<=x<=b[0]:
    f=(x-a[0])/(b[0]-a[0]);v=[q+(r-q)*f for q,r in zip(a,b)];le,ch,z,ratio=v[1]-1.3,v[2],v[3]-.22,v[4];u=max(.000001,min(.999999,(y-le)/ch));th=5*ratio*ch*(.2969*math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1036*u**4);return z+(th if top else -th)
  raise ValueError(x)
 world=[obj.matrix_world@v.co for v in mesh.vertices];normals=[tuple(n.vector)for n in mesh.corner_normals];modified=0;skin=0;wall=0
 for p in mesh.polygons:
  pts=[world[i]for i in p.vertices]
  def inside(v):
   q=v-center;t=q.dot(axis);return -.045<t<.130 and(q-axis*t).length<.113
  if not any(inside(v)for v in pts):continue
  mean=sum(v.z for v in pts)/len(pts);top=mean>-.22
  natural=all(abs(v.z-height(abs(v.x),v.y,top))<.0005 for v in pts)
  for li in p.loop_indices:
   n=p.normal.copy()
   if natural:
    v=world[mesh.loops[li].vertex_index];x=abs(v.x);h=1e-5;dx=(height(x+h,v.y,top)-height(x-h,v.y,top))/(2*h);dy=(height(x,v.y+h,top)-height(x,v.y-h,top))/(2*h);nw=Vector((-math.copysign(1,v.x)*dx,-dy,1))*(1 if top else -1);n=(obj.matrix_world.to_3x3().transposed()@nw).normalized();skin+=1
   else:wall+=1
   normals[li]=tuple(n);modified+=1
 mesh.normals_split_custom_set(normals);mesh.update()
 after=hashlib.sha256(b''.join(__import__('struct').pack('<3f',*v.co)for v in mesh.vertices)).hexdigest();assert before==after
 return {'node':obj.name,'changedCorners':modified,'naturalSkinCorners':skin,'geometricWallCorners':wall,'vertexCoordinatesSha256':before,'geometryUnchanged':True,'axisDomain':[-.045,.130],'maximumRadius':.113}
