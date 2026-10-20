// One read of a verified blog's homepage: the person it names as its author (filling 作者 for blogs whose feeds name
// nobody) and whether it introduces one person or an organisation (the directory's 經營者 filter, catalog.js).
import * as cheerio from 'cheerio';
import type { Pool } from 'mysql2/promise';
import { personalHomepage } from '../ai/personal.ts';
import { cleanAuthorName, normalizedAuthorName } from './author-name.ts';
import { type FeedCrawlerOptions, politeFetch, readFeedBody } from './feed.ts';

const fold = (value: string) => value.normalize('NFKC').toLocaleLowerCase('zh-TW').replace(/\s+/g, '');
const typesOf = (node: Record<string, unknown>) => [node['@type']].flat().map(String);

/** JSON-LD nodes, flattening @graph arrays. */
function jsonLdNodes($: cheerio.CheerioAPI) {
  const nodes: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      const node = value as Record<string, unknown>;
      nodes.push(node);
      if (node['@graph']) visit(node['@graph']);
    }
  };
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      visit(JSON.parse($(element).text()));
    } catch {
      // A broken block names nobody.
    }
  });
  return nodes;
}

/**
 * The person a homepage names as its author, or null. Order: a JSON-LD Person that is the site's author, creator or
 * owner (or the page's only Person), `<meta name="author">`, then an h-card name. A name that is the site's own name
 * ("Carrot Blog") is a site, not a person, and is not taken.
 */
export function siteAuthorName(html: string): string | null {
  const $ = cheerio.load(html);
  const siteNames = [
    $('head meta[property="og:site_name"]').attr('content'),
    $('head title').text(),
    ...jsonLdNodes($)
      .filter((node) => typesOf(node).some((type) => ['WebSite', 'Blog', 'Organization'].includes(type)))
      .map((node) => (typeof node.name === 'string' ? node.name : '')),
  ]
    .filter((name): name is string => Boolean(name?.trim()))
    .map(fold);
  const accept = (raw: unknown) => {
    const name = cleanAuthorName(typeof raw === 'string' ? raw : '');
    if (!name) return null;
    const key = fold(name);
    // The site's name, or a title such as "Carrot Blog | 首頁" made of it; "蘿蔔" in "蘿蔔的部落格" is still a person.
    const isSite = (site: string) => site === key || (site.startsWith(key) && /^[|｜\-–—:：·•]/.test(site.slice(key.length)));
    return siteNames.some(isSite) ? null : name;
  };
  const nodes = jsonLdNodes($);
  const people: unknown[] = [];
  for (const node of nodes)
    for (const key of ['author', 'creator', 'founder', 'accountablePerson'])
      for (const value of [node[key]].flat())
        if (value && typeof value === 'object' && typesOf(value as Record<string, unknown>).includes('Person'))
          people.push((value as Record<string, unknown>).name);
  const persons = nodes.filter((node) => typesOf(node).includes('Person'));
  if (persons.length === 1) people.push(persons[0].name);
  for (const candidate of [
    ...people,
    $('head meta[name="author" i]').attr('content'),
    $('.h-card .p-name, .h-card.p-name, .p-author .p-name, .p-author.h-card').first().text(),
  ]) {
    const name = accept(candidate);
    if (name) return name;
  }
  return null;
}

export type SiteObservation = {
  homepageUrl: string;
  httpStatus: number | null;
  authorName: string | null;
  personal: boolean | null;
  organization: boolean | null;
  reason: string;
  identitySnippet: string | null;
};

