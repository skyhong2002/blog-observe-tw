import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { politeFetch } from '../crawl/feed.ts';
import { reserveBudget } from '../jobs/budget.ts';
import type { BatchOptions, BatchResult } from '../jobs/contracts.ts';
import { withJobLease } from '../jobs/lease.ts';
import { identityKey, normalizeLink, type PublicationAlias, publicationDecision, publicationHome, resolvePublication } from './identity.ts';
import type { ParsedLink } from './parser.ts';
import { invalidateRelationCache } from './routes.ts';
import { discoverCandidateLinks, loadAliases } from './store.ts';
import { budgetedRelationFetcher, relationBudgetAvailable, relationFailureCode } from './worker.ts';

const MARKER = /blogroll|部落卷|部落格卷|部落圈|友站|友情連結|友情链接|推薦部落格|推荐博客/i;
const REGIONS = '#blogroll,.blogroll,.blogroll-links,.linkcat,[id^="linkcat-"]';
const COMMENTS =
  '#comments,#respond,[id^="comment-"],.comment,.comments,.comment-list,.commentlist,.comment-body,.comment-content,[role="comment"]';
const EXCLUDED = `${COMMENTS},nav,header,footer,form,.sharedaddy,.jp-relatedposts,.yarpp,.addtoany,.post-tags,.tagcloud`;
const trim = (s: string, max: number) => Array.from(s.replace(/\s+/g, ' ').trim()).slice(0, max).join('');
export type HomeDiscovery = { links: ParsedLink[]; childUrl: string | null; truncated: boolean; confirmed: boolean; bodySha256: string };

/** Explicit lists only. Neither a sidebar nor all homepage links constitutes a blogroll. */
export function parsePublicationBlogroll(
  html: string,
  pageUrl: string,
  blogId: number,
  aliases: PublicationAlias[],
  dedicated = false,
): HomeDiscovery {
  const $ = cheerio.load(html);
  $('script,style,noscript,template,form').remove();
  // The set stores DOM elements without retaining raw HTML or external requests.
  const selected = new Set<import('domhandler').Element>();
  const addRegion = (region: ReturnType<typeof $>) => {
    region.find('a[href]').each((_, el) => {
      if (!$(el).closest(`${COMMENTS},form`).length) selected.add(el);
    });
  };
  $(REGIONS).each((_, el) => {
    if (!$(el).closest(COMMENTS).length) addRegion($(el));
  });
  $('h1,h2,h3,h4,h5,h6').each((_, el) => {
    if (!MARKER.test($(el).text()) || $(el).closest(EXCLUDED).length) return;
    // Only immediate lists under a labelled heading, never the heading's entire sidebar.
    let sibling = $(el).next();
    let count = 0;
    while (sibling.length && count++ < 3 && !sibling.is('h1,h2,h3,h4,h5,h6')) {
      if (sibling.is('ul,ol,dl')) addRegion(sibling);
      sibling = sibling.next();
    }
  });
  const isDedicated =
    dedicated && (MARKER.test(new URL(pageUrl).pathname) || MARKER.test($('h1').first().text()) || MARKER.test($('title').text()));
  if (isDedicated) {
    let primary = $('main,.entry-content,.post-content,[itemprop="articleBody"]');
    if (!primary.length) primary = $('article');
    primary.find('a[href]').each((_, el) => {
      if (!$(el).closest(`${EXCLUDED},aside,.sidebar,#sidebar,.widget-area,.site-sidebar,[role="complementary"]`).length) selected.add(el);
    });
  }
  const links: ParsedLink[] = [];
  const seen = new Set<string>();
  let truncated = false;
  for (const el of selected) {
    const targetUrl = normalizeLink($(el).attr('href')?.trim() || '', pageUrl);
    if (!targetUrl) continue;
    const targetBlogId = resolvePublication(targetUrl, aliases);
    if (targetBlogId === blogId) continue;
    if (new URL(targetUrl).origin === new URL(pageUrl).origin && targetBlogId === null) {
      const home = publicationHome(targetUrl);
      const sourceHome = publicationHome(pageUrl);
      if (!home || (sourceHome && identityKey(home) === identityKey(sourceHome)) || resolvePublication(home, aliases) === blogId) continue;
    }
    if (seen.has(targetUrl)) continue;
    seen.add(targetUrl);
    if (links.length >= 100) {
      truncated = true;
      continue;
    }
    links.push({ targetUrl, targetBlogId, anchorText: trim($(el).text(), 255), context: '', location: 'blogroll', ordinal: links.length });
  }
  let childUrl: string | null = null;
  if (!dedicated)
    $('a[href]').each((_, el) => {
      if (childUrl || $(el).closest(COMMENTS).length) return;
      const text = $(el).text();
      const rel = ($(el).attr('rel') || '').split(/\s+/);
      const target = normalizeLink($(el).attr('href')?.trim() || '', pageUrl);
      if (!target || target === normalizeLink(pageUrl) || resolvePublication(target, aliases) !== blogId) return;
      if (MARKER.test(text) || (rel.includes('bookmark') && MARKER.test(new URL(target).pathname))) childUrl = target;
    });
  return {
    links,
    childUrl,
    truncated,
    confirmed: selected.size > 0 || isDedicated,
    bodySha256: createHash('sha256').update(html).digest('hex'),
  };
}

