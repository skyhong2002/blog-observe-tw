import { createHash } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { BlogrollObservation, BlogrollStore, DiscoveryPage } from './blogroll-contract.ts';
import { isAllowedCrawlUrl } from './feed.ts';

const LOCK = 'blog_observe:blogblog-discovery';
const MAX_LINK_BYTES = 700 * 1024;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const relationKinds = new Set(['directory', 'blogroll', 'party']);
const validUrl = (value: string) => typeof value === 'string' && value.length <= 1024 && isAllowedCrawlUrl(value);
const validHash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const objectOf = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const decode = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);
const textLimit = (value: string, max: number) => Array.from(value).slice(0, max).join('');
function checkedDate(value: string): Date {
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new Error('invalid discovery timestamp');
  return result;
}
function validatePage(page: DiscoveryPage): void {
  if (
    !validUrl(page.url) ||
    !validUrl(page.finalUrl) ||
    !validHash(page.bodySha256) ||
    !Number.isInteger(page.parserVersion) ||
    page.parserVersion < 1 ||
    !relationKinds.has(page.kind) ||
    (page.etag !== null && (typeof page.etag !== 'string' || page.etag.length > 512)) ||
    (page.lastModified !== null && (typeof page.lastModified !== 'string' || page.lastModified.length > 255)) ||
    !Array.isArray(page.links) ||
    page.links.length > 1000 ||
    page.links.some(
      (link) =>
        !validUrl(link.url) || typeof link.follow !== 'boolean' || typeof link.text !== 'string' || Array.from(link.text).length > 160,
    ) ||
    Buffer.byteLength(JSON.stringify(page.links)) > MAX_LINK_BYTES
  )
    throw new Error('invalid discovery page');
  checkedDate(page.fetchedAt);
}
function evidenceFor(observation: BlogrollObservation) {
  return {
    sourceUrl: observation.sourceUrl,
    rootUrl: observation.rootUrl,
    discoveryPath: observation.path.join(' -> '),
    discoveryPathUrls: observation.path,
    blogrollRelationship: {
      status: 'observed-link',
      from: observation.sourceUrl,
      to: observation.targetUrl,
      relation: observation.relation,
    },
    rssDetection: 'pending',
    anchorText: textLimit(observation.anchorText, 512),
    observedAt: observation.observedAt,
    bodySha256: observation.bodySha256,
  };
}

