import type { Pool, RowDataPacket } from 'mysql2/promise';

/** Tags a list row may show beside its title; `tagCount` keeps the full count for "+N". */
export const POST_TAG_LIMIT = 5;
const STATEMENT_SECONDS = 1;

// Feed defaults that say nothing about the post. Compared after NFKC + lowercase.
const PLACEHOLDER_LABELS = new Set([
  '未分類',
  '未分类',
  '未分類文章',
  '無分類',
  '其他',
  '其它',
  'uncategorized',
  'uncategorised',
  'posts',
  'post',
  'categories',
  'category',
  'other',
  'others',
  'misc',
]);
const placeholder = (label: string) => PLACEHOLDER_LABELS.has(label.normalize('NFKC').toLocaleLowerCase('zh-TW').trim());

export type PostTag = { slug: string; label: string };
export type PostTags = { tags: PostTag[]; tagCount: number };

/**
 * The author's own feed categories for already-chosen public posts, one bounded
 * statement over the post_tags primary key. Only active public tags; placeholder
 * categories are dropped before counting. Feed order where the crawler recorded
 * it (position), otherwise first-seen tag order.
 */
export async function loadPostTags(pool: Pick<Pool, 'query'>, postIds: Iterable<unknown>, limit = POST_TAG_LIMIT) {
  const ids = [...new Set([...postIds].map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  const out = new Map<number, PostTags>();
  if (!ids.length) return out;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SET STATEMENT max_statement_time=${STATEMENT_SECONDS} FOR SELECT pt.post_id postId,t.slug,t.label FROM post_tags pt JOIN tags t ON t.id=pt.tag_id
    WHERE pt.post_id IN (?) AND pt.status='active' AND t.status='active' AND t.visibility='public' ORDER BY pt.post_id,pt.position,t.id`,
    [ids],
  );
  const seen = new Set<string>();
  for (const row of rows) {
    const label = String(row.label ?? '').trim();
    if (!label || placeholder(label)) continue;
    const id = Number(row.postId);
    // Distinct slugs can share a label (e.g. punctuation-only differences); show it once.
    if (seen.has(`${id}\n${label}`)) continue;
    seen.add(`${id}\n${label}`);
    const entry = out.get(id) ?? { tags: [], tagCount: 0 };
    entry.tagCount++;
    if (entry.tags.length < limit) entry.tags.push({ slug: String(row.slug), label });
    out.set(id, entry);
  }
  return out;
}

/**
 * Adds `tags`/`tagCount` to each item whose id has tags. Tags are decoration: a
 * failed or slow read leaves the items untagged (reported through onFailure)
 * instead of failing the list.
 */
export async function withPostTags<T extends Record<string, unknown>>(
  pool: Pick<Pool, 'query'>,
  items: T[],
  { id = (item: T) => item.id, onFailure }: { id?: (item: T) => unknown; onFailure?: (error: unknown) => void } = {},
): Promise<T[]> {
  let tags: Map<number, PostTags>;
  try {
    tags = await loadPostTags(pool, items.map(id));
  } catch (error) {
    onFailure?.(error);
    return items;
  }
  return items.map((item) => {
    const found = tags.get(Number(id(item)));
    return found ? { ...item, ...found } : item;
  });
}
