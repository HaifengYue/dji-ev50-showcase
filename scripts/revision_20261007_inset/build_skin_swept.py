"""原翼外形内的有限双体蒙皮补体；布局试件，必须独立重验材料与运动。"""
from pathlib import Path
import os,sys,runpy,bpy,bmesh,math,json,hashlib
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'qa/revision-20261007-inset';LABEL=os.environ.get('TRANSWING_INSET_LABEL','candidate-detail-inset-skin-i');os.environ['TRANSWING_INSET_LABEL']=LABEL
base=runpy.run_path(str(Path(__file__).with_name('build_layout.py')))
C=base['centers'];A=base['axis'];t0=base['t0'];replace_profile=base['replace_profile'];sys.path.insert(0,str(ROOT/'scripts'));from compact_hinge_enclosure import OUTER,INNER,FIXED_START,MOVING_END
from wing_surfaces import ROOT_LOFT
old_outer=[(2*t-t0,2*r)for t,r in OUTER];old_inner=[(2*t-t0,2*r)for t,r in INNER]
def interp(profile,t):
 for a,b in zip(profile,profile[1:]):
  if a[0]-1e-10<=t<=b[0]+1e-10:
   if abs(b[0]-a[0])<1e-12:return max(a[1],b[1])
   return a[1]+(b[1]-a[1])*(t-a[0])/(b[0]-a[0])
 return profile[0][1]if t<profile[0][0]else profile[-1][1]
def smooth(t):t=max(0.,min(1.,t));return t*t*(3-2*t)
def boolean(obj,cutter,kind):
 bpy.context.view_layer.update();bpy.context.view_layer.objects.active=obj;m=obj.modifiers.new('有限闭合包覆','BOOLEAN');m.operation=kind;m.solver='EXACT';m.object=cutter;bpy.ops.object.modifier_apply(modifier=m.name)
def temp_revolve(name,side,profile):
 mesh=bpy.data.meshes.new(name);obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);obj.data.materials.append(bpy.data.objects['Composite_wing_'+side].data.materials[0]);replace_profile(name,side,profile);return obj
def station(x):
 for a,b in zip(ROOT_LOFT,ROOT_LOFT[1:]):
  if a[0]<=x<=b[0]:
   u=(x-a[0])/(b[0]-a[0]);s=[p+(q-p)*u for p,q in zip(a,b)];return s[1]-1.3,s[2],s[3]-.22,s[4]
 raise ValueError(x)
def stock(side,fixed=False):
 sg=-1 if side=='L'else 1;nx,ny=52,66;vs=[];fs=[]
 for layer in [0,1]:
  for i in range(nx+1):
   x=1.15+.65*i/nx;le,ch,z,ratio=station(x)
   for j in range(ny+1):
    u=.08+.67*j/ny;t=5*ratio*ch*(.2969*math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1036*u**4);vs.append((sg*x,le+ch*u,z+(t-.00015 if layer else (t-.0138 if fixed else -t+.00015))))
 n=(nx+1)*(ny+1)
 if fixed:
  assert all(abs(vs[k+n][2]-vs[k][2]-.01365)<1e-9 for k in range(n)), 'Central thin-skin rule regressed'
 for i in range(nx):
  for j in range(ny):a=i*(ny+1)+j;b=a+ny+1;fs.extend([(a,a+1,b+1,b),(a+n,b+n,b+1+n,a+1+n)])
 ring=list(range(ny+1))+[i*(ny+1)+ny for i in range(1,nx+1)]+[nx*(ny+1)+j for j in range(ny-1,-1,-1)]+[i*(ny+1)for i in range(nx-1,0,-1)]
 for a,b in zip(ring,ring[1:]+ring[:1]):fs.append((a,b,b+n,a+n))
 mesh=bpy.data.meshes.new('NaturalWingStock_'+side);mesh.from_pydata(vs,[],fs);mesh.update();bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bmesh.ops.triangulate(bm,faces=list(bm.faces));assert all(e.is_manifold for e in bm.edges);bm.to_mesh(mesh);bm.free();obj=bpy.data.objects.new('TemporaryNaturalWingStock_'+side,mesh);bpy.context.collection.objects.link(obj);return obj
# The fixed rear mount is an axial stem wholly inside the original wing envelope.
for side in ['L','R']:replace_profile('RootFixedBearingPedestal_'+side,side,[(.0104,0),(.0104,.0314),(.012,.0314),(.020,.0055),(.059,.0055),(.059,0)])

