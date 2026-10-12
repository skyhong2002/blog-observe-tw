#!/usr/bin/env python3
"""Validate actual HTML metadata and the supported schema.org JSON-LD shapes."""
import json,sys,urllib.request
from html.parser import HTMLParser
from urllib.parse import urlsplit
class Page(HTMLParser):
    def __init__(self):
        super().__init__();self.meta={};self.canonical=[];self.schemas=[];self.capture=False;self.text=''
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='meta':self.meta[a.get('name',a.get('property',''))]=a.get('content','')
        if tag=='link' and a.get('rel')=='canonical':self.canonical.append(a.get('href'))
        if tag=='script' and a.get('type')=='application/ld+json':self.capture=True;self.text=''
    def handle_data(self,data):
        if self.capture:self.text+=data
    def handle_endtag(self,tag):
        if tag=='script' and self.capture:self.capture=False;self.schemas.append(json.loads(self.text))
def absolute(value):
    assert isinstance(value,str) and urlsplit(value).scheme=='https' and urlsplit(value).netloc,value
    return value
def validate(schema):
    assert schema.get('@context')=='https://schema.org'
    nodes=schema.get('@graph',[schema]);types=[]
    for node in nodes:
        typ=node.get('@type');types.append(typ)
        if typ in ('WebSite','Organization'):
            assert isinstance(node.get('name'),str) and node['name'];absolute(node['url'])
            if typ=='Organization':absolute(node['logo'])
            if 'potentialAction' in node:
                action=node['potentialAction'];assert action['@type']=='SearchAction'
                assert action['target']['@type']=='EntryPoint';absolute(action['target']['urlTemplate'])
                assert '{search_term_string}' in action['target']['urlTemplate']
                assert action['query-input']=='required name=search_term_string'
        elif typ=='BreadcrumbList':
            assert len(node['itemListElement'])>=2
            for pos,item in enumerate(node['itemListElement'],1):
                assert item['@type']=='ListItem' and item['position']==pos
                assert isinstance(item['name'],str) and item['name'];absolute(item['item'])
        else:raise AssertionError('Unsupported schema shape: '+str(typ))
    return types
base=sys.argv[1].rstrip('/') if len(sys.argv)>1 else 'https://blog.observe.tw'
# Public API only supplies the canonical topic ID; no private data is queried.
with urllib.request.urlopen(base+'/api/v1/topics',timeout=30) as r:topics=json.load(r)
items=topics.get('items',topics.get('data',[]));topic=items[0]['id']
from urllib.parse import quote
paths=['/','/blogs/kocpc/','/topics/'+quote(topic,safe='')+'/'];results=[]
for path in paths:
    with urllib.request.urlopen(base+path,timeout=30) as r:assert r.status==200;body=r.read().decode()
    p=Page();p.feed(body);url='https://blog.observe.tw'+path
    assert p.canonical==[url],p.canonical
    assert p.meta['description'] and p.meta['og:title'] and p.meta['og:description']
    assert p.meta['og:url']==url and p.meta['twitter:card']=='summary_large_image'
    assert p.schemas
    types=[typ for s in p.schemas for typ in validate(s)]
    results.append({'url':url,'schemas':types,'metadata':'valid'})
print(json.dumps(results,ensure_ascii=False,indent=2))
