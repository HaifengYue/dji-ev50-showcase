"""Fresh complete reconstruction of independent enlarged controls and shell details.

The historical 171 inputs remain byte-identical. This wrapper adds the bounded
revision recipe and current app tests, then verifies every native mesh before
baking fresh animation. Current final Blend/GLB assets are not construction inputs.
"""
from pathlib import Path
import argparse,hashlib,importlib.util,json,os,shutil,subprocess,time
SOURCE=Path(__file__).resolve().parents[1]
LOCK='REVISION_CONTROLS_CONSTRUCTION_INPUTS.json'
LABEL='candidate-inset-integrated-b-independent-controls-regenerated'
STAGE='qa/revision-20261007-inset/baked-independent-controls-regenerated'
CHECKS='qa/revision-20261007-controls/rebuild-checks'

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,d):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--output',type=Path,required=True)
    ap.add_argument('--run',action='store_true')
    ap.add_argument('--native-only',action='store_true')
    ap.add_argument('--hardlink-inputs',action='store_true')
    ap.add_argument('--deps-from',type=Path,default=SOURCE)
    ap.add_argument('--skip-package-check',action='store_true')
    ap.add_argument('--blender',default='blender')
    args=ap.parse_args();target=args.output.resolve()/'transwing-studio'
    if target.exists()or SOURCE in target.parents:ap.error('Requires a new directory outside the source project')
    spec=importlib.util.spec_from_file_location('frozen_b_wrapper',SOURCE/'tools/rebuild_inset_revision.py');base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
    _,old_names=base.verify_inputs(SOURCE)
    lock=json.loads((SOURCE/LOCK).read_text());old=json.loads((SOURCE/'REVISION_INSET_CONSTRUCTION_INPUTS.json').read_text())
    index={r['path']:r for r in lock['files']};assert len(index)==len(lock['files'])
    for row in old['files']:assert index[row['path']]==row,'Inherited 171 input changed'
    for row in lock['files']:
        p=SOURCE/row['path'];assert p.is_file()and not p.is_symlink()and p.resolve().is_relative_to(SOURCE)
        assert p.stat().st_size==row['bytes']and sha(p)==row['sha256'],row['path']
    if not args.skip_package_check:subprocess.run(['python3','tools/verify_edge_package.py'],cwd=SOURCE,check=True)
    linked=base.prepare(target,old_names,args.hardlink_inputs)
    for rel in set(index)-set(old_names):
        dest=target/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(SOURCE/rel,dest)
    shutil.copy2(SOURCE/LOCK,target/LOCK)
    # Old preparation templates are historical B. Restore current checked-in
    # app/tests, never infer expected geometry by reading the generated model.
    for p in (SOURCE/'src').rglob('*'):
        if p.is_file():q=target/p.relative_to(SOURCE);q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q)
    env=base.clean_environment();env.update(TRANSWING_CONTROLS_LABEL=LABEL,TRANSWING_INTEGRATED_LABEL=LABEL,TRANSWING_INTEGRATED_STAGE=STAGE,PYTHONPATH=str(target/'python'),PWD=str(target))
    for key in list(env):
        if key.startswith(('TRANSWING_EDGE_BASE','TRANSWING_CONTROLS_BASE'))or key in ('TRANSWING_EDGE_WRITE_REFERENCE','TRANSWING_CONTROLS_WRITE_REFERENCE'):env.pop(key,None)
    receipt={'schema':'transwing.independent-controls.fresh-rebuild.v1','processContract':{'blenderVersion':'4.3.2','frozenBaseThreads':4,'deltaThreads':2,'coldLoadBetweenStages':True},'inputCount':len(index),'inherited171Unchanged':True,'currentOutputUsedAsConstructionInput':False,'target':str(target),'commands':[],'passed':False,'hardlinkedReadOnlyInputs':linked,'packageIdentityChecked':not args.skip_package_check}
    rp=target/CHECKS/'REBUILD_RECEIPT.json';write(rp,receipt)
    def run(name,cmd):
        log=target/CHECKS/(str(len(receipt['commands'])+1).zfill(2)+'-'+name+'.log');t=time.time();print('RUN',name,flush=True)
        with log.open('w')as f:r=subprocess.run(cmd,cwd=target,env=env,stdout=f,stderr=subprocess.STDOUT)
        receipt['commands'].append({'name':name,'exitCode':r.returncode,'seconds':round(time.time()-t,3),'log':str(log.relative_to(target))});write(rp,receipt)
        if r.returncode:raise RuntimeError('Failed '+name+': '+str(log))
    native=lambda script:[args.blender,'-b','-t','2','--python-exit-code','1','--python',str(target/script)]
    if not args.run:print('Prepared verified inputs:',target);return
    run('full-native-construction',native('scripts/revision_20261007_controls/build_candidate.py'))
    run('complete-native-identity',native('scripts/revision_20261007_controls/check_native_identity.py'))
    candidate=target/'qa/revision-20261007'/(LABEL+'.blend');env['TRANSWING_INTEGRATED_EXPECTED_SHA']=sha(candidate);env['QA_EXPECTED_SOURCE_CANDIDATE_SHA256']=sha(candidate)
    if not args.native_only:
        for folder in ['node_modules','scripts/node_modules']:
            dep=args.deps_from.resolve()/folder;assert dep.is_dir(),'Missing dependencies: '+str(dep);(target/folder).symlink_to(dep,target_is_directory=True)
        policy=json.loads((SOURCE/'EDGE_LINKAGE_PIPELINE_POLICY_INPUTS.json').read_text());write(target/STAGE/'BUDGET_APPROVAL.json',policy['budgetApproval'])
        commands=base.commands(args.blender,target)
        for name,cmd in commands[2:]:
            if name=='write-manifest':cmd=['python3','scripts/revision_20261007_controls/write_manifest.py']
            if name in ['baked-animation','runtime-compatibility']:cmd[-1]=cmd[-1].replace('revision_20261007_inset','revision_20261007_edges')
            run(name,cmd)
        # Reuse the frozen promotion mechanics with explicit current stage.
        base.STAGE=STAGE;base.promote(target)
        run('format-cache-helper',['node_modules/.bin/prettier','--write','src/modelAssetRevision.ts'])
        for name,cmd in [('node-tests',['npm','test']),('qa-tests',['npm','run','test:qa']),('format',['npm','run','format:check']),('typescript-vite',['npm','run','build','--','--configLoader','native']),('python-tests',['python3','-m','unittest','discover','-s','python/tests'])]:run(name,cmd)
    for row in lock['files']:
        for base_root in [SOURCE,target]:
            checked=base_root/row['path'];assert checked.stat().st_size==row['bytes']and sha(checked)==row['sha256'],str(checked)
    receipt['sourceAndTargetInputHashesUnchangedAfterRun']=True
    receipt.update(passed=True,fullNativeChainExecuted=True,currentNativeGeometryReferenceMatched=True,freshBakeAndAppTestsExecuted=not args.native_only)
    write(rp,receipt);print('Fresh reconstruction passed:',target)
if __name__=='__main__':main()
