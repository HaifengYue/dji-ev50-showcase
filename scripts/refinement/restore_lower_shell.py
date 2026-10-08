"""Recover bounded native lower-shell cells from their retained same-file lattice.
No older model is used. Original 64-angle superellipse station parameters are
fitted to retained native Float32 coordinates and separately reported.
"""
import bpy,bmesh,json,math
from pathlib import Path
from mathutils import Vector
from mathutils.kdtree import KDTree
from finish_restored_shell import fit_native_derivatives,analytic_normal,make_reference,apply_restored_normals
_NREF=[]

def volume(o):
 bm=bmesh.new();bm.from_mesh(o.data);v=bm.calc_volume(signed=True);closed=all(e.is_manifold for e in bm.edges);bm.free();return v,closed

def boolean(a,b,op):
 bpy.context.view_layer.update();m=a.modifiers.new('Bounded reconstructed side skin '+op,'BOOLEAN');m.operation=op;m.solver='EXACT';m.use_hole_tolerant=True;m.use_self=False;m.object=b;bpy.context.view_layer.objects.active=a;bpy.ops.object.modifier_apply(modifier=m.name);me=b.data;bpy.data.objects.remove(b,do_unlink=True)
 if not me.users:bpy.data.meshes.remove(me)

def mesh(name,v,f):
 me=bpy.data.meshes.new(name);me.from_pydata(v,[],f);me.update();bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free();o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);return o

def patch_shell():
 global _NREF
 _NREF=[]
 body=bpy.data.objects['Fuselage'];data=json.loads(Path(__file__).with_name('lower-shell-stations.json').read_text());ss=data['stations'];derivatives=fit_native_derivatives(body,ss);kd=KDTree(len(body.data.vertices));
 for i,v in enumerate(body.data.vertices):kd.insert(v.co,i)
 kd.balance();body.data.calc_loop_triangles();edges={tuple(sorted((a,b)))for t in body.data.loop_triangles for a,b in zip(t.vertices,list(t.vertices[1:])+[t.vertices[0]])};before=volume(body)[0];snap_count=0;max_snap=0;receipts=[];patches=[]
 for sign in [-1,1]:
  verts=[];sourceids=[];f=[];n=17;ny=len(ss)
  for inner in [0,1]:
   for s in ss:
    for k in range(n):
     t=k*math.pi/32;c=math.cos(t);sn=math.sin(t);x=s['width']*max(c,0)**.83-inner*.006*c;z=s['centerZ']-s['halfHeight']*sn**.65+inner*.006*sn;p=Vector((sign*x,s['y'],z));old,ix,d=kd.find(p)
     if d<1e-7:p=old.copy();snap_count+=1;max_snap=max(max_snap,d);sourceids.append(ix)
     else:sourceids.append(None)
     # Coplanar Boolean protection: this recovered patch stays strictly
     # inside surviving native skin. Existing original outer faces win union.
     radial=Vector((sign*c,0,-sn));p+=radial*(1e-5 if inner else -1e-5)
     verts.append(tuple(p))
  size=n*ny
  for inner in [0,1]:
   off=inner*size
   for j in range(ny-1):
    for k in range(n-1):
     a=off+j*n+k;b=a+1;c=a+n;d=c+1
     sd=(sourceids[a],sourceids[d]);back=(sourceids[b],sourceids[c]);usead=None not in sd and tuple(sorted(sd))in edges
     if usead:f.extend([(a,b,d),(a,d,c)])
     else:f.extend([(a,b,c),(b,d,c)])
  # Store exact patch triangles plus smooth analytic source-derived normals.
  for inner in [0,1]:
   off=inner*size;vpart=verts[off:off+size];fpart=[tuple(i-off for i in face)for face in f if all(off<=i<off+size for i in face)];normals=[analytic_normal(st,df,k,sign,inner)for st,df in zip(ss,derivatives)for k in range(n)];_NREF.append(make_reference(vpart,fpart,normals))
  # closed narrow shell section, capped only at its finite perimeter.
  for j in [0,ny-1]:
   for k in range(n-1):a=j*n+k;b=a+1;f.append((a,b,b+size,a+size))
  for k in [0,n-1]:
   for j in range(ny-1):a=j*n+k;b=a+n;f.append((a,b,b+size,a+size))
  shell=mesh('Temporary recovered native shell',verts,f)
  bpy.ops.mesh.primitive_cube_add(size=1,location=(sign*.25,1.1835,-.097));box=bpy.context.object;box.dimensions=(.316,1.571,.406);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
  # absX [.092,.408], Y [.398,1.969], Z[-.30,.106]. Side roofs stay untouched.
  boolean(shell,box,'INTERSECT');pv,pc=volume(shell);assert pc and pv>0;patches.append(shell);receipts.append({'side':sign,'closed':pc,'volume':pv});print('SIDE_PATCH',receipts[-1],flush=True)
 verts=[];faces=[]
 for ob in patches:
  offset=len(verts);verts.extend([tuple(v.co)for v in ob.data.vertices]);faces.extend([tuple(i+offset for i in p.vertices)for p in ob.data.polygons]);me=ob.data;bpy.data.objects.remove(ob,do_unlink=True);bpy.data.meshes.remove(me)
 combined=mesh('Temporary paired native skin restoration',verts,faces)
 # Remove only the old slot-contour window before joining its replacement.
 # A .0002u overlap band retains actual original skin at the patch perimeter.
 for sign in [-1,1]:
  bpy.ops.mesh.primitive_cube_add(size=1,location=(sign*.25,1.1835,-.097));cut=bpy.context.object;cut.dimensions=(.316-.0004,1.571-.0004,.406-.0004);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);boolean(body,cut,'DIFFERENCE')
 boolean(body,combined,'UNION')
 after,closed=volume(body);print('PATCH_STATS',before,after,closed,receipts,flush=True);assert closed and after>before
 return {'method':'Native retained-lattice reconstruction only within absX[.092,.408],Y[.398,1.969],Z[-.30,.106]','originalAngularSamples':64,'stationCount':len(ss),'radialWallOffset':.006,'overlapCoplanarProtectionInwardSetback':1e-5,'nativeSkinOverlapBand':.0002,'oldContourRemovedBeforeJoining':True,'nativeNormalDerivativeFits':derivatives,'snappedRetainedVertices':snap_count,'maximumSnapDistance':max_snap,'addedShellVolume':after-before,'closedManifold':closed,'recoverHistoricalGeometryClaim':False,'sourceOfParameters':'Current native same-file surviving ring vertices; no old model read'}

