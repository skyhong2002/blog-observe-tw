import type { Pool, RowDataPacket } from 'mysql2/promise';
import { iconManifest } from '../v1/favicon-routes.ts';
import { iconUrl } from '../v1/icons.ts';
import { PUBLIC_RELATION } from './public-relation.ts';

export const HOME_MENTION_LIMIT = 8;
export const HOME_MENTION_DAYS = 90;

/** Most links a post may have to one blog and still count as citing it; more is a reprint of that blog's article
 * (carrying its internal links) or a link list, not one article writing about another. */
export const HOME_MENTION_MAX_LINKS_PER_BLOG = 5;
/** Text the article itself wrote around the link, beyond the anchor; shorter is a credit line or list item. */
export const HOME_MENTION_MIN_PROSE = 12;
/**
 * Only links the article writes about in a sentence reach the homepage: the anchor sits inside its context, the
 * context has at least HOME_MENTION_MIN_PROSE characters besides the anchor and a clause mark (，。！？…), and the
 * post links to that blog at most HOME_MENTION_MAX_LINKS_PER_BLOG times. Bare credits (「©名稱」「原始文章：標題」),
 * link-only list items and reprints drop out without any list of words or blogs. /relations still counts every link.
 */
const QUOTED_LINK = `l.anchor_text<>'' AND LOCATE(l.anchor_text,l.context)>0
 AND CHAR_LENGTH(REPLACE(l.context,l.anchor_text,''))>=${HOME_MENTION_MIN_PROSE}
 AND REPLACE(l.context,l.anchor_text,'') REGEXP '[，。！？；、,.!?;]'
 AND (SELECT COUNT(*) FROM relation_links x FORCE INDEX (relation_links_unresolved) WHERE x.target_blog_id=l.target_blog_id
   AND x.source_post_id=l.source_post_id AND x.location='body')<=${HOME_MENTION_MAX_LINKS_PER_BLOG}`;
/** This is the same article→blog body-link evidence as /relations, never shared tags or text similarity. */
// One public body link from post p to another verified blog: the /relations predicate plus the target-post check.
const ELIGIBLE_LINK = `l.source_post_id=p.id AND l.source_blog_id=p.blog_id AND l.location='body'
 AND ${PUBLIC_RELATION} AND a.status='verified' AND b.status='verified' AND a.id<>b.id
 AND (l.target_post_id IS NULL OR EXISTS (SELECT 1 FROM posts tp WHERE tp.id=l.target_post_id
   AND tp.blog_id=b.id AND (tp.published_at IS NULL OR tp.published_at<=?)))
 AND ${QUOTED_LINK}`;
/**
 * Select the date-bounded post/link keys first, then fetch text only for the
 * nine rows that can reach the homepage.  FORCE INDEX plus STRAIGHT_JOIN keeps
 * the bounded published_at range as the driving table.
 * Every eligible post yields at least one row and rows sort by post first, so the
 * nine rows come from the nine newest eligible posts. They are found from the links
 * that resolved to a blog at all (relation_links_target; a few dozen in 90 days, of
 * about eleven thousand body links), not by walking every post of the 90 days, which
 * still hit the one-second statement budget with a cold buffer pool. Visibility
 * predicates are unchanged.
 */
