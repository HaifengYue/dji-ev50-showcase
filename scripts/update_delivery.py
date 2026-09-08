from pathlib import Path
p=Path('scripts/finalize_video.py');s=p.read_text().replace('flight_sequence_v02','flight_sequence_v03').replace('1501','1801').replace('1500','1800').replace('EV50_flight_50s','EV50_flight_60s').replace("'duration_seconds':50","'duration_seconds':60").replace('video_validation.json','video_validation_v03.json');p.write_text(s)
p=Path('scripts/package_project.py');s=p.read_text().replace("for p in ['README.md'", "for f in (P/'previews').glob('flight_v03_*.png'):z.write(f,str(f.relative_to(P)))\n for p in ['README.md'");p.write_text(s)
p=Path('docs/ASSUMPTIONS.md');s=p.read_text(encoding='utf-8').replace('官方参考素材仅保存在本地研究，不作为原创输出或重新授权资产。','官方参考素材用于研究溯源，不由展示网页加载，不作为原创输出或重新授权资产。');p.write_text(s,encoding='utf-8')
