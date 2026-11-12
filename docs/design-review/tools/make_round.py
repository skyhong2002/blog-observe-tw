#!/usr/bin/env python3
"""Assemble one blind review round.

  python3 docs/design-review/tools/make_round.py ROUND NEW_SET_DIR

Copies the fixed baseline set (main), this round's new set and the fixed
reference set into ROOT/rounds/rROUND/{A,B,C} in random order, plus a
byte-identical copy of brief.md. The A/B/C mapping is written outside the
review folder, to ROOT/private/rROUND.json, and only read after the review.
"""
import hashlib
import json
import random
import shutil
import sys
from pathlib import Path

ROOT = Path('/home/sky/.cache/weblog-ui-hill-climb')
DOCS = Path(__file__).resolve().parents[1]


def main():
    number, new_set = sys.argv[1], Path(sys.argv[2])
    brief = DOCS / 'brief.md'
    sets = {'baseline': ROOT / 'sets/baseline', 'new': new_set, 'reference': ROOT / 'sets/reference'}
    labels = ['A', 'B', 'C']
    random.SystemRandom().shuffle(labels)
    mapping = dict(zip(labels, sets))
    out = ROOT / f'rounds/r{number}'
    if out.exists():
        shutil.rmtree(out)
    for label, name in mapping.items():
        target = out / label
        target.mkdir(parents=True)
        for image in sorted(sets[name].glob('*.png')):
            shutil.copy2(image, target / image.name)
    shutil.copy2(brief, out / 'brief.md')
    digest = hashlib.sha256(brief.read_bytes()).hexdigest()
    private = ROOT / 'private'
    private.mkdir(parents=True, exist_ok=True)
    (private / f'r{number}.json').write_text(json.dumps({'round': number, 'mapping': mapping, 'new': str(new_set), 'briefSha256': digest}, indent=2))
    print(out, digest)


if __name__ == '__main__':
    main()