const mentionsSql = (
  range: string,
  posts: number,
  rowLimit: string,
  seconds = 1,
) => `SET STATEMENT max_statement_time=${seconds} FOR WITH recent_posts AS (
 SELECT DISTINCT p.id,p.blog_id,p.published_at FROM relation_links l FORCE INDEX (relation_links_target)
 STRAIGHT_JOIN posts p ON p.id=l.source_post_id AND p.blog_id=l.source_blog_id
 STRAIGHT_JOIN blogs a ON a.id=l.source_blog_id STRAIGHT_JOIN blogs b ON b.id=l.target_blog_id
 STRAIGHT_JOIN relation_observations o ON o.post_id=p.id
 WHERE l.target_blog_id IS NOT NULL AND ${range} AND ${ELIGIBLE_LINK}
 ORDER BY p.published_at DESC,p.id DESC LIMIT ${posts}
), eligible_links AS (
 SELECT p.id postId,p.blog_id sourceBlogId,p.published_at publishedAt,
   l.ordinal,l.target_blog_id targetBlogId,
   ROW_NUMBER() OVER (PARTITION BY p.id,l.target_blog_id ORDER BY l.ordinal) link_number
 FROM recent_posts p
 STRAIGHT_JOIN relation_links l ON l.source_post_id=p.id AND l.source_blog_id=p.blog_id AND l.location='body'
 STRAIGHT_JOIN blogs a ON a.id=l.source_blog_id
 STRAIGHT_JOIN blogs b ON b.id=l.target_blog_id
 STRAIGHT_JOIN relation_observations o ON o.post_id=p.id
 WHERE ${ELIGIBLE_LINK}
), picked AS (
 SELECT postId,sourceBlogId,publishedAt,ordinal,targetBlogId
 FROM eligible_links WHERE link_number=1
 ORDER BY publishedAt DESC,postId DESC,targetBlogId${rowLimit}
)
 SELECT p.id postId,p.title postTitle,p.url postUrl,p.image_url postImageUrl,p.published_at publishedAt,
 a.id sourceBlogId,a.slug sourceBlogSlug,a.name sourceBlogName,
 b.id targetBlogId,b.slug targetBlogSlug,b.name targetBlogName,b.url targetHomeUrl,
 l.target_url targetUrl,l.anchor_text anchor,l.context,l.observed_at observedAt,o.parser_version matchVersion
 FROM picked k
 STRAIGHT_JOIN posts p ON p.id=k.postId AND p.blog_id=k.sourceBlogId
 STRAIGHT_JOIN relation_links l ON l.source_post_id=k.postId AND l.source_blog_id=k.sourceBlogId AND l.ordinal=k.ordinal
 STRAIGHT_JOIN blogs a ON a.id=l.source_blog_id
 STRAIGHT_JOIN blogs b ON b.id=k.targetBlogId
 STRAIGHT_JOIN relation_observations o ON o.post_id=k.postId
 ORDER BY k.publishedAt DESC,k.postId DESC,k.targetBlogId`;
// Two seconds, like the feed: one second timed out about three times an hour on the loaded shared host.
export const HOME_MENTIONS_SQL = mentionsSql('p.published_at>=? AND p.published_at<=?', 9, ' LIMIT 9', 2);

/** parser.ts keeps up to 100 characters before the anchor and 320 in all. */
const CONTEXT_LEAD = 100,
  CONTEXT_MAX = 320,
  QUOTE_LEAD = 40;
const SENTENCE_END = /[。！？!?]/;
/**
 * The sentence holding the link, cut from its context, with 「…」 wherever text was left out: before it (earlier
 * sentences, or the parser started mid-paragraph) and after it (later sentences, or the parser stopped at 320).
 * Long lead-ins are cut to QUOTE_LEAD characters so the anchor stays inside the two lines the card shows.
 */
export function mentionQuote(context: string, anchor: string) {
  const at = anchor ? context.indexOf(anchor) : -1;
  if (at < 0) return '';
  let start = at;
  while (start > 0 && !SENTENCE_END.test(context[start - 1])) start--;
  const stop = context.slice(at + anchor.length).search(SENTENCE_END);
  const end = stop < 0 ? context.length : at + anchor.length + stop + 1;
  if (at - start > QUOTE_LEAD) start = at - QUOTE_LEAD;
  const before = start > 0 || at === CONTEXT_LEAD;
  const after = end < context.length || Array.from(context).length >= CONTEXT_MAX;
  return `${before ? '…' : ''}${context.slice(start, end).trim()}${after ? '…' : ''}`;
}
const iso = (value: unknown) => {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
export function mentionPublicUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? value : null;
  } catch {
    return null;
  }
}
/** One article→blog row as the homepage and /mentions/ send it. */
function mentionRow(r: RowDataPacket, icons: Awaited<ReturnType<typeof iconManifest>>) {
  const targetHomeUrl = mentionPublicUrl(r.targetHomeUrl);
  return {
    postId: Number(r.postId),
    postTitle: r.postTitle,
    postUrl: mentionPublicUrl(r.postUrl),
    postImageUrl: mentionPublicUrl(r.postImageUrl),
    publishedAt: iso(r.publishedAt),
    sourceBlogId: Number(r.sourceBlogId),
    sourceBlogSlug: r.sourceBlogSlug,
    sourceBlogName: r.sourceBlogName,
    sourceIconUrl: iconUrl(r.sourceBlogSlug, icons),
    targetBlogId: Number(r.targetBlogId),
    targetBlogSlug: r.targetBlogSlug,
    targetBlogName: r.targetBlogName,
    targetHomeUrl,
    targetUrl: mentionPublicUrl(r.targetUrl),
    targetDomain: targetHomeUrl ? new URL(targetHomeUrl).hostname : null,
    targetIconUrl: iconUrl(r.targetBlogSlug, icons),
    evidenceType: 'direct-link' as const,
    location: 'body' as const,
    anchor: String(r.anchor ?? '').slice(0, 255),
    context: String(r.context ?? '').slice(0, 240),
    quote: mentionQuote(String(r.context ?? ''), String(r.anchor ?? '')),
    observedAt: iso(r.observedAt),
    matchVersion: r.matchVersion,
    contextSource: 'body' as const,
  };
}
/** Fresh SQL on every overview read: a hide committed before B cannot inherit A's data. */
export async function loadHomeMentions(pool: Pool, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw Error('invalid_home_mention_date');
  const from = new Date(now.getTime() - HOME_MENTION_DAYS * 86400_000);
  const [rows] = await pool.query<RowDataPacket[]>(HOME_MENTIONS_SQL, [from, now, now, now]);
  const icons = await iconManifest();
  return {
    days: HOME_MENTION_DAYS,
    evidenceType: 'direct-link' as const,
    location: 'body' as const,
    limit: HOME_MENTION_LIMIT,
    truncated: rows.length > HOME_MENTION_LIMIT,
    generatedAt: now.toISOString(),
    status: 'available' as const,
    items: rows.slice(0, HOME_MENTION_LIMIT).map((r) => mentionRow(r, icons)),
  };
}

