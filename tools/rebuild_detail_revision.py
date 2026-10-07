"""V26端部收口：在全新目录从冻结输入重建，不读取当前最终模型作生成输入。"""
from pathlib import Path,PurePosixPath
import argparse,hashlib,json,os,shutil,subprocess
SOURCE=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--output',required=True,type=Path,help='新工程父目录；其下transwing-studio必须不存在')
p.add_argument('--dry-run',action='store_true');p.add_argument('--run',action='store_true');p.add_argument('--install-deps',action='store_true');p.add_argument('--verify-motion',action='store_true',help='另重跑661倾转+252折桨/相位采样')
p.add_argument('--blender',default='blender');a=p.parse_args();target=a.output.resolve()/'transwing-studio'
if target.exists()or target==SOURCE or SOURCE in target.parents:raise SystemExit('拒绝覆盖既有工程，或在源工程内部构造')
manifest=json.loads((SOURCE/'REVISION_DETAIL_CONSTRUCTION_INPUTS.json').read_text());seen=set()
for row in manifest['files']:
 relative=PurePosixPath(row['path']);assert not relative.is_absolute()and'..'not in relative.parts and row['path']not in seen;seen.add(row['path']);f=SOURCE/relative
 if not f.is_file()or f.stat().st_size!=row['bytes']or hashlib.sha256(f.read_bytes()).hexdigest()!=row['sha256']:raise SystemExit('构造输入身份不符：'+row['path'])
label='candidate-detail-m-regenerated'
commands=[['python3','tools/verify_package.py'],[a.blender,'-b','-t','4','--python-exit-code','1','--python','scripts/revision_20261007_detail/build_detail_candidate.py'],[a.blender,'-b','-t','2','--python-exit-code','1','--python','scripts/revision_20261007_detail/verify_geometry_rebuild.py'],[a.blender,'-b','-t','4','--python-exit-code','1','--python','scripts/revision_20261007_detail/bake_candidate.py'],['node','scripts/revision_20261007_detail/compress-model-detail.mjs'],['node','scripts/revision_20261007_detail/verify_source_runtime.mjs'],[a.blender,'-b','-t','2','--python-exit-code','1','--python','scripts/revision_20261007_detail/verify_baked_geometry.py'],['node','--import','tsx','scripts/revision_20261007_detail/verify_baked_animation.mts'],['node','--import','tsx','scripts/revision_20261007_detail/verify_runtime_compatibility.mts'],['node','--import','tsx','scripts/revision_20261007_detail/verify_owner_topology.mts'],['node','--import','tsx','scripts/revision_20261007_detail/verify_all_owner_inventory.mts'],['python3','scripts/revision_20261007_detail/write_detail_manifest.py']]
if a.dry_run:
 print(json.dumps({'verifiedInputCount':len(seen),'target':str(target),'currentFinalModelIsNotAnInput':True,'commands':commands[1:],'sameGeometryVerifiedAgainst':'REVISION_DETAIL_GEOMETRY_REFERENCE.json','fullWrapperInFreshDirectoryClaimedExecuted':False},ensure_ascii=False,indent=2));raise SystemExit(0)
files=set(seen)
for name in ['src','python','examples','docs','qa/lib']:
 for f in (SOURCE/name).rglob('*'):
  if f.is_file()and'__pycache__'not in f.parts:files.add(str(f.relative_to(SOURCE)))
for name in ['index.html','vite.config.ts','tsconfig.json','README.md','THIRD_PARTY_NOTICES.txt','AUDIT_ARCHIVE.json','qa/glb-loader-check.mjs','qa/flight-regression.test.ts','REVISION_DETAIL_CONSTRUCTION_INPUTS.json']:
 if(SOURCE/name).is_file():files.add(name)
target.mkdir(parents=True)
(target/'qa/revision-20261007-detail').mkdir(parents=True,exist_ok=True)
for relative in sorted(files):f=SOURCE/relative;(target/relative).parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,target/relative)
if not a.run:print('完整锁定输入已准备：'+str(target));raise SystemExit(0)
env=dict(os.environ,TRANSWING_DETAIL_LABEL=label,TRANSWING_REVISION_LABEL=label,TRANSWING_CANDIDATE=label)
def run(command):subprocess.run(command,cwd=target,env=env,check=True)
if a.install_deps:run(['npm','ci']);run(['npm','ci','--prefix','scripts'])
for command in commands[1:3]:run(command)
report=json.loads((target/'qa/revision-20261007-detail/REVISION_DETAIL_REBUILD_COMPARISON.json').read_text());assert report['passed']
if a.verify_motion:
 for script,suffix in [('scripts/revision_20261007_detail/check_material.py','material-and-support-check'),('scripts/revision_20261007/check_dense_material.py','dense-wing-material-check'),('scripts/revision_20261007/check_rotor_sweep.py','rotor-fold-phase-preflight')]:
  run([a.blender,'-b','-t','4','--python-exit-code','1','--python',script]);assert json.loads((target/'qa/revision-20261007'/(label+'-'+suffix+'.json')).read_text())['passed']
candidate=target/'qa/revision-20261007'/(label+'.blend');env['TRANSWING_DETAIL_EXPECTED_SHA']=hashlib.sha256(candidate.read_bytes()).hexdigest()
for command in commands[3:]:run(command)
stage=target/'qa/revision-20261007-detail/baked-candidate'
for src,dst in [('xp4.blend','assets/blender/xp4.blend'),('xp4-source.glb','assets/blender/xp4-source.glb'),('xp4.glb','public/models/xp4.glb'),('model-manifest.json','public/models/manifest.json'),('model-validation.json','assets/model-validation.json'),('modelAssetRevision.ts','src/modelAssetRevision.ts')]+[('annotated-mechanism.json',folder+'/annotated-mechanism.json')for folder in ['assets/build','assets/blender','public/models']]:
 (target/dst).parent.mkdir(parents=True,exist_ok=True);shutil.copy2(stage/src,target/dst)
for f in (stage/'assets/animation').glob('*.json'):(target/'assets/animation').mkdir(parents=True,exist_ok=True);shutil.copy2(f,target/'assets/animation'/f.name)
# 回归校验使用包内V26断言；不回写原工作树，也不发布。
run(['npm','test']);run(['npm','run','test:qa']);run(['npm','run','build'])
print('V26全新目录再生与开发检查完成：'+str(target)+'；末端外观仍须用户审看，未发布')
