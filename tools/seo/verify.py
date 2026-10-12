#!/usr/bin/env python3
"""Read-only sitemap/canonical smoke check. Optional origin is a local preview."""
import json,re,sys,urllib.request,xml.etree.ElementTree as ET
from urllib.parse import urlsplit
ORIGIN='https://blog.observe.tw'
base=sys.argv[1].rstrip('/') if len(sys.argv)>1 else ORIGIN
ns={'s':'http://www.sitemaps.org/schemas/sitemap/0.9'}
def get(url):
    target=base+url[len(ORIGIN):] if url.startswith(ORIGIN) else base+url
    with urllib.request.urlopen(urllib.request.Request(target,headers={'User-Agent':'BlogObserve-SEO-Verification/1.0'}),timeout=45) as response:
        assert response.status==200 and response.url==target,(target,response.status,response.url)
        return response.read(),response.headers
robots,headers=get('/robots.txt')
assert headers.get_content_type()=='text/plain'
assert robots.decode().strip().endswith('Sitemap: '+ORIGIN+'/sitemap.xml')
index,headers=get('/sitemap.xml')
assert headers.get_content_type() in ('application/xml','text/xml')
result={'sitemap':ORIGIN+'/sitemap.xml','children':[]}
for child in ET.fromstring(index).findall('s:sitemap',ns):
    loc=child.findtext('s:loc',namespaces=ns)
    assert child.findtext('s:lastmod',namespaces=ns)
    xml,_=get(loc);rows=ET.fromstring(xml).findall('s:url',ns)
    assert len(rows)<=50000 and len(xml)<=50*1024*1024
    urls=[]
    for row in rows:
        url=row.findtext('s:loc',namespaces=ns)
        assert url.startswith(ORIGIN+'/') and not urlsplit(url).query and url.endswith('/')
        assert row.findtext('s:lastmod',namespaces=ns)
        urls.append(url)
    samples=[]
    for position in sorted(set([0,len(urls)//2,len(urls)-1])) if urls else []:
        url=urls[position];html,h=get(url);text=html.decode()
        assert re.findall(r'<link rel="canonical" href="([^"]+)"',text)==[url],url
        assert 'noindex' not in h.get('X-Robots-Tag','').lower(),url
        assert not any('noindex' in value.lower() for value in re.findall(r'<meta name="robots" content="([^"]+)"',text)),url
        samples.append(url)
    result['children'].append({'url':loc,'count':len(rows),'bytes':len(xml),'verifiedSamples':samples})
print(json.dumps(result,ensure_ascii=False,indent=2))
