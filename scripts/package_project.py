from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
P=Path(__file__).resolve().parents[1];out=P/'deliverables';out.mkdir(exist_ok=True)
with ZipFile(out/'EV50_project_v05.zip','w',compression=ZIP_DEFLATED,compresslevel=6) as z:
 for base in ['blender','scripts','docs','threejs','models/v05','previews/v05','.github']:
  for f in (P/base).rglob('*'):
   if not f.is_file() or any(s in f.parts for s in ['node_modules','dist','__pycache__']):continue
   if f.suffix=='.blend1':continue
   z.write(f,str(f.relative_to(P)))
 for f in (P/'previews').glob('flight_v03_*.png'):z.write(f,str(f.relative_to(P)))
 for p in ['README.md','PROGRESS.md','models/ev50_flight_scene_v03.blend']:
  if (P/p).exists():z.write(P/p,p)
print('PACKAGED',out/'EV50_project_v05.zip')