def swept_output_cut():
 body=bpy.data.objects['Fuselage'];rec=json.loads(bpy.context.scene['annotatedMechanismJSON']);tr=rec['actualTravel'];before=volume(body)[0];out=[]
 for side in ['L','R','Beam']:
  if side=='Beam':ends=[Vector((-.12,-.009,.067)),Vector((.12,-.009,.067))]
  else:
   link=bpy.data.objects['BraceBodyCarriage_'+side];ends=[Vector(x)for x in link['straightOutputEndpointsLocal']]
  points=[];radius=.0122
  for y in [tr['minimumY'],tr['maximumY']]:
   for p in ends:
    center=p+Vector((0,y,rec['bodyAnchorRightCruise'][2]))
    for k in range(17):
     theta=math.pi*k/16
     for j in range(32):
      phi=2*math.pi*j/32;points.append(center+Vector((radius*math.sin(theta)*math.cos(phi),radius*math.sin(theta)*math.sin(phi),radius*math.cos(theta))))
  me=bpy.data.meshes.new('Temporary actual swept output');bm=bmesh.new();vs=[bm.verts.new(p)for p in points];bmesh.ops.convex_hull(bm,input=vs,use_existing_faces=False);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-10);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free();o=bpy.data.objects.new(me.name,me);bpy.context.collection.objects.link(o);boolean(body,o,'DIFFERENCE');out.append({'side':side,'straightOutputEndpointsLocal':[list(p)for p in ends],'translationYRange':[tr['minimumY'],tr['maximumY']],'sweptRoundCutterRadius':radius,'actualRodRadius':.007,'nominalClearance':radius-.007,'inscribedSphereSampling':[16,32]})
 after,closed=volume(body);print('CUT_STATS',before,after,closed,flush=True);assert closed and 0<after<before
 return {'method':'Rounded true slanted-output segment Minkowski sweep over exact slider travel; inner crossbeam untouched','removedVolumeBothSides':before-after,'closedManifold':closed,'sides':out,'fixedBeamHalfSpanUnchanged':.12,'minimumRequiredClearance':.004,'noNewCollisionExemptions':True}

def repair_exact_zero_edges(body):
 before=volume(body)[0];bm=bmesh.new();bm.from_mesh(body.data);pairs=[e for e in bm.edges if tuple(e.verts[0].co)==tuple(e.verts[1].co)];target={};positions=[]
 for edge in pairs:
  a,b=edge.verts;positions.append(list(a.co))
  while a in target:a=target[a]
  while b in target:b=target[b]
  if a!=b:target[b]=a
 for a,b in list(target.items()):
  while b in target:b=target[b]
  target[a]=b
 if target:bmesh.ops.weld_verts(bm,targetmap=target)
 assert all(e.is_manifold for e in bm.edges);bm.to_mesh(body.data);bm.free();body.data.update();body.data.calc_loop_triangles();minimum=min(t.area for t in body.data.loop_triangles);assert minimum>1e-18
 after=volume(body)[0];assert abs(after-before)<1e-12
 return {'method':'Collapse only edge endpoints with exactly identical Float32 coordinates; no distance welding','exactZeroLengthEdges':len(pairs),'positions':positions,'maximumCoordinateDisplacement':0.0,'absoluteVolumeDelta':abs(after-before),'minimumTriangleArea':minimum,'areaGateUnchanged':1e-18,'closedManifold':True}

def restore_and_cut_slot():
 b=bpy.data.objects['Fuselage'];before=volume(b)[0];r={'reconstruction':patch_shell(),'sweptSlot':swept_output_cut()};r['exactEndpointRepair']=repair_exact_zero_edges(b);r['surfaceFinish']=apply_restored_normals(b,_NREF);r['netVolumeDelta']=volume(b)[0]-before;r['closedManifold']=volume(b)[1];b['transverseSlotRefinementJSON']=json.dumps(r);bpy.context.scene['transverseOutputRefinementJSON']=json.dumps(r);return r
