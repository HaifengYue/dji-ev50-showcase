from pathlib import Path
import subprocess,json,hashlib
P=Path(__file__).resolve().parents[1];folder=P/'renders/flight_sequence_v03';frames=sorted(folder.glob('frame_*.png'))
expected=[folder/f'frame_{i:04d}.png' for i in range(1,1801)]
missing=[str(p) for p in expected if not p.exists()]
assert not missing,f'Missing {len(missing)} frames; first: {missing[:3]}'
for p in expected:
 b=p.read_bytes()[:24];assert b[:8]==b'\x89PNG\r\n\x1a\n',p
 assert int.from_bytes(b[16:20],'big')==1920 and int.from_bytes(b[20:24],'big')==1080,p
dest=P/'renders/EV50_flight_60s_1080p.mp4'
subprocess.run(['ffmpeg','-hide_banner','-loglevel','warning','-y','-framerate','30','-i',str(folder/'frame_%04d.png'),'-frames:v','1800','-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',str(dest)],check=True)
report={'frames':1800,'width':1920,'height':1080,'fps':30,'duration_seconds':60,'video_bytes':dest.stat().st_size,'sequence_bytes':sum(p.stat().st_size for p in frames),'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'encoding':'H.264 yuv420p CRF19','source_sequence':str(folder)}
(P/'docs/video_validation_v03.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(dest),'-f','null','-'],check=True)
print('VIDEO_DECODE_CHECK_PASSED')
