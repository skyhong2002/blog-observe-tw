import { normalizeLink } from './identity.ts';
import type { LinkLocation } from './parser.ts';

type Base = { sourceBlogId: number; targetBlogId: number; observedAt: string };
export type RelationEvidence =
  | (Base & { type: 'direct-link'; sourcePostId: number; targetUrl: string; location: LinkLocation; sourceVersion: string })
  | (Base & { type: 'shared-tags'; tags: { id: number; label: string }[]; sourceVersion: string })
  | (Base & {
      type: 'text-similarity';
      sourcePostId: number;
      targetPostId: number;
      score: number;
      algorithmVersion: string;
      sourceHash: string;
      targetHash: string;
    });
const id = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const version = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value);
const locations: LinkLocation[] = ['body', 'blogroll', 'sidebar', 'comment'];
/** DTO-only contract for root integration. Caller must apply current-public SQL predicates.
 * No inference: shared tags do not imply a direct link, and absent similarity evidence stays absent.
 */
export function projectRelationEvidence(value: unknown, now = new Date()): RelationEvidence | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (!id(row.sourceBlogId) || !id(row.targetBlogId) || row.sourceBlogId === row.targetBlogId || typeof row.observedAt !== 'string')
    return null;
  const observed = Date.parse(row.observedAt);
  if (!Number.isFinite(observed) || observed > now.getTime()) return null;
  const base = { sourceBlogId: row.sourceBlogId, targetBlogId: row.targetBlogId, observedAt: new Date(observed).toISOString() };
  if (
    row.type === 'direct-link' &&
    id(row.sourcePostId) &&
    typeof row.targetUrl === 'string' &&
    locations.includes(row.location as LinkLocation) &&
    version(row.sourceVersion)
  ) {
    const targetUrl = normalizeLink(row.targetUrl);
    return targetUrl
      ? {
          ...base,
          type: row.type,
          sourcePostId: row.sourcePostId,
          targetUrl,
          location: row.location as LinkLocation,
          sourceVersion: row.sourceVersion,
        }
      : null;
  }
  if (row.type === 'shared-tags' && version(row.sourceVersion) && Array.isArray(row.tags) && row.tags.length > 0 && row.tags.length <= 50) {
    const tags: { id: number; label: string }[] = [];
    const seen = new Set<number>();
    for (const tag of row.tags) {
      if (
        !tag ||
        !id(tag.id) ||
        typeof tag.label !== 'string' ||
        !tag.label.trim() ||
        [...tag.label].length > 100 ||
        /[\p{Cc}\p{Cf}]/u.test(tag.label)
      )
        return null;
      if (!seen.has(tag.id)) tags.push({ id: tag.id, label: tag.label });
      seen.add(tag.id);
    }
    return { ...base, type: row.type, tags, sourceVersion: row.sourceVersion };
  }
  if (
    row.type === 'text-similarity' &&
    id(row.sourcePostId) &&
    id(row.targetPostId) &&
    typeof row.score === 'number' &&
    Number.isFinite(row.score) &&
    row.score >= 0 &&
    row.score <= 1 &&
    version(row.algorithmVersion) &&
    typeof row.sourceHash === 'string' &&
    /^[a-f0-9]{64}$/.test(row.sourceHash) &&
    typeof row.targetHash === 'string' &&
    /^[a-f0-9]{64}$/.test(row.targetHash)
  ) {
    return {
      ...base,
      type: row.type,
      sourcePostId: row.sourcePostId,
      targetPostId: row.targetPostId,
      score: row.score,
      algorithmVersion: row.algorithmVersion,
      sourceHash: row.sourceHash,
      targetHash: row.targetHash,
    };
  }
  return null;
}

/** Mirrors the existing SQL COUNT(DISTINCT source_post_id) per edge/location.
 * Never mutate/drop the original URL, anchor or context observations.
 */
export function countDirectMentionEvidence(
  rows: readonly { sourcePostId: number; sourceBlogId: number; targetBlogId: number | null; location: LinkLocation }[],
) {
  const groups = new Map<string, { sourceBlogId: number; targetBlogId: number; location: LinkLocation; posts: Set<number> }>();
  for (const row of rows) {
    if (
      !id(row.sourcePostId) ||
      !id(row.sourceBlogId) ||
      !id(row.targetBlogId) ||
      row.sourceBlogId === row.targetBlogId ||
      !locations.includes(row.location)
    )
      continue;
    const key = `${row.sourceBlogId}:${row.targetBlogId}:${row.location}`;
    const group = groups.get(key) ?? {
      sourceBlogId: row.sourceBlogId,
      targetBlogId: row.targetBlogId,
      location: row.location,
      posts: new Set<number>(),
    };
    group.posts.add(row.sourcePostId);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ posts, ...group }) => ({ ...group, count: posts.size }));
}