profile_overrides={}
for side in ['L','R']:
 name='RootHingeShaft_'+side;profile_overrides[name]=[(-.0145,0),(-.0145,.028),(.020,.028),(.020,0)];replace_profile(name,side,profile_overrides[name])
 name='RootHingeEndcap_'+side+'-0.148';profile_overrides[name]=[(-t,r)for t,r in[(.0104,0),(.0104,.0314),(.0136,.0314),(.0148,.0265),(.0148,0)]];replace_profile(name,side,profile_overrides[name])
 bpy.data.objects['RootAxisStart_'+side].matrix_world.translation=C[side]+A[side]*(-.0145)

def envelope_profile(side,owner):
 rows=json.loads((OUT/(LABEL+'-construction.json')).read_text())['hardware'];profiles=[]
 for row in rows:
  name=row['node']
  if not(name.endswith('_'+side)or('_'+side+'_')in name or name.startswith('RootHingeEndcap_'+side)):continue
  obj=bpy.data.objects[name];moving=False;q=obj
  while q:
   if q.name=='WingPivot_'+side:moving=True;break
   q=q.parent
  if moving==(owner=='moving'):continue # own-owner material is intentionally not hollowed away
  profile=profile_overrides.get(name,row['profileTR'])
  if name=='RootFixedBearingPedestal_'+side:profile=[(.0104,0),(.0104,.0314),(.012,.0314),(.020,.0055),(.059,.0055),(.059,0)]
  tr={}
  for t,r in profile:tr[t]=max(tr.get(t,0),r)
  profiles.append(sorted(tr.items()))
 d=.0032;ta=min(p[0][0]for p in profiles)-d;tb=max(p[-1][0]for p in profiles)+d;nt=math.ceil((tb-ta)/.0001);knots=sorted(set([ta+(tb-ta)*i/nt for i in range(nt+1)]+[t+delta for p in profiles for t,r in p for delta in [-d,0,d]if ta<=t+delta<=tb]));result=[]
 for t in knots:
  radius=0.
  for p in profiles:
   for a,b in zip(p,p[1:]):
    low=max(a[0],t-d);high=min(b[0],t+d)
    if low>high+1e-12:continue
    if low>high:low=high=(low+high)/2
    slope=(b[1]-a[1])/(b[0]-a[0]);s=max(low,min(high,t+slope*d/math.sqrt(1+slope*slope)));r=a[1]+slope*(s-a[0])+math.sqrt(max(0,d*d-(t-s)**2));radius=max(radius,r)
  radius=(radius+.00021)/math.cos(math.pi/96)
  if len(result)>1:
   a,b=result[-2:];cross=(b[0]-a[0])*(radius-b[1])-(b[1]-a[1])*(t-b[0])
   if abs(cross)<1e-12:result.pop()
  if result and t-result[-1][0]<2e-7:
   result[-1]=(result[-1][0],max(radius,result[-1][1]));continue
  result.append((t,radius))
 return [(result[0][0],0)]+result+[(result[-1][0],0)]
def original_partition(side,fixed):
 from annotated_tail_partition import build_partition
 from mathutils import Matrix
 sg=-1 if side=='L'else 1
 def wing_station(stations,x):
  le,ch,z,ratio=station(min(2.,max(.27,abs(x))));return (x,le,ch,z,ratio)
 def airfoil_point(st,u,upper):
  x,le,ch,z,ratio=st;t=5*ratio*ch*(.2969*math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1036*u**4)
  return (x,le+ch*u,z+(t if upper else -t))
 def mesh_object(name,vs,fs,mat,parent,smooth):
  mesh=bpy.data.meshes.new(name);mesh.from_pydata(vs,[],fs);mesh.update();obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
  if parent:obj.parent=parent;obj.matrix_parent_inverse=Matrix.Identity(4)
  return obj
 return build_partition({'wing_station':wing_station,'airfoil_point':airfoil_point,'mesh_object':mesh_object},side,sg,fixed,None,bpy.data.objects['WingPivot_'+side])

def topology(obj):
 bm=bmesh.new();bm.from_mesh(obj.data);result={'vertices':len(bm.verts),'faces':len(bm.faces),'nonManifoldEdges':sum(not e.is_manifold for e in bm.edges),'zeroAreaFaces':sum(f.calc_area()<1e-14 for f in bm.faces)};bm.free();return result
