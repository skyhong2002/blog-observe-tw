import type { Pool, RowDataPacket } from 'mysql2/promise';
import { publicationDecision } from '../relations/identity.ts';

/**
 * BlogBlog.Club is a directory of personal blogs: its blogroll-of-blogrolls and blog-party pages. A candidate linked
 * straight from one of its pages is admitted as a personal publication without the homepage self-description or AI
 * proof; the publication home, RSS/article sitemap, identity and ownership checks still apply. Links found one step
 * further (on a member's own blogroll or post) stay ordinary candidates.
 */
export const DIRECTORY_HOST = 'blogblog.club';
/** Daily new-blog admissions from the directory (the general automatic admissions keep their own budget). */
export const DIRECTORY_ADMISSIONS_DAILY = 100;

const object = (x: unknown): Record<string, unknown> => {
  if (typeof x === 'string')
    try {
      return object(JSON.parse(x));
    } catch {
      return {};
    }
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
};
const onDirectory = (value: unknown) => {
  try {
    return typeof value === 'string' && new URL(value).protocol === 'https:' && new URL(value).hostname === DIRECTORY_HOST;
  } catch {
    return false;
  }
};

/** The BlogBlog.Club page that links straight to this candidate (machine-written evidence only), else null. */
export function directoryListing(evidence: unknown): string | null {
  const e = object(evidence);
  const pages = [
    object(e.directoryListing).page,
    object(e.blogrollRelationship).from,
    object(object(e.crawlerObservation).blogrollRelationship).from,
  ];
  return (pages.find(onDirectory) as string | undefined) ?? null;
}

/** The IndieWeb wiki's member list (each `User:<domain>` is a member's own site); see crawl/indieweb.ts. Only members
 * whose homes are written in Chinese count as listed (the user's scope, 2026-10-17); candidate-validation.ts checks it. */
export const INDIEWEB_LISTING = 'https://indieweb.org/chat-names';
export function indiewebListing(evidence: unknown): string | null {
  const page = object(object(evidence).indiewebListing).page;
  return page === INDIEWEB_LISTING ? page : null;
}
/** The directory listing a candidate of this source carries, else null. */
export function listingOf(sourceType: string, evidence: unknown): string | null {
  if (sourceType === 'blogblog-club') return directoryListing(evidence);
  if (sourceType === 'indieweb-wiki') return indiewebListing(evidence);
  return null;
}
export const listingLabel = (sourceType: string) =>
  sourceType === 'indieweb-wiki' ? 'IndieWeb 名單自動收錄' : 'BlogBlog.Club 名單自動收錄';
/** Mostly Chinese: declared zh, or Han characters dominate the visible text (and it is not Japanese kana text). */
export function chineseContent(lang: string, text: string) {
  if (/^zh\b/i.test(lang.trim())) return true;
  if (/^(?:ja|ko)\b/i.test(lang.trim())) return false;
  const han = (text.match(/\p{Script=Han}/gu) ?? []).length;
  const kana = (text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? []).length;
  const latin = (text.match(/\p{Script=Latin}/gu) ?? []).length;
  return han >= 80 && han >= 0.3 * (han + latin) && kana < 0.1 * han;
}

/**
 * Directory pages link to a member's blogroll page or party post, which the review rejects as not a publication home.
 * For each such BlogBlog.Club candidate this adds (or marks) a candidate for its publication home carrying the listing,
 * so the ordinary review checks the home and its feed. Each source row is marked once with `$.directoryHome`.
 */
export async function deriveDirectoryHomes(pool: Pool, limit = 200, now = new Date()) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id,url,source_url,source_evidence FROM discovery_candidates WHERE source_type='blogblog-club' AND status='candidate'
     AND JSON_EXTRACT(source_evidence,'$.directoryHome') IS NULL ORDER BY id LIMIT ?`,
    [Math.max(1, Math.min(1000, Math.trunc(limit)))],
  );
  let homes = 0;
  for (const row of rows) {
    const page = directoryListing(row.source_evidence);
    const home = page ? publicationDecision(row.url).home : null;
    if (page && home) {
      const listing = JSON.stringify({ page, candidateId: Number(row.id), linkedUrl: row.url });
      // A home already decided (approved/rejected) keeps its evidence; a pending one gains the listing.
      await pool.query(
        `INSERT INTO discovery_candidates (url,name,source_type,source_url,source_evidence,status,discovered_at)
         VALUES (?,NULL,'blogblog-club',?,JSON_OBJECT('directoryListing',JSON_EXTRACT(?,'$'),'discoveryDepth',1),'candidate',?)
         ON DUPLICATE KEY UPDATE source_evidence=IF(status='candidate',
           JSON_SET(COALESCE(source_evidence,JSON_OBJECT()),'$.directoryListing',JSON_EXTRACT(?,'$')),source_evidence)`,
        [home, page, listing, now, listing],
      );
      homes++;
    }
    await pool.query(
      "UPDATE discovery_candidates SET source_evidence=JSON_SET(COALESCE(source_evidence,JSON_OBJECT()),'$.directoryHome',?) WHERE id=? AND status='candidate'",
      [page && home ? home : '', row.id],
    );
  }
  return { inspected: rows.length, homes };
}