/** Source articles per /mentions/ page; every blog each one writes about comes with it. */
export const MENTION_FEED_PAGE = 12;
/**
 * /mentions/ (/api/mentions): the homepage's citations as a feed with no date bound, MENTION_FEED_PAGE source
 * articles at a time, newest first. An older page starts after the last article shown (keyset on publish time and
 * post id), so a new article arriving between reads neither repeats nor skips one. One extra article tells whether
 * there is a next page. The same predicates as the homepage; found through relation_links_target as well.
 */
export const MENTION_FEED_SQL = mentionsSql('p.published_at<=?', MENTION_FEED_PAGE + 1, '', 2);
export const MENTION_FEED_AFTER_SQL = mentionsSql(
  'p.published_at<=? AND (p.published_at<? OR (p.published_at=? AND p.id<?))',
  MENTION_FEED_PAGE + 1,
  '',
  2,
);
/** `<publish time ISO>_<post id>` of the last article on a page. */
export type MentionCursor = { publishedAt: Date; postId: number };
export function parseMentionCursor(value: unknown): MentionCursor | null {
  const match = typeof value === 'string' ? /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z)_([1-9]\d{0,15})$/.exec(value) : null;
  if (!match) return null;
  const publishedAt = new Date(match[1]);
  const postId = Number(match[2]);
  return Number.isFinite(publishedAt.getTime()) && Number.isSafeInteger(postId) ? { publishedAt, postId } : null;
}
export async function loadMentionFeed(pool: Pool, cursor: MentionCursor | null = null, now = new Date()) {
  const [rows] = cursor
    ? await pool.query<RowDataPacket[]>(MENTION_FEED_AFTER_SQL, [now, cursor.publishedAt, cursor.publishedAt, cursor.postId, now, now])
    : await pool.query<RowDataPacket[]>(MENTION_FEED_SQL, [now, now, now]);
  const posts = [...new Set(rows.map((r) => Number(r.postId)))];
  const shown = new Set(posts.slice(0, MENTION_FEED_PAGE));
  const kept = rows.filter((r) => shown.has(Number(r.postId)));
  const last = kept.at(-1);
  const lastAt = last ? iso(last.publishedAt) : null;
  const icons = await iconManifest();
  return {
    evidenceType: 'direct-link' as const,
    location: 'body' as const,
    limit: MENTION_FEED_PAGE,
    generatedAt: now.toISOString(),
    items: kept.map((r) => mentionRow(r, icons)),
    nextCursor: posts.length > MENTION_FEED_PAGE && last && lastAt ? `${lastAt}_${Number(last.postId)}` : null,
  };
}

export const PROFILE_MENTION_LIMIT = 10;
export const PROFILE_MENTION_DAYS = 365;
/** Citing articles per page of a blog's whole list (/blogs/<key>/mentions/ and its RSS). */
export const PROFILE_FEED_PAGE = 20;
/**
 * A blog's citing articles: the newest articles of other collected blogs that write about this blog in a sentence,
 * one row per article (its first such link). The homepage's predicates (ELIGIBLE_LINK, QUOTED_LINK); found through
 * relation_links_target, so only this blog's links are read. `range` binds after the blog id, then ELIGIBLE_LINK's.
 */