/** Requires a pool with at least two connections: lease and transactional work are distinct sessions. */
export function createBlogrollStore(pool: Pool): BlogrollStore {
  const connectionLimit = (pool as unknown as { pool?: { config?: { connectionLimit?: number } } }).pool?.config?.connectionLimit;
  if (connectionLimit === 1) throw new Error('blogroll store requires poolSize >= 2');
  let lease: PoolConnection | null = null;
  let acquiring = false;
  return {
    async acquire() {
      if (lease || acquiring) return false;
      acquiring = true;
      let connection: PoolConnection | null = null;
      try {
        connection = await pool.getConnection();
        const [[row]] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?,0) AS acquired', [LOCK]);
        if (Number(row?.acquired) !== 1) {
          connection.release();
          return false;
        }
        lease = connection;
        return true;
      } catch (error) {
        connection?.destroy();
        throw error;
      } finally {
        acquiring = false;
      }
    },
    async release() {
      if (!lease) return;
      const connection = lease;
      lease = null;
      try {
        const [[row]] = await connection.query<RowDataPacket[]>('SELECT RELEASE_LOCK(?) AS released', [LOCK]);
        if (Number(row?.released) !== 1) throw new Error('blogroll lease was lost');
        connection.release();
      } catch (error) {
        connection.destroy();
        throw error;
      }
    },
    async assertLease() {
      const connection = lease;
      if (!connection) throw new Error('blogroll lease is not held');
      try {
        const [[row]] = await connection.query<RowDataPacket[]>('SELECT IS_USED_LOCK(?)=CONNECTION_ID() AS held', [LOCK]);
        if (Number(row?.held) !== 1) throw new Error('blogroll lease was lost');
      } catch (error) {
        if (lease === connection) lease = null;
        // A failed ownership check invalidates the session. Do not return it
        // to the pool or allow a later run to assume the old lock still exists.
        connection.destroy();
        throw error;
      }
    },
    async getPage(url) {
      if (!validUrl(url)) return null;
      const [[row]] = await pool.query<RowDataPacket[]>(
        'SELECT url,final_url,parser_version,kind,etag,last_modified,body_sha256,links,fetched_at FROM discovery_pages WHERE url_sha256=?',
        [digest(url)],
      );
      if (!row || row.url !== url) return null;
      try {
        const page: DiscoveryPage = {
          url: row.url,
          finalUrl: row.final_url,
          parserVersion: Number(row.parser_version),
          kind: row.kind,
          etag: row.etag,
          lastModified: row.last_modified,
          bodySha256: row.body_sha256,
          links: decode(row.links) as DiscoveryPage['links'],
          fetchedAt: new Date(row.fetched_at).toISOString(),
        };
        validatePage(page);
        return page;
      } catch {
        return null;
      }
    },
    async savePage(page) {
      validatePage(page);
      await pool.execute(
        `INSERT INTO discovery_pages (url_sha256,url,final_url,parser_version,kind,etag,last_modified,body_sha256,links,fetched_at)
         VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE url=VALUES(url),final_url=VALUES(final_url),parser_version=VALUES(parser_version),kind=VALUES(kind),etag=VALUES(etag),last_modified=VALUES(last_modified),body_sha256=VALUES(body_sha256),links=VALUES(links),fetched_at=VALUES(fetched_at)`,
        [
          digest(page.url),
          page.url,
          page.finalUrl,
          page.parserVersion,
          page.kind,
          page.etag,
          page.lastModified,
          page.bodySha256,
          JSON.stringify(page.links.map(({ url, text, follow }) => ({ url, text, follow }))),
          checkedDate(page.fetchedAt),
        ],
      );
    },
    async observe(observation) {
      const { rootUrl, sourceUrl, targetUrl, relation, path, bodySha256 } = observation;
      if (
        ![rootUrl, sourceUrl, targetUrl].every(validUrl) ||
        !relationKinds.has(relation) ||
        !validHash(bodySha256) ||
        !Array.isArray(path) ||
        path.length < 2 ||
        path.length > 8 ||
        !path.every(validUrl) ||
        path[0] !== rootUrl ||
        path.at(-1) !== targetUrl ||
        path.at(-2) !== sourceUrl ||
        typeof observation.anchorText !== 'string'
      )
        throw new Error('invalid blogroll observation');
      const now = checkedDate(observation.observedAt);
      const evidence = evidenceFor(observation);
      const edge = digest(JSON.stringify([rootUrl, sourceUrl, targetUrl, relation, path]));
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        let inserted = false;
        try {
          await connection.execute(
            "INSERT INTO discovery_candidates (url,name,source_type,source_url,source_evidence,status,discovered_at) VALUES (?,?,'blogblog-club',?,?,'candidate',?)",
            [targetUrl, textLimit(observation.anchorText, 255) || null, sourceUrl, JSON.stringify(evidence), now],
          );
          inserted = true;
        } catch (error) {
          // Only the composite URL/source collision is an expected existing row.
          // Truncation, invalid JSON, permissions and transport errors roll back.
          if (objectOf(error)?.code !== 'ER_DUP_ENTRY') throw error;
        }
        const [[candidate]] = await connection.query<RowDataPacket[]>(
          "SELECT id,status,source_type,source_evidence FROM discovery_candidates WHERE url=? AND source_type='blogblog-club' FOR UPDATE",
          [targetUrl],
        );
        if (!candidate) throw new Error('candidate observation was not persisted');
        if (!inserted && candidate.status === 'candidate' && candidate.source_type === 'blogblog-club') {
          const prior = objectOf(decode(candidate.source_evidence)) || {};
          const legacy =
            objectOf(prior.blogrollRelationship)?.status === 'pending-human-confirmation' && validHash(String(prior.fingerprint || ''));
          // Preserve arbitrary/manual fields, including a completed RSS check.
          // Modern top-level evidence is stable; each new observation is retained
          // both in crawlerObservation and in the independent edge table.
          const patch: Record<string, unknown> = { crawlerObservation: evidence };
          for (const [key, value] of Object.entries(evidence)) {
            if (!(key in prior) || (legacy && key !== 'rssDetection')) patch[key] = value;
          }
          await connection.execute(
            "UPDATE discovery_candidates SET source_evidence=JSON_MERGE_PATCH(COALESCE(source_evidence,JSON_OBJECT()),?) WHERE id=? AND status='candidate' AND source_type='blogblog-club'",
            [JSON.stringify(patch), candidate.id],
          );
        }
        await connection.execute(
          `INSERT INTO discovery_edges (edge_sha256,root_url,source_url,target_url,path,anchor_text,relation,body_sha256,first_seen_at,last_seen_at)
           VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE path=IF(VALUES(last_seen_at)>=last_seen_at,VALUES(path),path),anchor_text=IF(VALUES(last_seen_at)>=last_seen_at,VALUES(anchor_text),anchor_text),body_sha256=IF(VALUES(last_seen_at)>=last_seen_at,VALUES(body_sha256),body_sha256),last_seen_at=GREATEST(last_seen_at,VALUES(last_seen_at))`,
          [
            edge,
            rootUrl,
            sourceUrl,
            targetUrl,
            JSON.stringify(path),
            textLimit(observation.anchorText, 512),
            relation,
            bodySha256,
            now,
            now,
          ],
        );
        await connection.commit();
        return { inserted };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}
