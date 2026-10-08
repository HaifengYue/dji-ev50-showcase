"""Replay the reviewed annotation refinement from the explicitly supplied native.
The source must be the 2026-10-07 accepted native, SHA below. Outputs are new
candidates only. The current editable author file is never overwritten here.
"""
import bpy,json,hashlib,sys,argparse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(Path(__file__).parent));sys.path.insert(0,str(ROOT/'scripts'))
from extend_transverse_linkage import extend_linkage
from restore_lower_shell import restore_and_cut_slot
from smooth_center_wing import refine_center_wing
from verify_refined_connections import verify
from write_candidate_contract import write_contract
SOURCE_SHA='41d1d093ce4b261483ffcc845303fc1e1b8cbb211c4b75ef24663aeb46f0d116'

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--contract-output',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);source=a.source.resolve();out=a.output.resolve();assert hashlib.sha256(source.read_bytes()).hexdigest()==SOURCE_SHA;assert out!=source and out!=(ROOT/'assets/blender/xp4.blend').resolve();bpy.ops.wm.open_mainfile(filepath=str(source));bpy.context.scene.frame_set(0);bpy.context.view_layer.update();names={o.name:(o.type,o.parent.name if o.parent else None)for o in bpy.data.objects}
 report={'schema':'transwing.annotated-refinement-20261008.v1','inputNativeSha256':SOURCE_SHA,'units':'concept model units; not manufacturing dimensions','linkage':extend_linkage(.28),'slot':restore_and_cut_slot()}
 report['centerWing']=refine_center_wing();report['connections']=verify();assert names=={o.name:(o.type,o.parent.name if o.parent else None)for o in bpy.data.objects};report['allNamesParentsTypesPreserved']=True;report['meshes']=sum(o.type=='MESH'for o in bpy.data.objects);report['nodes']=len(names);assert report['meshes']==285 and report['nodes']==352;out.parent.mkdir(parents=True,exist_ok=True);bpy.ops.wm.save_as_mainfile(filepath=str(out),compress=True)
 report['outputNativeSha256']=hashlib.sha256(out.read_bytes()).hexdigest();a.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');write_contract(ROOT/'scripts/data/current-model-contract.json',a.contract_output,out,report);print('COMPOSED_NATIVE_REFINEMENT_SAVED',out,report['outputNativeSha256'],flush=True)
if __name__=='__main__':main()