const profileMentionsSql = (range: string, rows: number) => `SET STATEMENT max_statement_time=1 FOR WITH picked AS (
 SELECT p.id postId,p.blog_id sourceBlogId,p.published_at publishedAt,MIN(l.ordinal) ordinal
 FROM relation_links l FORCE INDEX (relation_links_target)
 STRAIGHT_JOIN posts p ON p.id=l.source_post_id AND p.blog_id=l.source_blog_id
 STRAIGHT_JOIN blogs a ON a.id=l.source_blog_id STRAIGHT_JOIN blogs b ON b.id=l.target_blog_id
 STRAIGHT_JOIN relation_observations o ON o.post_id=p.id
 WHERE l.target_blog_id=? AND ${range} AND ${ELIGIBLE_LINK}
 GROUP BY p.id,p.blog_id,p.published_at ORDER BY p.published_at DESC,p.id DESC LIMIT ${rows}
)
 SELECT p.id postId,p.title postTitle,p.url postUrl,p.published_at publishedAt,
 a.id sourceBlogId,a.slug sourceBlogSlug,a.name sourceBlogName,
 l.target_url targetUrl,l.anchor_text anchor,l.context
 FROM picked k
 STRAIGHT_JOIN posts p ON p.id=k.postId AND p.blog_id=k.sourceBlogId
 STRAIGHT_JOIN relation_links l ON l.source_post_id=k.postId AND l.source_blog_id=k.sourceBlogId AND l.ordinal=k.ordinal
 STRAIGHT_JOIN blogs a ON a.id=l.source_blog_id
 ORDER BY k.publishedAt DESC,k.postId DESC`;
/** The blog page's 最近被這些部落格提到: a year, since most blogs are cited rarely. */
export const PROFILE_MENTIONS_SQL = profileMentionsSql('p.published_at>=? AND p.published_at<=?', PROFILE_MENTION_LIMIT + 1);
/** The whole list, no date bound, a page at a time after a keyset cursor as on /mentions/. */
export const PROFILE_FEED_SQL = profileMentionsSql('p.published_at<=?', PROFILE_FEED_PAGE + 1);
export const PROFILE_FEED_AFTER_SQL = profileMentionsSql(
  'p.published_at<=? AND (p.published_at<? OR (p.published_at=? AND p.id<?))',
  PROFILE_FEED_PAGE + 1,
);

function profileMentionRow(r: RowDataPacket, icons: Awaited<ReturnType<typeof iconManifest>>) {
  return {
    postId: Number(r.postId),
    postTitle: String(r.postTitle ?? ''),
    postUrl: mentionPublicUrl(r.postUrl),
    publishedAt: iso(r.publishedAt),
    sourceBlogSlug: String(r.sourceBlogSlug),
    sourceBlogName: String(r.sourceBlogName),
    sourceIconUrl: iconUrl(r.sourceBlogSlug, icons),
    targetUrl: mentionPublicUrl(r.targetUrl),
    anchor: String(r.anchor ?? '').slice(0, 255),
    quote: mentionQuote(String(r.context ?? ''), String(r.anchor ?? '')),
  };
}

export async function loadProfileMentions(pool: Pool, blogId: number, now = new Date()) {
  const from = new Date(now.getTime() - PROFILE_MENTION_DAYS * 86400_000);
  const [rows] = await pool.query<RowDataPacket[]>(PROFILE_MENTIONS_SQL, [blogId, from, now, now]);
  const icons = await iconManifest();
  return {
    days: PROFILE_MENTION_DAYS,
    evidenceType: 'direct-link' as const,
    location: 'body' as const,
    limit: PROFILE_MENTION_LIMIT,
    truncated: rows.length > PROFILE_MENTION_LIMIT,
    generatedAt: now.toISOString(),
    items: rows.slice(0, PROFILE_MENTION_LIMIT).map((r) => profileMentionRow(r, icons)),
  };
}

/** Every article that writes about this blog, newest first, PROFILE_FEED_PAGE at a time; the cursor is /mentions/'s. */
export async function loadProfileMentionFeed(pool: Pool, blogId: number, cursor: MentionCursor | null = null, now = new Date()) {
  const [rows] = cursor
    ? await pool.query<RowDataPacket[]>(PROFILE_FEED_AFTER_SQL, [blogId, now, cursor.publishedAt, cursor.publishedAt, cursor.postId, now])
    : await pool.query<RowDataPacket[]>(PROFILE_FEED_SQL, [blogId, now, now]);
  const kept = rows.slice(0, PROFILE_FEED_PAGE);
  const last = kept.at(-1);
  const lastAt = last ? iso(last.publishedAt) : null;
  const icons = await iconManifest();
  return {
    evidenceType: 'direct-link' as const,
    location: 'body' as const,
    limit: PROFILE_FEED_PAGE,
    generatedAt: now.toISOString(),
    items: kept.map((r) => profileMentionRow(r, icons)),
    nextCursor: rows.length > PROFILE_FEED_PAGE && last && lastAt ? `${lastAt}_${Number(last.postId)}` : null,
  };
}
