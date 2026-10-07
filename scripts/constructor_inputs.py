"""Portable explicit primitive-input validation and independent-tree preparation.

This is an orchestration guard. It supplies no geometry or physical acceptance.
"""
from pathlib import Path, PurePosixPath
import hashlib,json,shutil

LEAF='transwing-studio'
SCHEMA='transwing.portable-primitive-inputs.v1'
FORBIDDEN={'assets/blender/xp4.blend','assets/blender/xp4-source.glb','assets/build/xp4.blend','assets/build/xp4-source.glb','public/models/xp4.glb','assets/build/annotated-mechanism.json','assets/blender/annotated-mechanism.json','public/models/annotated-mechanism.json','assets/model-validation.json'}
ALLOWED_BLEND={'scripts/data/preserved-front-surfaces.blend','assets/blender/nacelle-system-concept.blend'}

def digest(path):
 h=hashlib.sha256()
 with Path(path).open('rb')as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()

def relative(value):
 if not isinstance(value,str)or not value or'\\'in value:raise ValueError('Invalid relative input path')
 p=PurePosixPath(value)
 if p.is_absolute()or any(x in('','..','.')for x in value.split('/')):raise ValueError('Input path must be strictly project-relative: '+value)
 return value

def local(root,value):
 value=relative(value);root=Path(root).resolve();p=root/value
 if any((root/Path(*PurePosixPath(value).parts[:i])).is_symlink()for i in range(1,len(PurePosixPath(value).parts)+1)):raise ValueError('Locked input cannot be a symbolic link: '+value)
 if not p.resolve().is_relative_to(root):raise ValueError('Input escapes project: '+value)
 return p

def read_contract(root,lock_path='CONSTRUCTION_INPUTS.json'):
 root=Path(root).resolve()
 if root.name!=LEAF:raise ValueError('Expected portable project root '+LEAF)
 lock=local(root,lock_path);contract=json.loads(lock.read_text())
 if contract.get('schema')!=SCHEMA or contract.get('projectLeaf')!=LEAF:raise ValueError('Portable constructor input schema/root mismatch')
 rows=contract.get('files');seen=set();destinations=set()
 if not isinstance(rows,list)or not rows:raise ValueError('Empty primitive input lock')
 for row in rows:
  source=relative(row['path']);dest=relative(row.get('destinationPath',source))
  if source in seen or dest in destinations:raise ValueError('Duplicate input or destination '+source)
  seen.add(source);destinations.add(dest)
  if dest in FORBIDDEN or source in FORBIDDEN:raise ValueError('Finished aircraft cannot be a primitive input: '+source)
  if '/node_modules/'in'/'+source+'/'or '/node_modules/'in'/'+dest+'/':raise ValueError('Dependency trees are not constructor source inputs')
  if source.endswith('.blend')and source not in ALLOWED_BLEND:raise ValueError('Unapproved Blend input '+source)
  if dest=='public/models/manifest.json'and row.get('role')!='constructor-seed':raise ValueError('Manifest requires an explicit constructor seed')
  sha=row.get('sha256','')
  if len(sha)!=64 or any(c not in'0123456789abcdef'for c in sha):raise ValueError('Invalid SHA256 '+source)
  if not isinstance(row.get('bytes'),int)or row['bytes']<0:raise ValueError('Invalid input size '+source)
 required={'STAGING_ONLY.json','scripts/generate_transwing.py','scripts/annotated_native_stage.py','scripts/constructor_inputs.py','scripts/data/annotated-mechanism-intent.json','scripts/data/preserved-front-surfaces.blend','scripts/annotated_principal_side_closure.py','scripts/data/annotated-principal-side-closure.json','scripts/package.json','scripts/package-lock.json','package.json','package-lock.json','public/models/manifest.json','public/models/nacelle-system-concept.glb','assets/blender/nacelle-system-concept-source.glb'}
 missing=required-destinations
 if missing:raise ValueError('Missing primitive inputs: '+', '.join(sorted(missing)))
 return root,lock,contract