/** Read a homepage once; failures are an observation too (reason, nulls), never an exception. */
export async function observeSite(url: string, options: FeedCrawlerOptions = {}): Promise<SiteObservation> {
  const empty = { homepageUrl: url, authorName: null, personal: null, organization: null, identitySnippet: null };
  try {
    const response = await politeFetch(url, {}, options);
    if (!response.ok) {
      await response.body?.cancel();
      return { ...empty, httpStatus: response.status, reason: `homepage_http_${response.status}` };
    }
    const html = await readFeedBody(response);
    const { evidence } = personalHomepage(html);
    return {
      homepageUrl: url,
      httpStatus: response.status,
      authorName: siteAuthorName(html),
      personal: evidence.personal,
      organization: evidence.reason === 'organization_media_or_shop_evidence',
      reason: evidence.reason,
      identitySnippet: evidence.identitySnippet ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return { ...empty, httpStatus: null, reason: /robots/i.test(message) ? 'robots_disallowed' : 'homepage_unreachable' };
  }
}

type Sql = Pick<Pool, 'execute' | 'query'>;

/** Store the observation; a named author fills in a blog that has no author row yet (source_type 'homepage'). */
export async function writeSiteObservation(pool: Sql, blogId: number, observation: SiteObservation, now = new Date()) {
  await pool.execute(
    `INSERT INTO blog_site_observations (blog_id,homepage_url,http_status,author_name,personal,organization,reason,identity_snippet,observed_at)
       VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE homepage_url=VALUES(homepage_url),http_status=VALUES(http_status),
       author_name=VALUES(author_name),personal=VALUES(personal),organization=VALUES(organization),reason=VALUES(reason),
       identity_snippet=VALUES(identity_snippet),observed_at=VALUES(observed_at)`,
    [
      blogId,
      observation.homepageUrl.slice(0, 1024),
      observation.httpStatus,
      observation.authorName,
      observation.personal,
      observation.organization,
      observation.reason.slice(0, 64),
      observation.identitySnippet,
      now,
    ],
  );
  if (!observation.authorName) return false;
  const [named] = await pool.query(
    `SELECT 1 FROM blog_authors ba JOIN authors a ON a.id=ba.author_id
       WHERE ba.blog_id=? AND ba.status='active' AND a.status<>'rejected' LIMIT 1`,
    [blogId],
  );
  if ((named as unknown[]).length) return false;
  const normalized = normalizedAuthorName(observation.authorName);
  const [existing] = await pool.query(
    'SELECT a.id FROM authors a JOIN blog_authors ba ON ba.author_id=a.id WHERE ba.blog_id=? AND a.normalized_name=? LIMIT 1',
    [blogId, normalized],
  );
  let authorId = (existing as { id: number }[])[0]?.id;
  const evidence = JSON.stringify({ homepage: observation.homepageUrl });
  if (!authorId) {
    const [result] = await pool.execute(
      `INSERT INTO authors (display_name,normalized_name,source_type,source_url,source_evidence,first_seen_at,last_seen_at,created_at,updated_at)
         VALUES (?,?,'homepage',?,?,?,?,?,?)`,
      [observation.authorName, normalized, observation.homepageUrl.slice(0, 1024), evidence, now, now, now, now],
    );
    authorId = (result as { insertId: number }).insertId;
  }
  // Manual and community links are never replaced; a rejected homepage row stays rejected.
  await pool.execute(
    `INSERT INTO blog_authors (blog_id,author_id,role,status,is_primary,source_type,source_url,source_evidence,first_seen_at,last_seen_at,created_at,updated_at)
       VALUES (?,?,'author','active',1,'homepage',?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE last_seen_at=IF(blog_authors.source_type IN ('manual','community'),blog_authors.last_seen_at,VALUES(last_seen_at)),updated_at=VALUES(updated_at)`,
    [blogId, authorId, observation.homepageUrl.slice(0, 1024), evidence, now, now, now, now],
  );
  return true;
}

/**
 * Observe verified blogs, oldest observation first (never-observed first of all), one homepage at a time through
 * politeFetch's per-host pacing. `staleDays` skips blogs observed more recently.
 */
export async function observeSites(
  pool: Sql,
  { limit = 25, staleDays = 30, options = {} as FeedCrawlerOptions, now = () => new Date() } = {},
) {
  const [rows] = await pool.query(
    `SELECT b.id,b.url FROM blogs b LEFT JOIN blog_site_observations o ON o.blog_id=b.id
       WHERE b.status='verified' AND b.url IS NOT NULL AND b.url<>''
         AND (o.blog_id IS NULL OR o.observed_at < UTC_TIMESTAMP() - INTERVAL ? DAY)
       ORDER BY o.observed_at IS NOT NULL, o.observed_at, b.id LIMIT ?`,
    [staleDays, limit],
  );
  const result = { observed: 0, authorsAdded: 0, failed: 0 };
  for (const blog of rows as { id: number; url: string }[]) {
    const observation = await observeSite(blog.url, options);
    if (observation.httpStatus !== 200) result.failed++;
    if (await writeSiteObservation(pool, blog.id, observation, now())) result.authorsAdded++;
    result.observed++;
  }
  return result;
}
