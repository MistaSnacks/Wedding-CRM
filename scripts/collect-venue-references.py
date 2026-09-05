#!/usr/bin/env python3
"""Collect public official venue references, retaining attribution and originals locally."""
import concurrent.futures,hashlib,html,json,re,urllib.request,urllib.parse
from pathlib import Path
from html.parser import HTMLParser
ROOT=Path(__file__).resolve().parents[1]/'research/benavento'
ROOT.mkdir(parents=True,exist_ok=True);(ROOT/'images').mkdir(exist_ok=True)
PAGES=['https://benavento.com/','https://benavento.com/espacios-para-eventos/','https://benavento.com/areas-generales/','https://benavento.com/galeria/','https://benavento.com/planning/','https://www.salondeeventosbenavento.com/','https://www.salondeeventosbenavento.com/instalaciones','https://www.salondeeventosbenavento.com/jardin-y-terraza-para-bodas-en-guadalajara','https://www.salondeeventosbenavento.com/galeria','https://www.aearquitectos.mx/en/projects-1/benavento']
def fetch(url):
 req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 (venue-reference-research)'})
 with urllib.request.urlopen(req,timeout=35) as r:return r.read(12_000_000),r.headers.get('Content-Type','')
class Assets(HTMLParser):
 def __init__(self):super().__init__();self.assets=[];self.links=[]
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='a' and a.get('href'):self.links.append(a['href'])
  for k,v in attrs:
   if v and k in ('src','data-src','data-image','data-bg','poster','href','srcset','data-srcset','style','data-settings'):
    for u in re.findall(r'https?://[^\s\"\'<>\\,)]+',html.unescape(v).replace('\\/','/')):self.assets.append((u,a.get('alt','')))
def page(url):
 try:
  raw,_=fetch(url);text=raw.decode('utf-8','replace');p=Assets();p.feed(text)
  # Also inspect public media URLs embedded in the page's gallery configuration.
  for u in re.findall(r'https?://[^\s\"\'<>\\,)]+',html.unescape(text).replace('\\/','/')):p.assets.append((u,''))
  return {'url':url,'assets':p.assets,'links':p.links,'error':None}
 except Exception as e:return {'url':url,'assets':[],'links':[],'error':str(e)}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:pages=list(pool.map(page,PAGES))
records={};links=set()
for p in pages:
 for u,alt in p['assets']:
  u=html.unescape(u).rstrip(']}')
  if 'static.wixstatic.com/media/' in u:
   match=re.match(r'(https://static\.wixstatic\.com/media/[^/]+\.(?:jpg|png|webp))',u,re.I)
   if match:u=match.group(1)
  parts=urllib.parse.urlsplit(u)
  if not re.search(r'\.(jpe?g|png|webp|mp4|pdf|glb|gltf|fbx|obj|usdz)(?:$|\?)',u,re.I):continue
  if not(parts.netloc.endswith('benavento.com') or parts.netloc.endswith('squarespace-cdn.com') or parts.netloc.endswith('squarespace.com') or parts.netloc=='static.wixstatic.com'):continue
  if re.search(r'logo|favicon|icon-|arrow|placeholder|pinterest|facebook|instagram|loading|whatsapp',parts.path,re.I):continue
  if parts.netloc=='benavento.com':u=re.sub(r'-\d+x\d+(?=\.(?:jpe?g|png|webp))','',u)
  key=urllib.parse.urlsplit(u)._replace(query='',fragment='').geturl()
  kind='image' if re.search(r'\.(jpe?g|png|webp)$',urllib.parse.urlsplit(key).path,re.I) else 'document' if key.lower().endswith('.pdf') else 'model' if re.search(r'\.(glb|gltf|fbx|obj|usdz)$',key,re.I) else 'video'
  r=records.setdefault(key,{'url':key,'kind':kind,'alt':alt,'pages':[]})
  if alt:r['alt']=alt
  if 'aearquitectos.mx' in p['url']:r.update(category='Architect proposal',alt='Architect project reference — 2022 proposal, not verified as-built')
  if p['url'] not in r['pages']:r['pages'].append(p['url'])
 for u in p['links']:
  if any(k in u for k in ['youtu','vimeo','instagram','facebook','matterport','.pdf','.glb']):links.add(u)
def download(r):
 if r['kind']!='image':return r
 try:
  name=hashlib.sha256(r['url'].encode()).hexdigest()[:12]+Path(urllib.parse.urlsplit(r['url']).path).suffix.lower();path=ROOT/'images'/name
  if not path.exists():
   data,mime=fetch(r['url'])
   if not mime.startswith('image/'):raise ValueError('Not image content')
   if len(data)>=12_000_000:raise ValueError('Image over research download limit')
   path.write_bytes(data)
  data=path.read_bytes();r.update(local='images/'+name,bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
 except Exception as e:r['error']=str(e)
 return r
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:assets=list(pool.map(download,records.values()))
seen=set();unique=[]
for r in assets:
 if r.get('sha256') in seen:continue
 if r.get('sha256'):seen.add(r['sha256'])
 unique.append(r)
out={'venue':'Edén Benavento','retrieved':'2026-09-04','usage':'Reference research. Photos belong to their owners; no redistribution license inferred.','pages':[{'url':p['url'],'error':p['error']} for p in pages],'assets':unique,'externalLinks':sorted(links)}
(ROOT/'manifest.json').write_text(json.dumps(out,indent=2,ensure_ascii=False))
print(json.dumps({'pages':len(pages),'images':sum('local' in r for r in unique),'videos':sum(r['kind']=='video' for r in unique),'documents':sum(r['kind']=='document' for r in unique),'models':sum(r['kind']=='model' for r in unique),'errors':sum(bool(r.get('error')) for r in unique),'externalLinks':sorted(links)},ensure_ascii=False))
