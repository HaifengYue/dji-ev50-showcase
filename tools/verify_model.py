"""Rerun physical-motion acceptance on the current single native baseline.
Full mode includes dense wing, folding/rotor, per-surface controls, all 64 control
limit combinations, and internal drive. These finite samples are not a proof of
continuous collision freedom or engineering certification.
"""
from pathlib import Path
import argparse,json,hashlib,os,subprocess,time
ROOT=Path(__file__).resolve().parents[1]
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--blender',default='blender');ap.add_argument('--quick',action='store_true',help='Only control smoke states; never reports full acceptance');args=ap.parse_args()
 c=json.loads((ROOT/'scripts/data/current-model-contract.json').read_text());native=ROOT/c['source'];assert hashlib.sha256(native.read_bytes()).hexdigest()==c['sourceSha256']
 if not args.quick:
  topology_path=ROOT/'build/model/ALL_OWNER_TOPOLOGY_INVENTORY.json'
  assert topology_path.is_file(),'Run build:model first; current role-aware topology evidence is required'
  topology=json.loads(topology_path.read_text());assert topology.get('inventoryComplete') and topology['sourceCandidateSha256']==c['sourceSha256'],'Topology receipt belongs to another native source'
  for row in topology['files']:
   policy=c['expectedTopologyByEncoding'][row['file']]
   assert sorted(row['openOrNonmanifoldOwnerNames'])==sorted(policy['openOwnerNames']) and row['rawClosedOwners']==policy['closedOwnerCount']
   assert hashlib.sha256((ROOT/'build/model'/row['file']).read_bytes()).hexdigest()==row['sha256'],'Topology output changed'
 out=ROOT/'build/verification';out.mkdir(parents=True,exist_ok=True);env=os.environ.copy();env.update(PWD=str(ROOT),PYTHONDONTWRITEBYTECODE='1')
 tasks=[('controls-quick','control_combinations.py','quick')]if args.quick else [('wing-material','wing_material_sweep.py',None),('rotor-fold-phase','rotor_sweep.py',None),('controls-local','control_combinations.py','local'),('controls-combined','control_combinations.py','combined'),('internal-drive','drive_sweep.py',None),('same-owner-finite-intersections','self_intersections.py',None),('current-native-inventory','check_identity_and_aperture.py',None),('support-and-functional-threads','check_refined_supports.py',None),('both-side-slot-clearance','check_slot_clearance.py',None)]
 receipt={'schema':'transwing.current-native-physical-verification.v1','sourceSha256':c['sourceSha256'],'fullSuite':not args.quick,'passed':False,'commands':[]};rp=out/('SMOKE_RECEIPT.json'if args.quick else'PHYSICAL_RECEIPT.json')
 for label,script,mode in tasks:
  command=[args.blender,'-b','-t','2','--python-exit-code','1','--python',str(ROOT/'scripts/verify'/script),'--','--source',str(native),'--modules',str(ROOT/'scripts'),'--output',str(out),'--expected-sha',c['sourceSha256']]
  if script=='self_intersections.py':
   i=command.index('--modules');del command[i:i+2]
  if script in ('check_refined_supports.py','check_slot_clearance.py','check_identity_and_aperture.py'):
   i=command.index('--modules');del command[i:i+2]
   command[command.index('--output')+1]=str(out/(label+'.json'))
   if script!='check_identity_and_aperture.py':command+=['--contract',str(ROOT/'scripts/verify/current-linkage-qa-contract.json')]
   if script=='check_slot_clearance.py':command+=['--step','.25']
  child=env.copy()
  if mode:child['TRANSWING_CONTROL_SWEEP']=mode
  log=out/(label+'.log');started=time.time();print('RUN',label,flush=True)
  with log.open('w')as stream:run=subprocess.run(command,cwd=ROOT,env=child,stdout=stream,stderr=subprocess.STDOUT)
  receipt['commands'].append({'name':label,'exitCode':run.returncode,'seconds':round(time.time()-started,3),'log':str(log.relative_to(ROOT))});rp.write_text(json.dumps(receipt,indent=2)+'\n')
  if run.returncode:raise SystemExit('Failed '+label+'; inspect '+str(log))
 assert hashlib.sha256(native.read_bytes()).hexdigest()==c['sourceSha256'];receipt['passed']=True;rp.write_text(json.dumps(receipt,indent=2)+'\n');print('Completed',('smoke only'if args.quick else'full finite-state suite'),rp)
if __name__=='__main__':main()
