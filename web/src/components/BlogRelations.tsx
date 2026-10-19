// The profile's 引用與交流 (app/src/relations/routes.ts readBlogRelations). Three kinds of relation stay apart:
// body links are the only citations and the only thing counted in 篇; non-body links, shared publisher tags and
// text similarity are listed on their own and never added to those counts. What a block has nothing to show is
// left out rather than explained; how each is read lives once, in the footer's 引用與交流 (FooterMethod.tsx).
import ReloadButton from '@/components/public/ReloadButton';
import { displayTitle } from '@/lib/api';
import { publicJsonOrNull } from '@/lib/public-api';
import { PublicGatewayError } from '@/lib/public-read';
import {
  countText,
  dayText,
  externalHref,
  hitsByTag,
  locationOf,
  overlapPercent,
  parseTextSimilarity,
  type RelationEvidence,
  type Relations,
  type SharedTagHit,
  type SharedTags,
  type SimilarityItem,
  type SimilarityReason,
  type SimilaritySelection,
  type SimilaritySide,
  type TextSimilarity,
} from '@/lib/relations';
import Link from './NoPrefetchLink';
import RelationLists from './RelationLists';

const muted = 'text-zinc-500 dark:text-zinc-400';
const link = 'text-brand-700 underline dark:text-brand-400';
const tag = 'text-brand-700 dark:text-brand-400';
const block = 'space-y-3 rounded-xl border border-zinc-300 p-4 dark:border-zinc-800';

/** A detail line's known parts; a value the gateway did not send is left out, never shown as 未提供 or 0. */
const known = (parts: string[]) => parts.filter(Boolean).join(' · ');

/** A public article link when the URL is http(s); otherwise its title as text. */
function Outbound({ href, children }: { href: unknown; children: React.ReactNode }) {
  const url = externalHref(href);
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className={link}>
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}

/**
 * A link row's whole identity: every field it shows, in a fixed order, so the key does not depend on where the
 * gateway put the row. Links that differ in anchor, context or anything else stay separate rows.
 */
export const evidenceKey = (e: RelationEvidence) =>
  JSON.stringify(
    [
      e.postId,
      e.postTitle,
      e.postUrl,
      e.targetUrl,
      e.anchor,
      e.publishedAt,
      e.sourceBlogId,
      e.targetBlogId,
      e.location,
      e.context,
      e.observedAt,
      e.matchVersion,
      e.evidenceType,
      e.contextSource,
    ].map((value) => value ?? null),
  );
/** Rows identical in every field read the same, so they are listed (and counted) once. */
export function distinctEvidence(items: RelationEvidence[]) {
  return [...new Map(items.map((e) => [evidenceKey(e), e])).entries()];
}

function EvidenceItem({ e, blogId, name }: { e: RelationEvidence; blogId?: number; name: (id?: number | null) => string }) {
  const direction =
    blogId !== undefined && e.sourceBlogId === blogId
      ? `提到 ${name(e.targetBlogId)}`
      : blogId !== undefined && e.targetBlogId === blogId
        ? `${name(e.sourceBlogId)} 提到本站`
        : null;
  return (
    <li className="min-w-0 break-words">
      <p>
        {direction ? <span className={`mr-2 ${muted}`}>{direction}：</span> : null}
        <Outbound href={e.postUrl}>{displayTitle(e.postTitle) || '（無標題）'}</Outbound>
        <span className="mx-2">→</span>
        <Outbound href={e.targetUrl}>{e.anchor || '原始連結'}</Outbound>
      </p>
      {e.context ? <p className="mt-1 text-zinc-700 dark:text-zinc-300">「{e.context}」</p> : null}
      <p className={`mt-1 text-xs ${muted}`}>
        {known([
          e.postId == null ? '' : `文章 #${e.postId}`,
          e.publishedAt ? `發表 ${dayText(e.publishedAt)}` : '',
          e.location ? `位置 ${locationOf(e.location)}` : '',
          e.context && e.contextSource ? `摘要取自${locationOf(e.contextSource)}` : '',
          e.matchVersion ? `比對版本 ${e.matchVersion}` : '',
          e.observedAt ? `觀測 ${dayText(e.observedAt)}` : '',
        ])}
      </p>
    </li>
  );
}