def verify_locked_inputs(root,lock_path='CONSTRUCTION_INPUTS.json'):
 root,lock,contract=read_contract(root,lock_path)
 for row in contract['files']:
  p=local(root,row['path'])
  if not p.is_file()or p.stat().st_size!=row['bytes']or digest(p)!=row['sha256']:raise ValueError('Constructor input identity mismatch: '+row['path'])
 marker=json.loads(local(root,'STAGING_ONLY.json').read_text())
 if marker.get('expectedDirectoryName')!=LEAF or marker.get('constructionLock')!=lock_path:raise ValueError('Marker must name the explicit portable input lock')
 intent=json.loads(local(root,'scripts/data/annotated-mechanism-intent.json').read_text())
 if marker.get('heavyBuildAuthorized')is not True or intent.get('generationAuthorized')is not True:raise ValueError('Native build authorization is closed')
 rows={r['path']:r for r in contract['files']}
 for name,sha in intent.get('requiredConstructionInputs',{}).items():
  rel='scripts/'+relative(name)
  if rel not in rows or rows[rel]['sha256']!=sha:raise ValueError('Required construction dependency absent or different: '+rel)
 if not intent.get('requiredConstructionInputs'):raise ValueError('Missing requiredConstructionInputs')
 seeds=[r for r in contract['files']if r.get('destinationPath')=='public/models/manifest.json']
 if len(seeds)!=1:raise ValueError('Exactly one construction seed is required')
 seed=json.loads(local(root,seeds[0]['path']).read_text())
 companion=seed.get('airframeDetails',{}).get('conceptModule',{})
 if companion.get('file')!='nacelle-system-concept.glb':raise ValueError('Independent concept metadata is missing')
 runtime=local(root,'public/models/nacelle-system-concept.glb');source=local(root,'assets/blender/nacelle-system-concept-source.glb')
 if companion.get('sha256')!=digest(runtime)or companion.get('sourceSha256')!=digest(source):raise ValueError('Independent concept companion does not match construction seed')
 return {'schema':SCHEMA,'inputLockSHA256':digest(lock),'verifiedInputFiles':len(contract['files']),'projectLeaf':LEAF,'formalAcceptance':False}

def prepare_independent_tree(source_root,approved_parent,receipt_path,lock_path='CONSTRUCTION_INPUTS.json',dry_run=False):
 source,lock,contract=read_contract(source_root,lock_path);verified=verify_locked_inputs(source,lock_path)
 parent=Path(approved_parent).resolve(strict=True);target=parent/LEAF;receipt=Path(receipt_path)
 if target.exists()or target==source or target.is_relative_to(source)or source.is_relative_to(target):raise ValueError('Independent target must be absent and outside source')
 if receipt.exists():raise ValueError('Refuse to overwrite preparation receipt')
 rows=[]
 for row in contract['files']:
  rows.append({**row,'destinationPath':row.get('destinationPath',row['path'])})
 # The seed keeps its locked source path as well as its initial output path.
 # This preserves the identical input validator in both independent roots.
 if not dry_run:
  target.mkdir()
  for row in rows:
   src=local(source,row['path']);dst=local(target,row['path']);dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dst)
   if row['destinationPath']!=row['path']:
    dest=local(target,row['destinationPath']);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dest)
   if digest(src)!=row['sha256']or digest(dst)!=row['sha256']:raise ValueError('Input changed during copy '+row['path'])
  target_lock=local(target,lock_path);target_lock.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(lock,target_lock)
  for rel in ('qa/native-staging','qa/frontend'):local(target,rel).mkdir(parents=True,exist_ok=True)
  verify_locked_inputs(target,lock_path)
  if any(local(target,x).exists()for x in FORBIDDEN):raise ValueError('Unexpected completed aircraft in prepared tree')
 result={'schema':'transwing.portable-preparation-receipt.v1','sourceRealpath':str(source),'destinationRealpath':str(target),'inputLockSHA256':verified['inputLockSHA256'],'files':rows,'prepared':not dry_run,'blenderExecuted':False,'formalAcceptance':False,'traceLimitation':'Explicit inputs, dynamic dependency closure and independent regeneration; no system PTRACE claim'}
 receipt.parent.mkdir(parents=True,exist_ok=True);receipt.write_text(json.dumps(result,indent=2)+'\n');return result

if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('--source-root',required=True);p.add_argument('--approved-parent',required=True);p.add_argument('--receipt',required=True);p.add_argument('--dry-run',action='store_true');args=p.parse_args()
 print(json.dumps(prepare_independent_tree(args.source_root,args.approved_parent,args.receipt,dry_run=args.dry_run),indent=2))
