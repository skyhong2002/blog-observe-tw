"""Generate blog family brand SVG/PNG assets.
Adapted from tag.observe.tw afe0a65 tools/brand-assets.py (MIT, Copyright (c) 2026 Sky Hong).
Noto Serif CJK TC glyph outlines use SIL OFL; tools need fontTools, Pillow and rsvg-convert.

  python3 tools/brand-assets.py               # glyph outlines -> SVG + TSX, then PNG/ICO
  python3 tools/brand-assets.py --raster-only # keep the committed SVG outlines, set the
                                              # mark to MARK, re-render PNG/ICO; also the
                                              # fallback when fontTools is not installed
After a full run, format web/src/components/Logo.tsx and Wordmark.tsx with Biome.
"""
from pathlib import Path
import re
import struct
import subprocess
import sys
try:
    from PIL import Image
except ImportError:
    Image = None  # favicon.ico is then packed from rsvg-convert PNG frames (see ico())

RASTER_ONLY = '--raster-only' in sys.argv[1:]
try:
    from fontTools.ttLib import TTFont
    from fontTools.pens.svgPathPen import SVGPathPen
except ImportError:
    # Without fontTools the glyph outlines cannot be rebuilt; the committed ones are reused.
    print('fontTools not installed: keeping committed SVG outlines (--raster-only)', file=sys.stderr)
    RASTER_ONLY = True
ROOT = Path(__file__).resolve().parents[1]
# The accent mark is brand-600, read from the shared token in web/src/lib/brand.ts
# (globals.css --color-brand-600 mirrors it; web/test/brand.test.ts checks both).
_token = re.search(r"\b600:\s*'(#[0-9a-fA-F]{6})'", (ROOT / 'web/src/lib/brand.ts').read_text())
if not _token:
    raise SystemExit('brand-600 not found in web/src/lib/brand.ts')
MARK = _token.group(1).lower()
OUT = ROOT / 'web/public/brand'
OUT.mkdir(parents=True, exist_ok=True)
pwa = ROOT / 'web/public/pwa'
pwa.mkdir(exist_ok=True)
OLD_MARKS = re.compile(r'#d9480f', re.IGNORECASE)  # upstream vermilion

def ico(target, sizes=(16, 32, 48)):
    """favicon.ico: Pillow downscales icon-192 as upstream does; without Pillow each size is
    rendered from icon.svg and stored as a PNG frame (ICO/PNG, read by every current browser)."""
    if Image is not None:
        Image.open(pwa/'icon-192.png').save(target, sizes=[(s, s) for s in sizes])
        return
    frames = [subprocess.run(['rsvg-convert', '-w', str(s), '-h', str(s), str(OUT/'icon.svg')], check=True, capture_output=True).stdout
              for s in sizes]
    offset = 6 + 16 * len(frames)
    head = struct.pack('<HHH', 0, 1, len(frames))
    for size, data in zip(sizes, frames):
        if data[:8] != b'\x89PNG\r\n\x1a\n':
            raise SystemExit('rsvg-convert did not return a PNG')
        head += struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    target.write_bytes(head + b''.join(frames))

def raster():
    """PNG/ICO from the SVGs on disk: PWA icons, apple-icon, favicon and the OG image."""
    for size in [192, 512]:
        subprocess.run(['rsvg-convert', '-w', str(size), '-h', str(size), str(OUT/'icon.svg'), '-o', str(pwa/f'icon-{size}.png')], check=True)
        subprocess.run(['rsvg-convert', '-w', str(size), '-h', str(size), str(OUT/'maskable.svg'), '-o', str(pwa/f'maskable-{size}.png')], check=True)
    subprocess.run(['rsvg-convert', '-w', '180', '-h', '180', str(OUT/'icon.svg'), '-o', str(ROOT/'web/src/app/apple-icon.png')], check=True)
    ico(ROOT/'web/src/app/favicon.ico')
    subprocess.run(['rsvg-convert', str(OUT/'og.svg'), '-o', str(ROOT/'web/public/opengraph-image.png')], check=True)

