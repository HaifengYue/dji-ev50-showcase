"""Independent physical connection gate for the extended output; no graph-only pass."""
import bpy,json,math,sys,hashlib
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

def tree(o):
 o.data.calc_loop_triangles();return BVHTree.FromPolygons([o.matrix_world@v.co for v in o.data.vertices],[t.vertices for t in o.data.loop_triangles],all_triangles=True)
def verify():
 rows=[];sp=bpy.data.objects['BraceSpreader'];beam=bpy.data.objects['Drive_Crossbeam'];bt=tree(beam)
 for side,sg in [('L',-1),('R',1)]:
  link=bpy.data.objects['BraceBodyCarriage_'+side];pin=bpy.data.objects['BraceBallPin_'+side+'_Body'];ball=bpy.data.objects['BraceBall_'+side+'_Body'];anchor=bpy.data.objects['BraceBody_'+side]
  ends=[sp.matrix_world@Vector(p)for p in link['straightOutputEndpointsLocal']];expected_beam=sp.matrix_world@Vector((sg*.12,-.009,.067));expected_pin=sp.matrix_world@Vector((sg*.260041893,-.0092276139,.0204089563));beam_end=min(ends,key=lambda p:(p-expected_beam).length);pin_end=min(ends,key=lambda p:(p-expected_pin).length)
  assert (beam_end-expected_beam).length<1e-7 and (pin_end-expected_pin).length<1e-7
  a,b=ends;delta=b-a;length=delta.length;axis=delta.normalized();along=[];radius=[]
  for v in link.data.vertices:
   p=link.matrix_world@v.co-a;t=p.dot(axis);along.append(t);radius.append((p-axis*t).length)
  lt=tree(link);beam_pairs=len(lt.overlap(bt));pin_pairs=len(lt.overlap(tree(pin)))
  assert beam_pairs>0 and pin_pairs>0,(side,beam_pairs,pin_pairs)
  assert abs(min(along))<1e-7 and abs(max(along)-length)<1e-7 and max(radius)<=.0070001
  center_error=(anchor.matrix_world.translation-ball.matrix_world.translation).length;assert center_error<1e-7
  assert abs(abs(anchor.location.x)-.28)<1e-7
  rows.append({'side':side,'worldEndpoints':[list(p)for p in ends],'centerlineLength':length,'nominalRadius':.007,'beamEndpointError':(beam_end-expected_beam).length,'pinEndpointError':(pin_end-expected_pin).length,'actualDecodedMeshAxialBounds':[min(along),max(along)],'actualMaximumRadius':max(radius),'actualLinkBeamTriangleContacts':beam_pairs,'actualLinkPinTriangleContacts':pin_pairs,'bodyBallAnchorCenterError':center_error,'bodyBallAbsX':abs(anchor.location.x)})
 return {'schema':'transwing.refined-output-connection.v1','passed':True,'sharedRigidSpreader':True,'requiredBodyBallAbsX':.28,'beamHalfSpanUnchanged':.12,'geometricEndpointsAndRealMaterialContactsVerified':True,'sides':rows}
if __name__=='__main__':
 args=sys.argv[sys.argv.index('--')+1:];source=Path(args[0]);out=Path(args[1]);bpy.ops.wm.open_mainfile(filepath=str(source));bpy.context.view_layer.update();r=verify();r['sourceSha256']=hashlib.sha256(source.read_bytes()).hexdigest();out.write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
