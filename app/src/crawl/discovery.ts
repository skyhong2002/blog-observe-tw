import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { Pool } from 'mysql2/promise';
import { politeFetch } from './feed.ts';
import { discoverSimilarSites } from './similarweb.ts';

const BLOGROLL_PAGES = ['https://blogblog.club/blogrollroll', 'https://blogblog.club/party', 'https://blogblog.club/random'];
const normalize = (value: string, base: string) => {
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};

async function saveCandidate(pool: Pool, url: string, name: string | null, sourceType: string, sourceUrl: string, evidence: object) {
  const [result] = await pool.execute(
    'INSERT IGNORE INTO discovery_candidates (url,name,source_type,source_url,source_evidence,discovered_at) VALUES (?,?,?,?,?,?)',
    [url, name, sourceType, sourceUrl, JSON.stringify(evidence), new Date()],
  );
  return Number(result && typeof result === 'object' && 'affectedRows' in result ? result.affectedRows : 0);
}

export async function discoverBlogblog(pool: Pool, userAgent?: string) {
  const results = [];
  for (const sourceUrl of BLOGROLL_PAGES) {
    try {
      const response = await politeFetch(sourceUrl, { accept: 'text/html,application/xhtml+xml' }, { userAgent, delayMs: 1500 });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const $ = cheerio.load(await response.text());
      let inserted = 0;
      for (const element of $('a[href]').toArray()) {
        const url = normalize($(element).attr('href') || '', sourceUrl);
        if (!url || new URL(url).hostname === new URL(sourceUrl).hostname) continue;
        inserted += await saveCandidate(pool, url, $(element).text().trim() || null, 'blogblog-club', sourceUrl, {
          anchorText: $(element).text().trim() || null,
          sourceUrl,
          fingerprint: createHash('sha256').update(url).digest('hex'),
        });
      }
      results.push({ sourceUrl, inserted });
    } catch (error) {
      results.push({ sourceUrl, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { source: 'blogblog-club', results };
}

export async function discoverSimilar(pool: Pool, domains: string[], options: Parameters<typeof discoverSimilarSites>[1] = {}) {
  const results = [];
  for (const domain of [...new Set(domains)].slice(0, 10)) {
    const result = await discoverSimilarSites(domain, options);
    let inserted = 0;
    for (const host of result.candidates)
      inserted += await saveCandidate(pool, `https://${host}`, host, 'similarweb-similar-sites', `similarweb://${domain}`, {
        domain,
        fetchedAt: new Date().toISOString(),
      });
    results.push({ ...result, domain, inserted });
  }
  return { source: 'similarweb-similar-sites', results };
}
