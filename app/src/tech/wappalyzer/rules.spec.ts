import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compileVocabulary, loadWappalyzerRules, WAPPALYZER_NAMES, type WappalyzerPin } from './rules.ts';

const commit = 'a'.repeat(40);
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
let directory = '';
afterEach(() => directory && rmSync(directory, { recursive: true, force: true }));

function install(files: Record<string, string>, pinned: Record<string, string> = files): WappalyzerPin {
  directory = mkdtempSync(join(tmpdir(), 'wapp-'));
  mkdirSync(join(directory, commit, 'technologies'), { recursive: true });
  for (const [file, text] of Object.entries(files)) writeFileSync(join(directory, commit, file), text);
  return {
    repository: 'example/fork',
    commit,
    license: 'GPL-3.0',
    pinnedAt: '2026-10-22',
    files: Object.fromEntries(Object.entries(pinned).map(([file, text]) => [file, sha(text)])),
  };
}

describe('pinned Wappalyzer rules', () => {
  it('compiles only the published vocabulary and reports names the data no longer has', () => {
    const rules = compileVocabulary({ WordPress: { meta: { generator: '^WordPress' } }, 'Not Ours': { html: ['x'] } }, commit);
    expect([...rules.products.keys()]).toEqual(['wordpress']);
    expect(rules.missing).toContain('Hugo');
    expect(rules.missing).not.toContain('WordPress');
    expect(rules.version).toBe('wappalyzer-aaaaaaaaaaaa');
    // Every product id of the vocabulary maps to at least one name.
    for (const names of Object.values(WAPPALYZER_NAMES)) expect(names.length).toBeGreaterThan(0);
  });
  it('loads files that match the pin', () => {
    const pin = install({ 'technologies/a.json': JSON.stringify({ WordPress: { meta: { generator: '^WordPress' } } }) });
    expect(loadWappalyzerRules(directory, pin).products.has('wordpress')).toBe(true);
  });
  it('refuses a file that differs from the pin, and a file that is missing', () => {
    const original = JSON.stringify({ WordPress: {} });
    const altered = install(
      { 'technologies/a.json': JSON.stringify({ WordPress: { html: ['evil'] } }) },
      { 'technologies/a.json': original },
    );
    expect(() => loadWappalyzerRules(directory, altered)).toThrow(/altered/);
    const incomplete = install({ 'technologies/a.json': original });
    incomplete.files['technologies/b.json'] = sha('{}');
    expect(() => loadWappalyzerRules(directory, incomplete)).toThrow(/incomplete/);
  });
});
