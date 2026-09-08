import json,struct,hashlib,math
from pathlib import Path
P=Path(__file__).resolve().parents[1];checks={}
p=P/'models/v05/ev50_v05.glb';b=p.read_bytes();magic,version,size=struct.unpack_from('<III',b);n=struct.unpack_from('<I',b,12)[0];d=json.loads(b[20:20+n])
checks['glb_header']=magic==0x46546c67 and version==2 and size==len(b)
checks['glb_has_real_geometry']=len(d.get('meshes',[]))>80 and len(d['accessors'])>0
nodes=d['nodes'];checks['lift_pivots']=sum(x.get('name','').startswith('LiftRotor_') for x in nodes)==8;checks['cruise_pivots']=sum(x.get('name','').startswith('CruiseRotor_') for x in nodes)==3
checks['embedded_textures']=all('bufferView' in x for x in d.get('images',[]))
checks['three_model_matches']=hashlib.sha256(b).digest()==hashlib.sha256((P/'threejs/public/ev50.glb').read_bytes()).digest()
checks['all_review_views']=all((P/'previews'/v/(a+'.png')).exists() for v in ['v01','v02','v03','v04','v05'] for a in ['front','rear','left','right','top','bottom','perspective'])
checks['versioned_blend_files']=all((P/'models'/v/f'ev50_{v}.blend').stat().st_size>100000 for v in ['v01','v02','v03','v04','v05'])
frames=json.loads((P/'threejs/public/flight.json').read_text())['frames'];checks['flight_sample_count']=len(frames)==1801
checks['closed_loop']=frames[0]['position']==frames[-1]['position'] and frames[0]['lift']==frames[-1]['lift']==0
checks['no_position_teleport']=max(math.dist(a['position'],z['position']) for a,z in zip(frames,frames[1:]))<.6
checks['bank_is_gentle']=max(abs(f['roll']) for f in frames)<math.radians(10)
checks['all_states']=len(set(f['state'] for f in frames))==9
tris=sum(d['accessors'][p['indices']]['count']//3 for m in d['meshes'] for p in m['primitives'] if 'indices' in p)
report={'checks':checks,'glb_bytes':len(b),'glb_triangles':tris,'sha256':hashlib.sha256(b).hexdigest(),'frame_count':len(frames)}
(P/'docs/output_validation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));assert all(checks.values())
