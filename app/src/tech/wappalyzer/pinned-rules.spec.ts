import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { documentPlatform } from '../platform.ts';
import { matchInputOf } from './input.ts';
import { MATCH_BUDGET_MS, matchTech } from './matcher.ts';
import { defaultRulesDirectory, loadWappalyzerRules, readPin, setWappalyzerRulesForTest } from './rules.ts';

// The pinned third-party data is GPL-3.0 and not in the repository: these run where tools/fetch-wappalyzer-rules.ts has
// installed it (every deployed host) and are skipped elsewhere.
const installed = existsSync(join(defaultRulesDirectory(), readPin().commit, 'categories.json'));

describe.skipIf(!installed)('the pinned Wappalyzer rules', () => {
  const rules = loadWappalyzerRules();
  const run = (html: string, headers: Record<string, string> = {}) => {
    const { input } = matchInputOf('https://blog.example/', html, headers);
    const found = new Map<string, number>();
    for (const [id, entries] of rules.products)
      for (const entry of entries) {
        const result = matchTech(entry, input);
        if (result) found.set(id, Math.max(found.get(id) ?? 0, result.confidence));
      }
    return found;
  };

  it('has every product of the published vocabulary', () => {
    expect(rules.missing).toEqual([]);
  });
  it('reads a Hugo page whose post shows another site’s WordPress image as Hugo only', () => {
    const html = `<head><meta name="generator" content="Hugo 0.161.1"></head><body><article>
      <img src="https://www.stardewvalley.net/wp-content/uploads/2018/12/Multiplayer_Screenshot2-1.png"></article></body>`;
    expect([...run(html).keys()]).toEqual(['hugo']);
    setWappalyzerRulesForTest(rules);
    expect(documentPlatform('https://blog.example/', html)).toBe('hugo');
    setWappalyzerRulesForTest(null);
  });
  it('reads a WordPress head as WordPress', () => {
    const html = `<head><meta name="generator" content="WordPress 6.8">
      <link rel="stylesheet" href="https://blog.example/wp-content/themes/astra/style.css"></head>`;
    expect(run(html).has('wordpress')).toBe(true);
  });
  it.each([
    ['repeated <link', '<link rel="stylesheet" '.repeat(22_000)],
    ['repeated <script', '<script '.repeat(64_000)],
    ['repeated <div', '<div class="'.repeat(43_000)],
    ['one huge inline script', `<script>${'x'.repeat(60_000)}</script>`.repeat(8)],
  ])('is bounded on hostile input: %s', (_label, html) => {
    const started = performance.now();
    run(html);
    // The page budget plus one small window's worth of overrun, not the seconds an unbounded run takes.
    expect(performance.now() - started).toBeLessThan(MATCH_BUDGET_MS * 4);
  });
});
