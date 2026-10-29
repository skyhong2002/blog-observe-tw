import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { publicationDecision } from '../relations/identity.ts';
import { backfillPublicRoutes } from '../seo/page-routes.ts';
import { type FeedCrawlerOptions, isAllowedCrawlUrl, politeFetch, readFeedBody } from './feed.ts';
import { seedIdentityKey } from './seed-url-resolution.ts';

export const INDIEPING_API = 'https://indieping.giveanornot.com/api/blogs';
export const CURATED_PAGES = ['https://blogblog.club/blogrollroll/', 'https://blogblog.club/party/'] as const;
export type CuratedMember = {
  url: string;
  name: string;
  provider: 'indieping' | 'blogblog-club';
  page: string;
  kind: 'api' | 'blogroll' | 'participant';
};
export type CuratedProof = CuratedMember & {
  home: string;
  sha256: string;
  observedAt: string;
  resolution?: { kind: 'vocus-article-salon'; sha256: string; salonId: string };
};
const object = (x: unknown): Record<string, unknown> => {
  if (typeof x === 'string') {
    try {
      return object(JSON.parse(x));
    } catch {
      return {};
    }
  }
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
};
export function parseIndiepingMembers(value: unknown): CuratedMember[] {
  if (!Array.isArray(value) || value.length > 5000) throw Error('invalid_indieping_list');
  return value.flatMap((raw) => {
    const item = object(raw);
    if (typeof item.domain !== 'string' || typeof item.name !== 'string' || !/^[a-z0-9.-]+$/i.test(item.domain)) return [];
    const url = `https://${item.domain.toLowerCase()}/`;
    return isAllowedCrawlUrl(url)
      ? [{ url, name: item.name.trim().slice(0, 255), provider: 'indieping' as const, page: INDIEPING_API, kind: 'api' as const }]
      : [];
  });
}
/** Only the human-selected table rows and named hosts/participants; resource links and member blogrolls are excluded. */
export function parseBlogblogMembers(html: string, page: string): CuratedMember[] {
  if (!(CURATED_PAGES as readonly string[]).includes(page)) throw Error('invalid_curated_page');
  const $ = cheerio.load(html);
  $('nav,footer,aside,script,style,.comments,#comments').remove();
  const main = $('main').first();
  const anchors =
    page === CURATED_PAGES[0]
      ? main.find('table tbody tr td:first-child a[href],table tr td:first-child a[href]')
      : main
          .find('li')
          .filter((_, el) => /^(?:參與者[（(]|主持人[：:])/.test($(el).clone().children('ul,ol').remove().end().text().trim()))
          .find('a[href]');
  const result: CuratedMember[] = [];
  for (const a of anchors.toArray()) {
    try {
      const url = new URL($(a).attr('href') || '', page);
      url.hash = '';
      if (!isAllowedCrawlUrl(url.href) || url.hostname === 'blogblog.club' || url.href.length > 1024) continue;
      result.push({
        url: url.href,
        name: $(a).text().trim().slice(0, 255),
        provider: 'blogblog-club',
        page,
        kind: page === CURATED_PAGES[0] ? 'blogroll' : 'participant',
      });
    } catch {}
  }
  return result;
}
/** Persisted machine proof is re-read by the admission transaction. A broad source_type or legacy directoryListing is insufficient. */
export function curatedProof(evidence: unknown, home: string): CuratedProof | null {
  const entries = object(evidence).curatedListings;
  if (!Array.isArray(entries) || entries.length > 8) return null;
  for (const entry of entries) {
    const p = object(entry);
    if (
      typeof p.url !== 'string' ||
      typeof p.home !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(p.sha256) ||
      typeof p.observedAt !== 'string' ||
      !Number.isFinite(Date.parse(p.observedAt))
    )
      continue;
    const source =
      (p.provider === 'indieping' && p.page === INDIEPING_API && p.kind === 'api') ||
      (p.provider === 'blogblog-club' &&
        ((p.page === CURATED_PAGES[0] && p.kind === 'blogroll') || (p.page === CURATED_PAGES[1] && p.kind === 'participant')));
    if (!source || !isAllowedCrawlUrl(p.url) || !isAllowedCrawlUrl(p.home)) continue;
    const resolution = object(p.resolution);
    const resolvedVocus =
      /^https:\/\/vocus\.cc\/article\/[a-f0-9]{24}$/.test(p.url) &&
      resolution.kind === 'vocus-article-salon' &&
      typeof resolution.salonId === 'string' &&
      /^[a-f0-9]{24}$/.test(resolution.salonId) &&
      typeof resolution.sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(resolution.sha256)
        ? `https://vocus.cc/salon/${resolution.salonId}`
        : null;
    const derived = publicationDecision(p.url).home || resolvedVocus;
    if (derived && seedIdentityKey(derived) === seedIdentityKey(p.home) && seedIdentityKey(home) === seedIdentityKey(p.home))
      return p as CuratedProof;
  }
  return null;
}
/** Resolve only the exact article's declared salon, never a random author link elsewhere on the page. */
export function vocusSalonFromArticle(html: string, articleUrl: string): string | null {
  const id = /^https:\/\/vocus\.cc\/article\/([a-f0-9]{24})$/.exec(articleUrl)?.[1];
  if (!id) return null;
  try {
    const $ = cheerio.load(html);
    const props = object(object(JSON.parse($('#__NEXT_DATA__').text())).props);
    const article = object(object(props.pageProps).parsedArticle);
    const salon = object(article.salon);
    return article._id === id &&
      typeof article.salonId === 'string' &&
      /^[a-f0-9]{24}$/.test(article.salonId) &&
      salon._id === article.salonId
      ? article.salonId
      : null;
  } catch {
    return null;
  }
}
export async function fetchCuratedMembers(options: FeedCrawlerOptions = {}) {
  const members: CuratedProof[] = [];
  const failures: { page: string; reason: string }[] = [];
  const unresolved: CuratedMember[] = [];
  const pages = [INDIEPING_API, ...CURATED_PAGES];
  for (const page of pages) {
    try {
      const response = await politeFetch(page, {}, { ...options, timeoutMs: options.timeoutMs ?? 15000 });
      if (!response.ok) {
        await response.body?.cancel();
        throw Error(`http_${response.status}`);
      }
      const final = new URL(response.url || page);
      if (final.origin !== new URL(page).origin || final.pathname.replace(/\/$/, '') !== new URL(page).pathname.replace(/\/$/, '')) {
        await response.body?.cancel();
        throw Error('directory_redirect_changed');
      }
      const body = await readFeedBody(response);
      const parsed = page === INDIEPING_API ? parseIndiepingMembers(JSON.parse(body)) : parseBlogblogMembers(body, page);
      if (!parsed.length) throw Error('empty_directory');
      const sha256 = createHash('sha256').update(body).digest('hex');
      for (const member of parsed) {
        let home = publicationDecision(member.url).home;
        let resolution: CuratedProof['resolution'];
        if (!home && /^https:\/\/vocus\.cc\/article\/[a-f0-9]{24}$/.test(member.url)) {
          try {
            const article = await politeFetch(member.url, {}, { ...options, timeoutMs: options.timeoutMs ?? 15000 });
            if (!article.ok || (article.url && article.url !== member.url)) {
              await article.body?.cancel();
              throw Error('article_unavailable');
            }
            const html = await readFeedBody(article);
            const salonId = vocusSalonFromArticle(html, member.url);
            if (salonId) {
              home = `https://vocus.cc/salon/${salonId}`;
              resolution = { kind: 'vocus-article-salon', salonId, sha256: createHash('sha256').update(html).digest('hex') };
            }
          } catch {
            /* Preserve unresolved membership and retry on the next source sync. */
          }
        }
        if (!home) {
          unresolved.push(member);
          continue;
        }
        members.push({ ...member, home, sha256, observedAt: new Date().toISOString(), ...(resolution ? { resolution } : {}) });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      failures.push({
        page,
        reason: /^http_\d{3}$|^empty_directory$|^directory_redirect_changed$/.test(message) ? message : 'directory_fetch_or_parse_failed',
      });
    }
  }
  return { members, failures, unresolved };
}
/** New membership is additive; disappearance or an unavailable source never delists a website. */
export async function syncCuratedMembers(pool: Pool, options: FeedCrawlerOptions = {}) {
  const fetched = await fetchCuratedMembers(options);
  const groups = new Map<string, CuratedProof[]>();
  for (const member of fetched.members) {
    const key = seedIdentityKey(member.home);
    const group = groups.get(key) || [];
    if (!group.some((p) => p.page === member.page)) group.push(member);
    groups.set(key, group);
  }
  const ids: number[] = [];
  for (const group of groups.values()) {
    const p = group[0];
    const evidence = JSON.stringify({ curatedListings: group.slice(0, 8), discoveryDepth: 1 });
    await pool.execute(
      `INSERT INTO discovery_candidates(url,name,source_type,source_url,source_evidence,status,discovered_at)
      VALUES (?,?,?,?,?,'candidate',UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE source_evidence=
      JSON_SET(COALESCE(source_evidence,JSON_OBJECT()),'$.curatedListings',JSON_EXTRACT(VALUES(source_evidence),'$.curatedListings'))`,
      [p.home, p.name || new URL(p.home).hostname, p.provider, p.page, evidence],
    );
    const [[row]] = await pool.query<RowDataPacket[]>('SELECT id FROM discovery_candidates WHERE url=? AND source_type=?', [
      p.home,
      p.provider,
    ]);
    ids.push(Number(row.id));
  }
  return { members: groups.size, ids, failures: fetched.failures, unresolved: fetched.unresolved };
}
/** Catalog qualification is distinct from a successful HTTP/feed crawl. No network or invented homepage evidence here. */
export type CuratedAdmission = {
  id: number;
  status: 'busy' | 'held' | 'approved';
  reason?: string;
  blogId?: number;
  slug?: string;
  created?: boolean;
};
export async function admitCuratedMember(pool: Pool, id: number): Promise<CuratedAdmission> {
  const c = await pool.getConnection();
  let held = false;
  try {
    const [[lock]] = await c.query<RowDataPacket[]>("SELECT GET_LOCK('blog_observe:candidate-promotion',0) held");
    if (Number(lock?.held) !== 1) return { id, status: 'busy' };
    held = true;
    await c.beginTransaction();
    const [[candidate]] = await c.query<RowDataPacket[]>('SELECT * FROM discovery_candidates WHERE id=? FOR UPDATE', [id]);
    const skip = async (reason: string) => {
      await c.rollback();
      return { id, status: 'held' as const, reason };
    };
    if (!candidate) return await skip('candidate_missing');
    if (candidate.status === 'rejected') return await skip('manual_rejection_preserved');
    if (candidate.status === 'approved') return await skip('already_linked');
    const proof = curatedProof(candidate.source_evidence, String(candidate.url));
    if (!proof) return await skip('direct_membership_unverified');
    const [[manual]] = await c.query<RowDataPacket[]>(
      `SELECT id FROM discovery_candidate_audits WHERE candidate_id=? AND
      (source_type IN ('manual','human-review','admin') OR source_actor_id IS NOT NULL) LIMIT 1`,
      [id],
    );
    if (manual) return await skip('manual_decision_preserved');
    const key = seedIdentityKey(proof.home);
    const homeOf = (url: string) => {
      try {
        const home = publicationDecision(url).home;
        return home ? seedIdentityKey(home) : null;
      } catch {
        return null;
      }
    };
    const [rejected] = await c.query<RowDataPacket[]>(
      "SELECT url,source_type FROM discovery_candidates WHERE status='rejected' OR source_type='owner-exclusion' FOR UPDATE",
    );
    const h = new URL(proof.home).hostname.replace(/^www\./, '');
    if (
      rejected.some((r) =>
        r.source_type === 'owner-exclusion' ? new URL(r.url).hostname.replace(/^www\./, '') === h : homeOf(r.url) === key,
      )
    )
      return await skip('rejected_identity_preserved');
    const [known] = await c.query<RowDataPacket[]>(
      'SELECT b.id,b.slug,b.url,b.status,u.url alias FROM blogs b LEFT JOIN blog_urls u ON u.blog_id=b.id FOR UPDATE',
    );
    const owners = new Map<number, RowDataPacket>();
    for (const b of known) if ([b.url, b.alias].some((url) => url && homeOf(url) === key)) owners.set(Number(b.id), b);
    if (owners.size > 1) return await skip('publication_ownership_conflict');
    const existing = [...owners.values()][0];
    if (existing && existing.status !== 'verified') return await skip('existing_decision_preserved');
    let blogId = Number(existing?.id || 0),
      slug = String(existing?.slug || '');
    const created = !blogId;
    if (!blogId) {
      slug = 'discovered-' + createHash('sha256').update(key).digest('hex').slice(0, 20);
      const [insert] = await c.execute<ResultSetHeader>(
        `INSERT INTO blogs(slug,name,url,canonical_host,status,status_label,discovered_at,stale_policy)
        VALUES (?,?,?,?,'verified',?,UTC_TIMESTAMP(),'low_frequency')`,
        [slug, proof.name || h, proof.home, h, proof.provider === 'indieping' ? 'IndiePing 名錄收錄' : 'BlogBlog 名錄收錄'],
      );
      blogId = insert.insertId;
      await c.execute("INSERT INTO blog_urls(blog_id,url,kind,is_primary,discovered_at) VALUES (?,?,'primary',TRUE,UTC_TIMESTAMP())", [
        blogId,
        proof.home,
      ]);
      await c.execute(
        'INSERT IGNORE INTO relation_publications(blog_id,depth,source_candidate_id,admitted_at) VALUES (?,1,?,UTC_TIMESTAMP())',
        [blogId, id],
      );
    }
    const [[postCount]] = await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM posts WHERE blog_id=?', [blogId]);
    const content = JSON.stringify({ status: Number(postCount.n) ? 'ready' : 'pending', posts: Number(postCount.n) });
    const review = {
      policy: 'curated-catalog-v1',
      id,
      inputUrl: candidate.url,
      checkedAt: new Date().toISOString(),
      eligible: true,
      reason: 'curated_directory_qualified',
      directoryListing: proof.page,
      catalogOnly: true,
      blogId,
      slug,
      applied: true,
    };
    await c.execute(
      `UPDATE discovery_candidates SET status='approved',source_evidence=JSON_SET(COALESCE(source_evidence,JSON_OBJECT()),
      '$.automaticReview',JSON_EXTRACT(?,'$'),'$.curatedContent',JSON_EXTRACT(?,'$')) WHERE id=? AND status='candidate'`,
      [JSON.stringify(review), content, id],
    );
    await c.execute(
      `INSERT INTO discovery_candidate_audits(candidate_id,action,previous_status,next_status,source_type,source_url,source_evidence,note,occurred_at,created_at)
      VALUES (?,'auto-approve','candidate','approved','curated-directory-admission',?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
      [id, proof.page, JSON.stringify(review), 'curated_directory_qualified'],
    );
    await c.commit();
    return { id, status: 'approved', blogId, slug, created };
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    await releaseCuratedConnection(c, held);
  }
}
async function releaseCuratedConnection(c: PoolConnection, held: boolean) {
  try {
    if (held) {
      const [[r]] = await c.query<RowDataPacket[]>("SELECT RELEASE_LOCK('blog_observe:candidate-promotion') released");
      if (Number(r?.released) !== 1) throw Error('curated_lease_lost');
    }
    c.release();
  } catch (error) {
    c.destroy();
    throw error;
  }
}

export async function runCuratedDirectorySync(pool: Pool, options: FeedCrawlerOptions = {}) {
  const sync = await syncCuratedMembers(pool, options);
  const results = [];
  for (const id of sync.ids) results.push(await admitCuratedMember(pool, id));
  // Admission calls release their transactions first; the registry lease has enough pool connections.
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await backfillPublicRoutes(pool, { kind: 'blog', missingOnly: true, afterId: cursor, limit: 100 });
    if (result.status === 'busy' || !result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return { ...sync, results };
}
