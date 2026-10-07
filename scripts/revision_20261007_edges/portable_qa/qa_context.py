"""Explicit local path admission for the portable wing-contour QA scripts."""
from pathlib import Path
from types import SimpleNamespace
import argparse,sys

def bootstrap(require_baseline=False):
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    p=argparse.ArgumentParser(description='Run with Blender --background --python SCRIPT -- [these arguments]')
    p.add_argument('--project-root',required=True,type=Path)
    p.add_argument('--candidate',required=True,type=Path)
    p.add_argument('--baseline',required=require_baseline,type=Path)
    p.add_argument('--output-dir',type=Path)
    p.add_argument('--helper-dir',type=Path,default=Path(__file__).resolve().parent.parent)
    p.add_argument('--helper-module',default='repair_end_contours')
    a=p.parse_args(args);project=a.project_root.resolve();candidate=a.candidate.resolve();baseline=a.baseline.resolve() if a.baseline else None
    if not (project/'scripts/revision_20261007_inset/rebuild_rear_corner_flat.py').is_file():p.error('project-root must be the original project containing scripts/revision_20261007_inset/rebuild_rear_corner_flat.py')
    if not candidate.is_file():p.error('candidate must be a readable native Blend file')
    if baseline is not None and not baseline.is_file():p.error('baseline must be a readable native authoring Blend file')
    output=(a.output_dir or candidate.parent).resolve();output.mkdir(parents=True,exist_ok=True)
    sys.path[:0]=[str(a.helper_dir.resolve()),str(project/'scripts'),str(project/'scripts/revision_20261007_inset')]
    return SimpleNamespace(project=project,candidate=candidate,baseline=baseline,output=output,helper_dir=a.helper_dir.resolve(),helper_module=a.helper_module)
