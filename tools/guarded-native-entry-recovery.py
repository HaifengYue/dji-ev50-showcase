"""Explicit-root Blender execution guard. Supplies no geometry or physical tolerance.

Guards the actual save/export operators used by this constructor and Python
filesystem mutations. This is not a claim of system-wide native syscall tracing.
"""
from pathlib import Path
import argparse
import builtins
import json
import os
import runpy
import sys


def validate_root(expected):
    root=Path(expected).resolve(strict=True)
    own=Path(__file__).resolve().parents[1]
    if root.name!='transwing-studio' or root!=own:
        raise RuntimeError('Explicit root must equal the root containing this absolute guard script')
    if Path.cwd().resolve()!=root or Path(os.environ.get('PWD','/')).resolve()!=root:
        raise RuntimeError('Actual cwd and inherited PWD must both equal explicit root')
    temp=Path(os.environ.get('TMPDIR','/')).resolve(strict=True)
    if not temp.is_relative_to(root):
        raise RuntimeError('TMPDIR must be an existing directory inside this root')
    return root


def install_guard(root):
    import bpy
    sys.dont_write_bytecode=True
    def destination(value):
        if isinstance(value,int):
            return None
        text=os.fsdecode(os.fspath(value))
        if text.startswith('//'):
            text=bpy.path.abspath(text)
        p=Path(text)
        if not p.is_absolute():
            p=Path.cwd()/p
        # Resolve existing ancestor symlinks before admitting a path.
        p=p.resolve()
        if not p.is_relative_to(root):
            raise PermissionError('Write target outside explicit root: '+str(p))
        return p
    def audit(event,args):
        if event=='open' and args:
            mode=args[1] if len(args)>1 else None
            flags=args[2] if len(args)>2 else 0
            writing=(isinstance(mode,str) and any(x in mode for x in 'wax+')) or (isinstance(flags,int) and flags & (os.O_WRONLY|os.O_RDWR|os.O_CREAT|os.O_TRUNC|os.O_APPEND))
            if writing:destination(args[0])
        elif event in ('os.remove','os.rmdir','os.mkdir') and args:
            destination(args[0])
        elif event=='os.rename' and len(args)>=2:
            destination(args[0]);destination(args[1])
    operator_type=type(bpy.ops.wm.save_as_mainfile)
    original_call=operator_type.__call__
    def guarded_call(self,*args,**kwargs):
        name=self.idname_py()
        if name in ('wm.save_as_mainfile','wm.save_mainfile','export_scene.gltf'):
            path=kwargs.get('filepath')
            if not path and name=='wm.save_mainfile':path=bpy.data.filepath
            if not path:raise PermissionError('Explicit native write filepath required: '+name)
            destination(path)
        return original_call(self,*args,**kwargs)
    operator_type.__call__=guarded_call
    sys.addaudithook(audit)
    return destination


def verify_project_modules(root,contract):
    names={Path(r['path']).stem for r in contract['files'] if r['path'].startswith('scripts/') and r['path'].endswith('.py')}
    for name in names:
        module=sys.modules.get(name)
        if module is None:continue
        path=getattr(module,'__file__',None)
        if path is None or not Path(path).resolve().is_relative_to(root/'scripts'):
            raise RuntimeError('Constructor module resolved outside explicit root: '+name)


def probe(root,config):
    import bpy
    config=Path(config).resolve(strict=True)
    if not config.is_relative_to(root):raise PermissionError('Probe description outside root')
    data=json.loads(config.read_text());rows=[]
    for item in data['operations']:
        path=item['path'];kind=item['kind'];rejected=False
        try:
            if kind=='python':Path(path).write_text('guard-positive\n')
            elif kind=='blend':bpy.ops.wm.save_as_mainfile(filepath=path)
            elif kind=='gltf':bpy.ops.export_scene.gltf(filepath=path,export_format='GLB')
            else:raise ValueError('Unknown probe operation')
        except PermissionError:
            rejected=True
        if rejected!=(item['expect']=='reject'):
            raise AssertionError('Probe guard expectation failed: '+str(item))
        rows.append({'kind':kind,'path':path,'rejected':rejected})
    print('ROOT_GUARD_PROBE='+json.dumps({'root':str(root),'operations':rows,'passed':True}),flush=True)


def main():
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    parser=argparse.ArgumentParser();parser.add_argument('--expected-root',required=True);parser.add_argument('--probe-json')
    args=parser.parse_args(argv);root=validate_root(args.expected_root)
    os.environ['PYTHONDONTWRITEBYTECODE']='1';sys.dont_write_bytecode=True
    install_guard(root)
    if args.probe_json:
        probe(root,args.probe_json);return
    lock=root/'CONSTRUCTION_INPUTS.json';contract=json.loads(lock.read_text())
    sys.path.insert(0,str(root/'scripts'))
    verify_project_modules(root,contract)
    import constructor_inputs
    constructor_inputs.verify_locked_inputs(root)
    entry=root/'scripts/generate_transwing.py'
    runpy.run_path(str(entry),run_name='__main__')
    verify_project_modules(root,contract)
    constructor_inputs.verify_locked_inputs(root)
    print('ROOT_GUARD_COMPLETED='+json.dumps({'root':str(root),'inputCount':len(contract['files']),'systemTraceClaimed':False}),flush=True)


if __name__=='__main__':main()