export type HomePageEvidence = { sourceUrl: string; parsed: HomeDiscovery | null; path: string[] };
/** Replace a complete sweep atomically; null parsed means an HTTP 304 retaining that exact page. */
export async function saveHomeSweep(
  pool: Pool,
  blogId: number,
  pages: HomePageEvidence[],
  scan: { etag: string | null; modified: string | null; childUrl: string | null; truncated: boolean },
  now: Date,
) {
  if (!pages.length || pages.length > 2) throw Error('invalid_home_sweep');
  const hashes = pages.map((p) => createHash('sha256').update(p.sourceUrl).digest('hex'));
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    await c.query('SELECT id FROM blogs WHERE id=? FOR UPDATE', [blogId]);
    await c.query('DELETE FROM relation_home_links WHERE blog_id=? AND source_page_hash NOT IN (?)', [blogId, hashes]);
    for (const [i, page] of pages.entries()) {
      if (!page.parsed) continue;
      await c.query('DELETE FROM relation_home_links WHERE blog_id=? AND source_page_hash=?', [blogId, hashes[i]]);
      for (const l of page.parsed.links)
        await c.query(
          `INSERT INTO relation_home_links
        (blog_id,source_page_hash,ordinal,source_page_url,target_url,target_blog_id,anchor_text,body_sha256,path,observed_at,resolution_checked_at,target_reason)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            blogId,
            hashes[i],
            l.ordinal,
            page.sourceUrl,
            l.targetUrl,
            l.targetBlogId,
            l.anchorText,
            page.parsed.bodySha256,
            JSON.stringify([...page.path, l.targetUrl]),
            now,
            now,
            l.targetBlogId ? 'known-publication' : publicationDecision(l.targetUrl).reason,
          ],
        );
    }
    await c.query(
      `INSERT INTO relation_home_scans (blog_id,status,observed_at,last_success_at,next_attempt_at,etag,last_modified,child_url,truncated)
      VALUES (?,'ok',?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status='ok',observed_at=VALUES(observed_at),last_success_at=VALUES(last_success_at),next_attempt_at=VALUES(next_attempt_at),etag=VALUES(etag),last_modified=VALUES(last_modified),child_url=VALUES(child_url),truncated=VALUES(truncated),error_code=NULL`,
      [blogId, now, now, new Date(now.getTime() + 7 * 86400000), scan.etag, scan.modified, scan.childUrl, scan.truncated],
    );
    await c.commit();
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}

/** A partial fetch retains the entire last complete sweep, marks it stale, and forces a fresh homepage. */
export async function retainPartialHomeSweep(pool: Pool, blogId: number, homeSucceeded: boolean, reason: string, now: Date) {
  await pool.query(
    `INSERT INTO relation_home_scans (blog_id,status,observed_at,next_attempt_at,error_code) VALUES (?,?,?,?,?)
    ON DUPLICATE KEY UPDATE status=VALUES(status),observed_at=VALUES(observed_at),next_attempt_at=VALUES(next_attempt_at),error_code=VALUES(error_code),etag=NULL,last_modified=NULL,child_url=NULL`,
    [
      blogId,
      homeSucceeded ? 'partial' : 'failed',
      now,
      new Date(now.getTime() + (homeSucceeded || reason === 'budget-exhausted' ? 1 : 7) * 86400000),
      reason,
    ],
  );
}

async function reconcileHomeTargets(pool: Pool, aliases: PublicationAlias[], now: Date) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT l.blog_id,l.source_page_hash,l.ordinal,l.target_url FROM relation_home_links l LEFT JOIN blogs b ON b.id=l.target_blog_id
    WHERE (l.target_blog_id IS NULL OR b.status='moved') AND l.resolution_checked_at<? ORDER BY l.resolution_checked_at LIMIT 500`,
    [new Date(now.getTime() - 6 * 3600000)],
  );
  for (const r of rows) {
    const target = resolvePublication(r.target_url, aliases);
    if (target === r.blog_id)
      await pool.query('DELETE FROM relation_home_links WHERE blog_id=? AND source_page_hash=? AND ordinal=?', [
        r.blog_id,
        r.source_page_hash,
        r.ordinal,
      ]);
    else
      await pool.query(
        'UPDATE relation_home_links SET target_blog_id=?,resolution_checked_at=?,target_reason=? WHERE blog_id=? AND source_page_hash=? AND ordinal=?',
        [target, now, target ? 'known-publication' : publicationDecision(r.target_url).reason, r.blog_id, r.source_page_hash, r.ordinal],
      );
  }
}

/** Separate scheduler, same relations lease/budgets: never nest this inside runRelationBatch. */
export async function runPublicationDiscoveryBatch(pool: Pool, options: BatchOptions = {}): Promise<BatchResult> {
  const empty = { processed: 0, skipped: 0, truncated: false, reservedUnused: 0 };
  return (
    (await withJobLease(pool, 'relations', async (assertLease) => {
      const result = { ...empty };
      const now = () => options.now?.() ?? new Date();
      const deadline = Date.now() + Math.max(1000, Math.min(120000, options.maxDurationMs ?? 120000));
      const aliases = await loadAliases(pool);
      await reconcileHomeTargets(pool, aliases, now());
      const [blogs] = await pool.query<RowDataPacket[]>(
        `SELECT b.id,b.url,COALESCE(p.depth,0) depth,s.etag,s.last_modified,s.child_url FROM blogs b
      LEFT JOIN relation_publications p ON p.blog_id=b.id LEFT JOIN relation_home_scans s ON s.blog_id=b.id
      WHERE b.status='verified' AND b.url IS NOT NULL AND COALESCE(p.depth,0)<3 AND (s.blog_id IS NULL OR s.next_attempt_at<=?)
      ORDER BY COALESCE(s.next_attempt_at,'1970-01-01'),b.discovered_at DESC,b.id DESC LIMIT 1`,
        [now()],
      );
      for (const blog of blogs) {
        if (options.signal?.aborted || Date.now() >= deadline) {
          result.truncated = true;
          break;
        }
        await assertLease();
        if (!(await relationBudgetAvailable(pool, blog.url, now()))) {
          await deferHomeScan(pool, blog.id, now());
          result.skipped++;
          continue;
        }
        if (!(await reserveBudget(pool, [{ scope: 'relations:homes', amount: 1, limit: 10 }], now()))) {
          result.truncated = true;
          break;
        }
        const fetcher = budgetedRelationFetcher(pool, options, assertLease, deadline);
        let childUrl: string | null = blog.child_url || null;
        let etag: string | null = blog.etag || null;
        let modified: string | null = blog.last_modified || null;
        let homeSucceeded = false;
        let blogTruncated = false;
        const pages: HomePageEvidence[] = [];
        try {
          const headers: Record<string, string> = { accept: 'text/html,application/xhtml+xml;q=0.9' };
          if (etag) headers['if-none-match'] = etag;
          if (modified) headers['if-modified-since'] = modified;
          let home = await politeFetch(blog.url, headers, { ...options, fetcher, timeoutMs: 15000 });
          let finalHome = home.url || blog.url;
          if (resolvePublication(finalHome, aliases) !== blog.id) throw Error('publication_redirect_mismatch');
          if (home.status === 304) {
            if (!etag && !modified) throw Error('unexpected_home_304');
            // A renamed/redirected source must be refreshed, not paired with another page's cache.
            const [[otherHome]] = await pool.query<RowDataPacket[]>(
              'SELECT source_page_url FROM relation_home_links WHERE blog_id=? AND JSON_LENGTH(path)=2 AND source_page_url<>? LIMIT 1',
              [blog.id, finalHome],
            );
            if (otherHome) {
              home = await politeFetch(blog.url, { accept: headers.accept }, { ...options, fetcher, timeoutMs: 15000 });
              finalHome = home.url || blog.url;
            }
          }
          if (home.status === 304) {
            pages.push({ sourceUrl: finalHome, parsed: null, path: [blog.url] });
          } else {
            if (!home.ok) throw Error(`http_${home.status}`);
            if (!/text\/html|application\/xhtml\+xml/i.test(home.headers.get('content-type') || '')) throw Error('non-html');
            if (resolvePublication(finalHome, aliases) !== blog.id) throw Error('publication_redirect_mismatch');
            const parsed = parsePublicationBlogroll(await home.text(), finalHome, blog.id, aliases);
            childUrl = parsed.childUrl;
            etag = home.headers.get('etag')?.slice(0, 512) || null;
            modified = home.headers.get('last-modified')?.slice(0, 255) || null;
            pages.push({ sourceUrl: finalHome, parsed, path: [blog.url] });
            blogTruncated ||= parsed.truncated;
          }
          homeSucceeded = true;
          if (childUrl) {
            if (resolvePublication(childUrl, aliases) !== blog.id) throw Error('publication_child_mismatch');
            const child = await politeFetch(
              childUrl,
              { accept: 'text/html,application/xhtml+xml;q=0.9' },
              { ...options, fetcher, timeoutMs: 15000 },
            );
            if (!child.ok) throw Error(`http_${child.status}`);
            if (!/text\/html|application\/xhtml\+xml/i.test(child.headers.get('content-type') || '')) throw Error('non-html');
            const finalUrl = child.url || childUrl;
            if (resolvePublication(finalUrl, aliases) !== blog.id) throw Error('publication_redirect_mismatch');
            const parsed = parsePublicationBlogroll(await child.text(), finalUrl, blog.id, aliases, true);
            if (!parsed.confirmed) throw Error('blogroll_page_unconfirmed');
            pages.push({ sourceUrl: finalUrl, parsed, path: [blog.url, finalUrl] });
            blogTruncated ||= parsed.truncated;
          }
          await assertLease();
          await saveHomeSweep(pool, blog.id, pages, { etag, modified, childUrl, truncated: blogTruncated }, now());
          result.truncated ||= blogTruncated;
          result.processed++;
          for (const page of pages)
            if (page.parsed) {
              await discoverCandidateLinks(
                pool,
                {
                  blogId: blog.id,
                  blogUrl: blog.url,
                  sourceUrl: page.sourceUrl,
                  postId: null,
                  depth: Number(blog.depth),
                  kind: 'blogroll',
                  bodySha256: page.parsed.bodySha256,
                  path: page.path,
                },
                page.parsed.links,
                now(),
              );
            }
        } catch (error) {
          await assertLease();
          const reason = fetcher.lastFailure || relationFailureCode(error);
          if (/budget|batch-stopped/.test(reason)) await deferHomeScan(pool, blog.id, now());
          else await retainPartialHomeSweep(pool, blog.id, homeSucceeded, reason, now());
          result.skipped++;
        }
      }
      if (result.processed) await invalidateRelationCache(pool);
      return result;
    })) ?? { ...empty, skipped: 1 }
  );
}

async function deferHomeScan(pool: Pool, blogId: number, now: Date) {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  await pool.query(
    `INSERT INTO relation_home_scans (blog_id,status,observed_at,next_attempt_at,error_code)
    VALUES (?,'deferred',?,?,'budget-deferred') ON DUPLICATE KEY UPDATE next_attempt_at=VALUES(next_attempt_at),error_code=VALUES(error_code),status=IF(last_success_at IS NULL,'deferred',status)`,
    [blogId, now, next],
  );
}