rows=[]
for side in ['L','R']:
 for owner,host_name in [('moving','Composite_wing_'+side),('fixed','Fixed_root_'+side)]:
  template=stock(side,owner=='fixed')
  # Remove the complete old perforated area. The cut rim is outside the old cavity,
  # so none of the pathological old aperture triangles participates in the union.
  cut_lo,cut_hi,cut_r=-.041,.126,.108
  lo,hi=cut_lo-.0015,cut_hi+.0015
  radius=cut_r+.0015
  fill=temp_revolve('Temporary_'+owner+'_skin_'+side,side,[(lo,0),(lo,radius),(hi,radius),(hi,0)])
  boolean(fill,template,'INTERSECT');stages={'naturalPatch':topology(fill)}
  partition=original_partition(side,owner=='fixed');boolean(fill,partition,'INTERSECT'if owner=='fixed'else'DIFFERENCE');bpy.data.objects.remove(partition,do_unlink=True);stages['continuousOriginalPartition']=topology(fill)
  cavity=temp_revolve('Temporary_'+owner+'_hardware_clearance_'+side,side,envelope_profile(side,owner));stages['cavityTool']=topology(cavity)
  boolean(fill,cavity,'DIFFERENCE');stages['hollowPatch']=topology(fill);bpy.data.objects.remove(cavity,do_unlink=True)
  host=bpy.data.objects[host_name]
  excision=temp_revolve('TemporaryWholeOldAperture_'+owner+'_'+side,side,[(cut_lo,0),(cut_lo,cut_r),(cut_hi,cut_r),(cut_hi,0)])
  boolean(host,excision,'DIFFERENCE');stages['excisedHost']=topology(host);bpy.data.objects.remove(excision,do_unlink=True)
  boolean(host,fill,'UNION');stages['union']=topology(host);bpy.data.objects.remove(fill,do_unlink=True)
  bm=bmesh.new();bm.from_mesh(host.data)
  selected=[]
  for v in bm.verts:
   q=host.matrix_world@v.co-C[side];t=q.dot(A[side]);r=(q-A[side]*t).length
   if cut_lo-.003<t<cut_hi+.003 and r<cut_r+.003:selected.append(v)
  bmesh.ops.remove_doubles(bm,verts=selected,dist=1.25e-7)
  edges=[e for e in bm.edges if all(v in selected for v in e.verts)]
  bmesh.ops.dissolve_degenerate(bm,dist=1e-8,edges=edges)
  bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bad=sum(not e.is_manifold for e in bm.edges);vol=bm.calc_volume(signed=True);bm.to_mesh(host.data);bm.free();host.data.update()
  rows.append({'owner':owner,'host':host_name,'stages':stages,'excisionAxisTR':[cut_lo,cut_hi,cut_r],'nonManifoldEdges':bad,'volume':vol,'tDomain':[lo,hi],'originalWingNaturalEnvelopeInset':.00015,'centralFixedThicknessRule':.014 if owner=='fixed'else None,'fixedLowerNumericalInset':.0002 if owner=='fixed'else None,'hardwareCavityOffset':.0032,'radialDiscretizationGuard':.00021})
  bpy.data.objects.remove(template,do_unlink=True)

sys.path.insert(0,str(Path(__file__).parent))
from relieve_local_sweep import build as relief
from finish_local_normals import finish
sweep_rows=[];normal_rows=[]
for side in ['L','R']:
 sweep_rows.append(relief(side,C[side],A[side],boolean,temp_revolve))
 for stem in ['Composite_wing_','Fixed_root_']:normal_rows.append(finish(bpy.data.objects[stem+side],C[side],A[side]))

bpy.context.view_layer.update();scene=bpy.context.scene;scene['insetSkinTrial']='natural envelope bounded two-owner fill, full motion unverified';dest=ROOT/'qa/revision-20261007'/(LABEL+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(dest));(OUT/(LABEL+'-skin.json')).write_text(json.dumps({'sourceRecipe':'reconstruct layout then fill the former axisymmetric enclosure volume within the original natural wing envelope','candidate':LABEL,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'rows':rows,'sweepRelief':sweep_rows,'localNormalRepair':normal_rows,'shortenedNegativeHardwareProfiles':profile_overrides,'frontPodOriginalGeometryPreserved':True,'bodyAndHardwareMotionAccepted':False,'rootCornerSmoothingCompleted':False},ensure_ascii=False,indent=2));print('SKIN',json.dumps(rows),flush=True)
