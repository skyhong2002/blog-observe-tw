import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { aboutPageUrl, publicationContains } from './crawl/candidate-validation.ts';
import { type FeedCrawlerOptions, politeFetch, readFeedBody } from './crawl/feed.ts';
import { seedIdentityKey } from './crawl/seed-url-resolution.ts';

export const homeKey = (home: string) => createHash('sha256').update(seedIdentityKey(home)).digest('hex');
export type AccountEvidence = { kind: 'claim' | 'recommendation'; id: number; userId: number; home: string };
export type ClaimMethod = 'meta' | 'file' | 'about';
export const sameHome = (a: string, b: string) => seedIdentityKey(a) === seedIdentityKey(b);
export const claimFileUrl = (home: string, token: string) => {
  const url = new URL(home);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/weblog-verification-${token}.txt`;
  return url.href;
};
/** Remove visitor-controlled regions before looking for site-owned text. Never inspect arbitrary body text. */
export function claimMarker(html: string, token: string, method: 'meta' | 'about') {
  const $ = cheerio.load(html);
  $(
    'script,style,noscript,template,form,aside,nav,footer,[itemtype*="Comment"],[itemprop="comment"],[data-comment],[role="comment"]',
  ).remove();
  $('[id],[class]')
    .filter((_, el) => {
      const tokens = `${$(el).attr('id') || ''} ${$(el).attr('class') || ''}`.split(/\s+/);
      return tokens.some((t) =>
        /^(?:comments?(?:$|[-_])|commentlist$|disqus|giscus|utterances|remark42|cusdis|respond$|discussion|wp[-_](?:block[-_])?comments?|user[-_]|member[-_])/i.test(
          t,
        ),
      );
    })
    .remove();
  if (method === 'meta')
    return $('head meta[name="weblog-verification"]')
      .toArray()
      .some((el) => $(el).attr('content') === token);
  // Require the FIRST direct introduction paragraph. A nested visitor widget or a later
  // discussion cannot supply proof, even when its theme uses unknown class names.
  const content = $('[itemprop="articleBody"],.article-content,.entry-content,.post-content').first();
  const article = $('article').first();
  const root = content.length ? content : article.length ? article : $('main').first();
  const first = root.children('p,h2,h3,h4,h5,h6').first();
  return first.is('p') && first.text().trim() === `weblog-verification: ${token}`;
}
/** All requests retain crawler DNS pinning, per-hop checks, body bounds, robots policy and timeouts. */
export async function verifySiteClaim(home: string, token: string, method: ClaimMethod, options: FeedCrawlerOptions = {}) {
  const requested = method === 'file' ? claimFileUrl(home, token) : home;
  const response = await politeFetch(requested, {}, options);
  const final = response.url || requested;
  if (
    !response.ok ||
    !publicationContains(final, home) ||
    (method !== 'file' && !sameHome(final, home)) ||
    (method === 'file' && !sameHome(final, requested))
  ) {
    await response.body?.cancel();
    return null;
  }
  let html = await readFeedBody(response);
  let proofUrl = final;
  if (method === 'about') {
    const about = aboutPageUrl(html, home);
    if (!about) return null;
    const page = await politeFetch(about, {}, options);
    proofUrl = page.url || about;
    if (!page.ok || !sameHome(proofUrl, about) || !publicationContains(proofUrl, home)) {
      await page.body?.cancel();
      return null;
    }
    html = await readFeedBody(page);
  }
  const valid = method === 'file' ? html.trim() === `weblog-verification: ${token}` : claimMarker(html, token, method);
  return valid ? { proofUrl, sha256: createHash('sha256').update(html).digest('hex') } : null;
}

export async function accountEvidenceFor(db: Pool | PoolConnection, home: string): Promise<AccountEvidence | undefined> {
  const key = homeKey(home);
  const [claims] = await db.query<RowDataPacket[]>(
    "SELECT id,user_id,home_url FROM site_claims WHERE home_key=? AND status='verified' ORDER BY id LIMIT 1",
    [key],
  );
  if (claims[0]) return { kind: 'claim', id: Number(claims[0].id), userId: Number(claims[0].user_id), home: String(claims[0].home_url) };
  const [recommendations] = await db.query<RowDataPacket[]>(
    "SELECT id,user_id,home_url FROM site_recommendations WHERE home_key=? AND status='active' ORDER BY id LIMIT 1",
    [key],
  );
  if (recommendations[0])
    return {
      kind: 'recommendation',
      id: Number(recommendations[0].id),
      userId: Number(recommendations[0].user_id),
      home: String(recommendations[0].home_url),
    };
}
export async function validAccountEvidence(db: PoolConnection, home: string, evidence?: AccountEvidence) {
  if (!evidence || !sameHome(evidence.home, home)) return false;
  const table = evidence.kind === 'claim' ? 'site_claims' : evidence.kind === 'recommendation' ? 'site_recommendations' : null;
  if (!table) return false;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id FROM ${table} WHERE id=? AND user_id=? AND home_key=? AND status=? FOR UPDATE`,
    [evidence.id, evidence.userId, homeKey(home), evidence.kind === 'claim' ? 'verified' : 'active'],
  );
  return rows.length === 1;
}
