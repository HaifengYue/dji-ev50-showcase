import re,json,html,subprocess,concurrent.futures,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'references'; OUT.mkdir(exist_ok=True)
s=(ROOT/'ev50_page.html').read_text(encoding='utf-8')
m=re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>',s,re.S)
data=json.loads(m.group(1)) if m else {}
(OUT/'page_data.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
urls=list(dict.fromkeys(html.unescape(u).replace('\\u0026','&') for u in re.findall(r'https://www-cdn\.djiits\.com/[^\s"<>]+',s)))
urls=[u for u in urls if re.search(r'\.(jpg|png|mp4)(\?|$)',u) and '@origin' not in u and ')' not in u]
(OUT/'asset_manifest.json').write_text(json.dumps({'page':'https://www.dji.com/cn/ev50','http_status':200,'assets':urls},indent=2),encoding='utf-8')
chosen=[u for u in urls if '/dps/' in u and '?w=' in u]
chosen += [u for u in urls if '.mp4' in u][:1]
def get(u):
 p=OUT/u.split('/')[-1].split('?')[0]
 if not p.exists():
  subprocess.run(['C:/Windows/System32/curl.exe','-f','-sS','-L','--max-time','90','-A','Mozilla/5.0',u,'-o',str(p)],check=True)
 return p.name,p.stat().st_size
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
 for result in ex.map(get,chosen):print(result)