/** One list of links, left out when there are none. Each row is a link, not an article. */
function EvidenceList({
  label,
  items,
  truncated,
  blogId,
  name,
}: {
  label: string;
  items: RelationEvidence[] | undefined;
  truncated: boolean | undefined;
  blogId?: number;
  name: (id?: number | null) => string;
}) {
  if (!items?.length) return null;
  const rows = distinctEvidence(items);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer">
        {label}（列出 {rows.length} 筆連結{truncated ? '，僅最近 20 筆' : ''}）
      </summary>
      <ul className="mt-3 space-y-3">
        {rows.map(([key, e]) => (
          <EvidenceItem key={key} e={e} blogId={blogId} name={name} />
        ))}
      </ul>
    </details>
  );
}

function SharedTagRow({ hit }: { hit: SharedTagHit }) {
  return (
    <li className="min-w-0 break-words">
      <p>
        <span className={muted}>本站：</span>
        <Outbound href={hit.sourceArticleUrl}>{displayTitle(hit.sourceArticleTitle) || '（無標題）'}</Outbound>
        <span className={`ml-1 text-xs ${muted}`}>{dayText(hit.sourceArticlePublishedAt)}</span>
      </p>
      <p>
        {/* Name only: the gateway's slug is an API key, and a guessed /blogs/ path could be the wrong page. */}
        <span className={muted}>{hit.targetBlogName || `部落格 #${hit.targetBlogId}`}：</span>
        <Outbound href={hit.targetArticleUrl}>{displayTitle(hit.targetArticleTitle) || '（無標題）'}</Outbound>
        <span className={`ml-1 text-xs ${muted}`}>{dayText(hit.targetArticlePublishedAt)}</span>
      </p>
      <p className={`mt-1 text-xs ${muted}`}>
        {known([
          `文章 #${hit.sourceArticleId}／#${hit.targetArticleId}`,
          `標籤 #${hit.tagId}${hit.tagSourceType ? `（${hit.tagSourceType}${hit.tagLastSeenAt ? `，確認於 ${dayText(hit.tagLastSeenAt)}` : ''}）` : ''}`,
          hit.sourceType && hit.targetSourceType ? `標籤來源 ${hit.sourceType}／${hit.targetSourceType}` : '',
          hit.lastSeenAt && hit.targetLastSeenAt ? `最後看到 ${dayText(hit.lastSeenAt)}／${dayText(hit.targetLastSeenAt)}` : '',
          hit.matchVersion ? `比對版本 ${hit.matchVersion}` : '',
        ])}
      </p>
    </li>
  );
}

/** Shared publisher tags, only when the comparison ran and found some; off, failed or none leaves the block out. */
type ReadySharedTags = Extract<SharedTags, { status: 'ready' }>;
const readySharedTags = (value: SharedTags | undefined): ReadySharedTags | null =>
  value?.status === 'ready' && hitsByTag(value.items).length ? value : null;
