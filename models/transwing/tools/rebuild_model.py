"""Re-bake/export the single editable native baseline, then verify source/runtime geometry.
This is intentionally not reconstruction from historical procedural inputs.
"""
from pathlib import Path
import argparse,json,subprocess,os,time,hashlib
ROOT=Path(__file__).resolve().parents[1]
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--blender',default='blender');ap.add_argument('--verify-only',action='store_true');ap.add_argument('--save-baked-blend',action='store_true');a=ap.parse_args()
 stage=ROOT/'build/model';stage.mkdir(parents=True,exist_ok=True)
 env=os.environ.copy();env.update(PWD=str(ROOT),PYTHONDONTWRITEBYTECODE='1',TRANSWING_INTEGRATED_STAGE='build/model',TRANSWING_SAVE_BAKED_BLEND='1'if a.save_baked_blend else '0')
 node=lambda f:['node','scripts/run-node.mjs','scripts/pipeline/'+f]
 commands=[] if a.verify_only else [('native-rebake',[a.blender,'-b','-t','2','--python-exit-code','1','--python','scripts/pipeline/bake_native.py']),('compress',['node','scripts/pipeline/compress-model.mjs'])]
 commands += [('write-manifest',['python3','scripts/pipeline/write_manifest.py']),('source-runtime',node('integrated_verify_source_runtime.mjs')),('baked-animation',node('verify_integrated_baked_animation.mts')),('runtime-compatibility',node('verify_integrated_runtime_compatibility.mts')),('owner-topology',node('integrated_verify_owner_topology.mts')),('all-owner-inventory',node('integrated_verify_all_owner_inventory.mts')),('semantic-unit',['node','scripts/run-node.mjs','--test','scripts/pipeline/integrated_semantic_geometry.test.mts'])]
 result={'schema':'transwing.native-baseline-rebuild-receipt.v1','historicalProceduralReconstruction':False,'mode':'editable-native-baseline-rebake-export','rebakeExecuted':not a.verify_only,'passed':False,'commands':[]};rp=stage/'REBUILD_RECEIPT.json'
 for name,cmd in commands:
  print('RUN',name,flush=True);start=time.time();log=stage/(name+'.log')
  with log.open('w')as f:r=subprocess.run(cmd,cwd=ROOT,env=env,stdout=f,stderr=subprocess.STDOUT)
  result['commands'].append({'name':name,'exitCode':r.returncode,'seconds':round(time.time()-start,3),'log':str(log.relative_to(ROOT))});rp.write_text(json.dumps(result,indent=2)+'\n')
  if r.returncode:raise SystemExit('Failed '+name+'; see '+str(log))
 result['passed']=True;rp.write_text(json.dumps(result,indent=2)+'\n');print('Verified current native baseline export:',stage)
if __name__=='__main__':main()
