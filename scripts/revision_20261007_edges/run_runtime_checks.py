from pathlib import Path
import os,json,subprocess,time,importlib.util
ROOT=Path(__file__).resolve().parents[2];stage=ROOT/os.environ['TRANSWING_INTEGRATED_STAGE'];out=stage/'checks';out.mkdir(exist_ok=True)
spec=importlib.util.spec_from_file_location('frozen_wrapper',ROOT/'tools/rebuild_inset_revision.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
results=[]
for name,cmd in m.commands('blender',ROOT)[4:13]:
    if name in ['baked-animation','runtime-compatibility']:
        cmd[-1]=cmd[-1].replace('revision_20261007_inset','revision_20261007_edges')
    start=time.time();print('RUN',name,flush=True)
    with (out/(name+'.log')).open('w')as f:p=subprocess.run(cmd,cwd=ROOT,stdout=f,stderr=subprocess.STDOUT)
    results.append({'name':name,'exitCode':p.returncode,'seconds':round(time.time()-start,3)})
    (out/'RUNTIME_CHECK_COMMANDS.json').write_text(json.dumps(results,indent=2))
    if p.returncode:raise SystemExit('Failed '+name)
print('RUNTIME_CHECKS_PASSED',flush=True)