function SharedTagsBlock({ value }: { value: ReadySharedTags }) {
  const groups = hitsByTag(value.items);
  return (
    <div className="space-y-2 text-sm">
      <ul aria-label="共同標籤" className="flex flex-wrap gap-x-3 gap-y-1">
        {groups.map((g) => (
          <li key={g.tagId}>
            <span className={tag}>#{g.label}</span>
            <span className={`ml-1 text-xs ${muted}`}>{g.hits.length} 組文章</span>
          </li>
        ))}
      </ul>
      {value.truncated || value.sourceTagsTruncated ? (
        <p className={`text-xs ${muted}`}>
          {value.sourceTagsTruncated ? '只比對了本站部分近期標籤。' : ''}
          {value.truncated ? '只列出部分文章組合。' : ''}
        </p>
      ) : null}
      <details>
        <summary className="cursor-pointer">核對共同標籤的文章（{value.items.length} 組）</summary>
        <ul className="mt-3 space-y-3">
          {groups.map((g) => (
            <li key={g.tagId}>
              <p className={`font-medium ${tag}`}>#{g.label}</p>
              <ul className="mt-1 space-y-2">
                {g.hits.map((hit) => (
                  <SharedTagRow key={`${hit.sourceArticleId}:${hit.targetArticleId}`} hit={hit} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

const REASON_TEXT: Record<SimilarityReason, string> = {
  'evidence-unavailable': '來源證據無法確認',
  overcap: '正文超過比對上限',
  'invalid-utf8': '正文編碼無效',
  'stale-or-unavailable': '文章已變更或不再公開',
  'same-publication': '兩篇屬於同一個網站',
};

/** One article of a pair: public title link, publish date and the public summary preview. */
function SimilaritySideRow({ label, side, id }: { label: string; side: SimilaritySide | null; id: number }) {
  if (!side)
    return (
      <p>
        <span className={muted}>{label}：</span>文章 #{id}
      </p>
    );
  return (
    <div>
      <p>
        <span className={muted}>{label}：</span>
        <Outbound href={side.url}>{displayTitle(side.title) || '（無標題）'}</Outbound>
        <span className={`ml-1 text-xs ${muted}`}>發表 {dayText(side.publishedAt)}</span>
      </p>
      {side.excerpt ? <p className="mt-0.5 text-xs text-zinc-700 dark:text-zinc-300">摘要：「{side.excerpt}」</p> : null}
    </div>
  );
}

function SimilarityRow({ item }: { item: SimilarityItem }) {
  if (item.status === 'unavailable')
    return (
      <li className={`min-w-0 break-words ${muted}`}>
        文章 #{item.sourceArticleId}／#{item.targetArticleId}：無法比對{item.reason ? `（${REASON_TEXT[item.reason]}）` : ''}
      </li>
    );
  const sides = [item.source, item.target];
  const prefix = sides.map((side) => countText(side?.prefixCodepoints)).join('／');
  return (
    <li className="min-w-0 break-words space-y-1">
      <SimilaritySideRow label="本站" side={item.source} id={item.sourceArticleId} />
      <SimilaritySideRow label="連到的文章" side={item.target} id={item.targetArticleId} />
      {item.status === 'ready' ? (
        <p className={tag}>字面重疊 {overlapPercent(item.lexicalSimilarity)}</p>
      ) : (
        <p className={`text-xs ${muted}`}>正文前段太短，無法比對。</p>
      )}
      <p className={`text-xs ${muted}`}>
        {known([
          `文章 #${item.sourceArticleId}／#${item.targetArticleId}`,
          item.source?.observedAt && item.target?.observedAt
            ? `觀測 ${dayText(item.source.observedAt)}／${dayText(item.target.observedAt)}`
            : '',
          sides.every((side) => typeof side?.prefixCodepoints === 'number')
            ? `比對字數 ${prefix}${sides.some((side) => side?.truncated) ? '（只比前段）' : ''}`
            : '',
          item.matchVersion ? `比對版本 ${item.matchVersion}` : '',
        ])}
      </p>
    </li>
  );
}

/** How many pairs were picked, under the results; how they are picked is in the footer. */
function SimilaritySelectionNote({ selection }: { selection: SimilaritySelection }) {
  // An older gateway that sends no counts: nothing to say.
  if (typeof selection.selectedPairs !== 'number' || typeof selection.selectionLimit !== 'number') return null;
  return (
    <p data-method="text-similarity" className={`text-xs ${muted}`}>
      選了 {countText(selection.selectedPairs)} 組（上限 {countText(selection.selectionLimit)} 組）
      {selection.selectionTruncated === true ? '，還有符合條件的連結沒有選入' : ''}
    </p>
  );
}

/** Text-prefix overlap for a few known body-link pairs, only when there are results to show. */
const similarityView = (value: TextSimilarity | undefined) => {
  const view = parseTextSimilarity(value);
  return view.status === 'ready' && view.items.length ? view : null;
};
function TextSimilarityBlock({ view }: { view: NonNullable<ReturnType<typeof similarityView>> }) {
  return (
    <div className="space-y-2 text-sm">
      <ul aria-label="文字相似配對" className="space-y-3">
        {view.items.map((item) => (
          <SimilarityRow key={`${item.sourceArticleId}:${item.targetArticleId}`} item={item} />
        ))}
      </ul>
      {view.omittedItems > 0 ? <p className={`text-xs ${muted}`}>另有 {view.omittedItems} 組資料無法顯示。</p> : null}
      <SimilaritySelectionNote selection={view.selection} />
    </div>
  );
}

/** The section's frame: the heading, its period and the link to the site-wide map. */
function Section({ children, days }: { children: React.ReactNode; days?: number }) {
  return (
    <section id="relations" className="mt-8 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">
          引用與交流
          {days ? <span className={`ml-2 text-sm font-normal ${muted}`}>近 {days} 天</span> : null}
        </h2>
        <Link href="/relations/" className="text-sm text-brand-700 hover:underline dark:text-brand-400">
          全站關係圖 →
        </Link>
      </div>
      {children}
    </section>
  );
}

export default async function BlogRelations({ slug }: { slug: string }) {
  // Optional: a gateway failure (5xx, network, a 200 public-contracts.ts rejects) stays inside this section with a
  // retry and the rest of the profile renders. null is the gateway's 404. Anything else is rethrown untouched.
  let data: Relations | null = null;
  try {
    data = await publicJsonOrNull<Relations>(`/api/blogs/${encodeURIComponent(slug)}/relations?days=90`);
  } catch (error) {
    if (!(error instanceof PublicGatewayError)) throw error;
    return (
      <Section>
        <div role="alert" className={`text-sm ${muted}`}>
          <p>關係資料暫時無法讀取，請稍後再試。</p>
          <ReloadButton />
        </div>
      </Section>
    );
  }
  if (!data) return null;
  const names = new Map(data.nodes.map((n) => [n.id, n.name]));
  const name = (id?: number | null) => (id == null ? '部落格' : (names.get(id) ?? `部落格 #${id}`));
  const days = data.days;
  const nonBody = data.coverage?.nonBodyLinks;
  const nonBodyCounts = [
    ['Blogroll', nonBody?.blogroll],
    ['側欄', nonBody?.sidebar],
    ['留言', nonBody?.comment],
  ].filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0);
  const hasBody = Boolean(data.outgoing?.length || data.incoming?.length || data.evidence?.length);
  const hasNonBody = Boolean(nonBodyCounts.length || data.nonBodyEvidence?.length);
  const tags = readySharedTags(data.sharedTags);
  const similar = similarityView(data.textSimilarity);
  // Nothing found in the period: the whole section is left out.
  if (!hasBody && !hasNonBody && !tags && !similar) return null;
  return (
    <Section days={days}>
      {hasBody && (
        <section aria-labelledby="relations-body" className={block}>
          <h3 id="relations-body" className="font-semibold">
            正文直接引用
          </h3>
          <div className="grid gap-4 lg:grid-cols-2">
            <RelationLists title="提到誰" edges={data.outgoing ?? []} nodes={data.nodes} />
            <RelationLists title="被誰提到" edges={data.incoming ?? []} nodes={data.nodes} incoming />
          </div>
          <EvidenceList label="核對正文連結" items={data.evidence} truncated={data.evidenceTruncated} blogId={data.blogId} name={name} />
          {data.profileTruncated ? <p className={`text-xs ${muted}`}>只顯示前 1,000 條關係。</p> : null}
        </section>
      )}

      {hasNonBody && (
        <section aria-labelledby="relations-non-body" className={block}>
          <h3 id="relations-non-body" className="font-semibold">
            非正文連結
          </h3>
          {nonBodyCounts.length > 0 && (
            <p className={`text-xs ${muted}`}>{nonBodyCounts.map(([label, n]) => `${label} ${countText(n)} 條`).join('、')}</p>
          )}
          <EvidenceList
            label="核對非正文連結"
            items={data.nonBodyEvidence}
            truncated={data.nonBodyEvidenceTruncated}
            blogId={data.blogId}
            name={name}
          />
        </section>
      )}

      {tags && (
        <section aria-labelledby="relations-tags" className={block}>
          <h3 id="relations-tags" className="font-semibold">
            共同標籤
          </h3>
          <SharedTagsBlock value={tags} />
        </section>
      )}

      {similar && (
        <section aria-labelledby="relations-text" className={block}>
          <h3 id="relations-text" className="font-semibold">
            文字相似
          </h3>
          <TextSimilarityBlock view={similar} />
        </section>
      )}
    </Section>
  );
}
