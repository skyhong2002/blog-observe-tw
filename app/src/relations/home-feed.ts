import type { Pool, RowDataPacket } from 'mysql2/promise';
import { iconManifest } from '../v1/favicon-routes.ts';
import { iconUrl } from '../v1/icons.ts';
import { PUBLIC_RELATION } from './public-relation.ts';

export const HOME_MENTION_LIMIT = 8;
export const HOME_MENTION_DAYS = 90;

/** This is the same article→blog body-link evidence as /relations, never shared tags or text similarity. */
export const HOME_MENTIONS_SQL = `SET STATEMENT max_statement_time=1 FOR WITH visible_mentions AS (
 SELECT p.id postId,p.title postTitle,p.url postUrl,p.published_at publishedAt,
 a.id sourceBlogId,a.slug sourceBlogSlug,a.name sourceBlogName,
 b.id targetBlogId,b.slug targetBlogSlug,b.name targetBlogName,b.url targetHomeUrl,
 l.anchor_text anchor,l.context,l.observed_at observedAt,o.parser_version matchVersion,
 ROW_NUMBER() OVER (PARTITION BY p.id,b.id ORDER BY l.ordinal) link_number
 FROM relation_links l JOIN posts p ON p.id=l.source_post_id AND p.blog_id=l.source_blog_id
 JOIN blogs a ON a.id=l.source_blog_id JOIN blogs b ON b.id=l.target_blog_id
 JOIN relation_observations o ON o.post_id=p.id
 WHERE ${PUBLIC_RELATION} AND l.location='body' AND a.status='verified' AND b.status='verified'
 AND a.id<>b.id AND p.published_at>=? AND p.published_at<=?
 AND (l.target_post_id IS NULL OR EXISTS (SELECT 1 FROM posts tp WHERE tp.id=l.target_post_id
 AND tp.blog_id=b.id AND (tp.published_at IS NULL OR tp.published_at<=?)))
 ) SELECT * FROM visible_mentions WHERE link_number=1
 ORDER BY publishedAt DESC,postId DESC,targetBlogId LIMIT 9`;

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
/** Fresh SQL on every overview read: a hide committed before B cannot inherit A's data. */
export async function loadHomeMentions(pool: Pool, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw Error('invalid_home_mention_date');
  const from = new Date(now.getTime() - HOME_MENTION_DAYS * 86400_000);
  const [rows] = await pool.query<RowDataPacket[]>(HOME_MENTIONS_SQL, [from, now, now]);
  const icons = await iconManifest();
  return {
    days: HOME_MENTION_DAYS,
    evidenceType: 'direct-link' as const,
    location: 'body' as const,
    limit: HOME_MENTION_LIMIT,
    truncated: rows.length > HOME_MENTION_LIMIT,
    generatedAt: now.toISOString(),
    items: rows.slice(0, HOME_MENTION_LIMIT).map((r) => {
      const targetHomeUrl = mentionPublicUrl(r.targetHomeUrl);
      return {
        postId: Number(r.postId),
        postTitle: r.postTitle,
        postUrl: mentionPublicUrl(r.postUrl),
        publishedAt: iso(r.publishedAt),
        sourceBlogId: Number(r.sourceBlogId),
        sourceBlogSlug: r.sourceBlogSlug,
        sourceBlogName: r.sourceBlogName,
        sourceIconUrl: iconUrl(r.sourceBlogSlug, icons),
        targetBlogId: Number(r.targetBlogId),
        targetBlogSlug: r.targetBlogSlug,
        targetBlogName: r.targetBlogName,
        targetHomeUrl,
        targetDomain: targetHomeUrl ? new URL(targetHomeUrl).hostname : null,
        targetIconUrl: iconUrl(r.targetBlogSlug, icons),
        evidenceType: 'direct-link' as const,
        location: 'body' as const,
        anchor: String(r.anchor ?? '').slice(0, 255),
        context: String(r.context ?? '').slice(0, 240),
        observedAt: iso(r.observedAt),
        matchVersion: r.matchVersion,
        contextSource: 'body' as const,
      };
    }),
  };
}
