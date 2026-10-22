/**
 * node tools/fetch-wappalyzer-rules.ts [--dir <rules-dir>]       download the pinned rule files and verify their hashes
 * node tools/fetch-wappalyzer-rules.ts --check [--dir <dir>]     load them and list mapped products the data no longer has
 * node tools/fetch-wappalyzer-rules.ts --update [--dir <dir>]    fetch enthec/webappanalyzer's newest commit into <dir> and
 *                                                                print the new pin; review it, then replace data/wappalyzer-pin.json
 *
 * The rules are GPL-3.0 and are never committed (the repository is MIT): they live in <rules-dir>/<commit>/, default
 * ~/.local/share/blog-observe/wappalyzer (BLOG_WAPPALYZER_RULES_DIR), next to the releases, not inside one.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defaultRulesDirectory, loadWappalyzerRules, readPin, type WappalyzerPin } from '../app/src/tech/wappalyzer/rules.ts';

const REPOSITORY = 'enthec/webappanalyzer';
const TECHNOLOGY_FILES = ['_', ...'abcdefghijklmnopqrstuvwxyz'].map((letter) => `technologies/${letter}.json`);
const argument = (name: string) => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
const directory = argument('--dir') ?? defaultRulesDirectory();
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

async function download(commit: string, file: string) {
  const response = await fetch(`https://raw.githubusercontent.com/${REPOSITORY}/${commit}/src/${file}`, {
    headers: { 'user-agent': 'blog-observe-rules-fetch' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
function store(commit: string, file: string, data: Buffer) {
  const path = join(directory, commit, file);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.part`;
  writeFileSync(temporary, data);
  renameSync(temporary, path);
}

if (process.argv.includes('--check')) {
  const rules = loadWappalyzerRules(directory);
  console.log(JSON.stringify({ version: rules.version, products: rules.products.size, missing: rules.missing }));
  process.exit(rules.missing.length ? 1 : 0);
}

if (process.argv.includes('--update')) {
  const latest = (await (
    await fetch(`https://api.github.com/repos/${REPOSITORY}/commits/main`, { headers: { 'user-agent': 'blog-observe-rules-fetch' } })
  ).json()) as {
    sha?: string;
  };
  if (!latest.sha || !/^[0-9a-f]{40}$/.test(latest.sha)) throw new Error('could not read the latest commit');
  const files: Record<string, string> = {};
  for (const file of [...TECHNOLOGY_FILES, 'categories.json']) {
    const data = await download(latest.sha, file);
    store(latest.sha, file, data);
    files[file] = sha256(data);
  }
  const pin: WappalyzerPin = {
    repository: REPOSITORY,
    commit: latest.sha,
    license: 'GPL-3.0',
    pinnedAt: new Date().toISOString().slice(0, 10),
    files,
  };
  console.log(JSON.stringify(pin, null, 2));
  console.error(
    `downloaded to ${join(directory, latest.sha)}; check the mapped products, run the tests, then replace data/wappalyzer-pin.json`,
  );
} else {
  const pin = readPin();
  for (const [file, expected] of Object.entries(pin.files)) {
    const data = await download(pin.commit, file);
    if (sha256(data) !== expected) throw new Error(`${file}: hash differs from the pin; refusing to install`);
    store(pin.commit, file, data);
  }
  console.log(JSON.stringify({ installed: join(directory, pin.commit), files: Object.keys(pin.files).length }));
}
