from pathlib import Path
p=Path('threejs/src/style.css');s=p.read_text(encoding='utf-8');s+='\n.headline,.flight-info{text-shadow:0 2px 12px #10212ed9}.headline p,.flight-info .state-code,.flight-info .metric span{color:#e0e9ee}.headline{padding:12px 16px;margin-left:-16px;background:linear-gradient(90deg,#15263085,transparent);border-radius:8px}\n';p.write_text(s,encoding='utf-8')
p=Path('scripts/build_review_boards.py');s=p.read_text().replace("['v01','v02','v03']","['v04','v05']");p.write_text(s)
p=Path('scripts/package_project.py');s=p.read_text().replace("'models/v03','previews/v03'","'models/v05','previews/v05','.github'").replace('EV50_project.zip','EV50_project_v05.zip').replace('flight_scene_v02','flight_scene_v03');p.write_text(s)
p=Path('threejs/index.html');s=p.read_text(encoding='utf-8').replace('max="50"','max="60"').replace('/ 50.0','/ 60.0');p.write_text(s,encoding='utf-8')
p=Path('scripts/generate_flight.py');s=p.read_text().replace('Deterministic 50 s','Deterministic 60 s');p.write_text(s)