if RASTER_ONLY:
    # Only the mark colour changes; glyph paths and the TSX formatting stay as committed.
    for path in [OUT/'logo.svg', OUT/'icon.svg', OUT/'maskable.svg', OUT/'og.svg', ROOT/'web/src/app/icon.svg',
                 ROOT/'web/src/components/Logo.tsx']:
        source = path.read_text()
        updated = OLD_MARKS.sub(MARK, source)
        if f'fill="{MARK}"' not in updated:
            raise SystemExit(f'{path.relative_to(ROOT)}: no {MARK} mark; run the full generator')
        if updated != source:
            path.write_text(updated)
    raster()
    sys.exit(0)

font = TTFont('/usr/share/fonts/noto-cjk/NotoSerifCJK-SemiBold.ttc', fontNumber=3)

def glyph(ch, x, y, size, fill='currentColor'):
    gs = font.getGlyphSet()
    pen = SVGPathPen(gs)
    gs[font.getBestCmap()[ord(ch)]].draw(pen)
    k = size / font['head'].unitsPerEm
    return f'<path fill="{fill}" transform="translate({x} {y}) scale({k} {-k}) translate(0 -880)" d="{pen.getCommands()}"/>'

def svg(body, width=512, height=512):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}"><title>部落格觀察</title>{body}</svg>'

# Retain the upstream serif family and monochrome ink; the middle mark is the blog green (MARK).
# An open notebook replaces the split circle between the two lines of characters.
logo = ''.join(glyph(c, 31 + i*150, 32, 150) for i,c in enumerate('部落格'))
logo += ''.join(glyph(c, 70 + i*202, 274, 170) for i,c in enumerate('觀察'))
logo += '<path d="M231 220h22v34h-22z" fill="currentColor"/><path d="M259 220h22v34h-22z" fill="{MARK}"/>'.replace('{MARK}', MARK)
wordmark = ''.join(glyph(c, i*102, 0, 100) for i,c in enumerate('部落格觀察'))
(OUT/'logo.svg').write_text(svg(logo))
(OUT/'wordmark.svg').write_text(svg(wordmark,510,100))
for name, body, vb in [('Logo',logo,'0 0 512 512'),('Wordmark',wordmark,'0 0 510 100')]:
    signature = '{ className }: { className?: string }' if name=='Logo' else '{ className, height }: { className?: string; height?: number }'
    size = '' if name=='Logo' else ' {...(height ? { width: Math.round(height * 5.1), height } : {})}'
    (ROOT/f'web/src/components/{name}.tsx').write_text('// Generated by tools/brand-assets.py; Noto Serif CJK TC (SIL OFL).\n'+f'export default function {name}({signature}) {{\n return <svg viewBox="{vb}" className={{className}}{size} role="img" aria-label="部落格觀察"><title>部落格觀察</title>{body}</svg>;\n}}\n')
icon = '<rect width="512" height="512" rx="96" fill="#1c1c1f"/>'+glyph('觀',63,52,385,'#ffffff')+'<path d="M387 394h24v40h-24z" fill="#ffffff"/><path d="M417 394h24v40h-24z" fill="{MARK}"/>'.replace('{MARK}', MARK)
(OUT/'icon.svg').write_text(svg(icon))
(ROOT/'web/src/app/icon.svg').write_text(svg(icon))
mask = '<rect width="512" height="512" fill="#1c1c1f"/>'+f'<g transform="translate(64 64) scale(.75)">{icon}</g>'
(OUT/'maskable.svg').write_text(svg(mask))
og='<rect width="1200" height="630" fill="#fafafa"/><g transform="translate(70 60)">'+logo.replace('currentColor','#1c1c1f')+'</g>'
og+=''.join(glyph(c,650+(i%5)*66,220+(i//5)*94,58,'#1c1c1f') for i,c in enumerate('每一種生活各自怎麼寫'))
(OUT/'og.svg').write_text(svg(og,1200,630))
raster()
