#!/usr/bin/env python3
"""Save one reviewer's raw output for a round, unedited, with the revealed mapping.

  python3 docs/design-review/tools/save_review.py ROUND REVIEWER TRANSCRIPT_OR_TEXT_FILE [NOTE]

TRANSCRIPT is the reviewer's Claude session .jsonl (the last assistant text is
taken) or a plain text file with the reviewer's final answer. Writes
docs/design-review/results/rROUND-REVIEWER.md and prints the per-set means of
the 12 category scores from the reviewer's JSON block.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path('/home/sky/.cache/weblog-ui-hill-climb')
DOCS = Path(__file__).resolve().parents[1]
CATEGORIES = ['資訊層級', '字體排印', '色彩', '間距與版面', '一致性', '資訊密度', '導覽', '狀態與回饋', '響應式', '文案', '無障礙', '動畫與轉場']


def final_text(path: Path) -> str:
    raw = path.read_text(encoding='utf-8')
    if not path.suffix == '.jsonl':
        return raw.strip()
    last = None
    for line in raw.splitlines():
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        message = entry.get('message') or {}
        if entry.get('type') == 'assistant' and message.get('role') == 'assistant':
            texts = [part.get('text', '') for part in message.get('content', []) if isinstance(part, dict) and part.get('type') == 'text']
            if any(t.strip() for t in texts):
                last = '\n'.join(texts)
    if last is None:
        raise SystemExit('no assistant text in transcript')
    return last.strip()


def main():
    number, reviewer, source = sys.argv[1], sys.argv[2], Path(sys.argv[3])
    note = sys.argv[4] if len(sys.argv) > 4 else ''
    text = final_text(source)
    private = json.loads((ROOT / 'private' / f'r{number}.json').read_text())
    mapping = private['mapping']
    blocks = re.findall(r'```json\s*(\{.*?\})\s*```', text, re.S)
    scores = json.loads(blocks[-1]) if blocks else {}
    means = {}
    for label, role in mapping.items():
        values = scores.get(label, {}).get('scores', [])
        means[role] = round(sum(values) / len(values), 2) if len(values) == 12 else None
    rows = '\n'.join(f'| {role} ({label}) | {means[role]} |' for label, role in sorted(mapping.items()))
    per_category = ''
    if all(len(scores.get(label, {}).get('scores', [])) == 12 for label in mapping):
        head = '| 項目 | ' + ' | '.join(mapping[l] for l in sorted(mapping)) + ' |'
        sep = '|---|' + '---:|' * len(mapping)
        lines = [head, sep]
        for i, name in enumerate(CATEGORIES):
            lines.append(f'| {name} | ' + ' | '.join(str(scores[l]['scores'][i]) for l in sorted(mapping)) + ' |')
        per_category = '\n'.join(lines)
    out = DOCS / 'results' / f'r{number}-{reviewer}.md'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        f"""# r{number} blind review: {reviewer}

{note}

- Brief: `brief.md`, SHA-256 `{private['briefSha256']}`
- Mapping (revealed after the review): {', '.join(f'**{l} = {mapping[l]}**' for l in sorted(mapping))}
- New set: `{Path(private['new']).name}`

| Set | Mean of 12 scores |
|---|---:|
{rows}

{per_category}

Raw reviewer output below, unedited.

---

{text}
""",
        encoding='utf-8',
    )
    print(out, json.dumps(means, ensure_ascii=False))


if __name__ == '__main__':
    main()
