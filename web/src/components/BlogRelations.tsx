// The profile's 引用與交流 (app/src/relations/routes.ts readBlogRelations). Three kinds of relation stay apart:
// body links are the only citations and the only thing counted in 篇; non-body links, shared publisher tags and
// text similarity are listed on their own and never added to those counts. A key an older gateway does not send
// is said as 未提供, never rendered as an empty success.
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
  MISSING,
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
      {e.context ? (
        <p className="mt-1 text-zinc-700 dark:text-zinc-300">「{e.context}」</p>
      ) : (
        <p className={`mt-1 text-xs ${muted}`}>上下文摘要{MISSING}</p>
      )}
      <p className={`mt-1 text-xs ${muted}`}>
        {e.postId == null ? `文章 ID ${MISSING}` : `文章 #${e.postId}`} · 發表 {dayText(e.publishedAt)} · 位置 {locationOf(e.location)}
        {e.context ? ` · 摘要取自${locationOf(e.contextSource)}` : ''} · 比對版本 {e.matchVersion || MISSING} · 觀測{' '}
        {dayText(e.observedAt, MISSING)}
      </p>
    </li>
  );
}

/** One list of links, or 未提供 when the gateway did not send it. Each row is a link, not an article. */
function EvidenceList({
  label,
  items,
  truncated,
  empty,
  blogId,
  name,
}: {
  label: string;
  items: RelationEvidence[] | undefined;
  truncated: boolean | undefined;
  empty: string;
  blogId?: number;
  name: (id?: number | null) => string;
}) {
  if (!items)
    return (
      <p className={`text-sm ${muted}`}>
        {label}：資料{MISSING}。
      </p>
    );
  if (!items.length) return <p className={`text-sm ${muted}`}>{empty}</p>;
  const rows = distinctEvidence(items);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer">
        {label}（列出 {rows.length} 筆連結{truncated ? '，僅最近 20 筆' : ''}）
      </summary>
      <p className={`mt-2 text-xs ${muted}`}>每筆是一條連結：同一篇文章連到多個網址會列成多筆，篇數以上方統計為準。</p>
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
        文章 #{hit.sourceArticleId}／#{hit.targetArticleId} · 標籤 #{hit.tagId}（{hit.tagSourceType || MISSING}，確認於{' '}
        {dayText(hit.tagLastSeenAt, MISSING)}） · 標籤來源 {hit.sourceType || MISSING}／{hit.targetSourceType || MISSING} · 最後看到{' '}
        {dayText(hit.lastSeenAt, MISSING)}／{dayText(hit.targetLastSeenAt, MISSING)} · 比對版本 {hit.matchVersion || MISSING}
      </p>
    </li>
  );
}

/** Shared publisher tags: every state says what it does not prove; off or unavailable is never "no shared tags". */
function SharedTagsBlock({ value, days }: { value: SharedTags | undefined; days: number }) {
  if (!value) return <p className={`text-sm ${muted}`}>共同標籤資料{MISSING}。</p>;
  if (value.status === 'not-enabled')
    return <p className={`text-sm ${muted}`}>共同標籤比對目前未開啟，這裡沒有結果；不代表沒有共同標籤。</p>;
  if (value.status === 'unavailable')
    return (
      <p role="status" className={`text-sm ${muted}`}>
        共同標籤暫時無法讀取（比對版本 {value.matchVersion || MISSING}）；不代表沒有共同標籤。
      </p>
    );
  if (value.status !== 'ready') return <p className={`text-sm ${muted}`}>共同標籤資料{MISSING}。</p>;
  const groups = hitsByTag(value.items);
  return (
    <div className="space-y-2 text-sm">
      <p className={`text-xs ${muted}`}>{value.interpretation}</p>
      {groups.length ? (
        <>
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
              {value.sourceTagsTruncated ? '本站近期標籤較多，只比對其中一部分。' : ''}
              {value.truncated ? '結果達上限，只列出部分文章組合。' : ''}
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
        </>
      ) : (
        <p className={muted}>
          近 {value.days ?? days} 天沒有找到與其他部落格相同的原始文章標籤。
          {value.sourceTagsTruncated ? '本站近期標籤較多，只比對其中一部分。' : ''}
        </p>
      )}
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
const NOT_PROOF = '只是正規化正文前段的字面重疊，不是引用、語意相似、抄襲或交流。';

/** One article of a pair: public title link, publish date and the public summary preview. */
function SimilaritySideRow({ label, side, id }: { label: string; side: SimilaritySide | null; id: number }) {
  if (!side)
    return (
      <p>
        <span className={muted}>{label}：</span>文章 #{id}（公開資料{MISSING}）
      </p>
    );
  return (
    <div>
      <p>
        <span className={muted}>{label}：</span>
        <Outbound href={side.url}>{displayTitle(side.title) || '（無標題）'}</Outbound>
        <span className={`ml-1 text-xs ${muted}`}>發表 {dayText(side.publishedAt)}</span>
      </p>
      {side.excerpt ? (
        <p className="mt-0.5 text-xs text-zinc-700 dark:text-zinc-300">摘要：「{side.excerpt}」</p>
      ) : (
        <p className={`mt-0.5 text-xs ${muted}`}>公開摘要{MISSING}</p>
      )}
    </div>
  );
}

function SimilarityRow({ item }: { item: SimilarityItem }) {
  if (item.status === 'unavailable')
    return (
      <li className={`min-w-0 break-words ${muted}`}>
        文章 #{item.sourceArticleId}／#{item.targetArticleId}：目前無法比對{item.reason ? `（${REASON_TEXT[item.reason]}）` : ''}
        ；不顯示分數或預覽，也不代表兩篇不相近。
      </li>
    );
  const sides = [item.source, item.target];
  const prefix = sides.map((side) => countText(side?.prefixCodepoints)).join('／');
  return (
    <li className="min-w-0 break-words space-y-1">
      <SimilaritySideRow label="本站" side={item.source} id={item.sourceArticleId} />
      <SimilaritySideRow label="連到的文章" side={item.target} id={item.targetArticleId} />
      {item.status === 'ready' ? (
        <p>
          <span className={tag}>字面重疊 {overlapPercent(item.lexicalSimilarity)}</span>
          <span className={`ml-2 text-xs ${muted}`}>{NOT_PROOF}</span>
        </p>
      ) : (
        <p className={`text-xs ${muted}`}>正文前段太短，無法比對，不顯示分數。</p>
      )}
      <p className={`text-xs ${muted}`}>
        文章 #{item.sourceArticleId}／#{item.targetArticleId} · 觀測 {dayText(item.source?.observedAt, MISSING)}／
        {dayText(item.target?.observedAt, MISSING)} · 比對字數 {prefix}
        {sides.some((side) => side?.truncated) ? '（正文較長，只比前段）' : ''} · 比對版本 {item.matchVersion ?? MISSING} ·{' '}
        預覽取自公開摘要，比對用的正文不公開
      </p>
    </li>
  );
}

/** How the pairs were picked, after the results: the gateway's numbers, never a claim of a complete comparison. */
function SimilaritySelectionNote({ selection }: { selection: SimilaritySelection }) {
  return (
    <details data-method="text-similarity" className={`text-xs ${muted}`}>
      <summary className="cursor-pointer">選取方式與範圍</summary>
      <p className="mt-1">
        {selection.selectionOrigin === 'observed-outgoing-body-links'
          ? '只從本站近期已觀測、且知道目標文章的正文直接連結裡選取配對，不另外搜尋或兩兩比對。'
          : `選取來源${MISSING}。`}
        本次選了 {countText(selection.selectedPairs)} 組（上限 {countText(selection.selectionLimit)} 組）
        {selection.selectionTruncated === true ? '，還有符合條件的連結沒有選入' : ''}。這不是全面比對：沒有列出的文章不代表不相近。
      </p>
    </details>
  );
}

/** Text-prefix overlap for a few known body-link pairs; every state says what it does not prove. */
function TextSimilarityBlock({ value }: { value: TextSimilarity | undefined }) {
  const view = parseTextSimilarity(value);
  switch (view.status) {
    case 'not-analysed':
      return <p className={`text-sm ${muted}`}>尚未分析：目前沒有文字相似的計算結果，這裡不列任何相似文章。</p>;
    case 'not-enabled':
      return <p className={`text-sm ${muted}`}>文字相似比對目前未開啟，這裡沒有結果；不代表沒有文字相近的文章。</p>;
    case 'no-selected-pairs':
      return (
        <>
          <p className={`text-sm ${muted}`}>
            這段期間沒有可比對的配對：近期正文直接連結裡沒有已知目標文章的連結。這不代表沒有文字相近的文章。
          </p>
          <SimilaritySelectionNote selection={view.selection} />
        </>
      );
    case 'unavailable':
      return (
        <>
          <p role="status" className={`text-sm ${muted}`}>
            文字相似暫時無法讀取；不代表沒有文字相近的文章。
          </p>
          <SimilaritySelectionNote selection={view.selection} />
        </>
      );
    case 'ready':
      return (
        <div className="space-y-2 text-sm">
          <p className={`text-xs ${muted}`}>只比對本站文章與它在正文裡直接連到的文章。{NOT_PROOF}</p>
          {view.items.length ? (
            <ul aria-label="文字相似配對" className="space-y-3">
              {view.items.map((item) => (
                <SimilarityRow key={`${item.sourceArticleId}:${item.targetArticleId}`} item={item} />
              ))}
            </ul>
          ) : (
            <p className={muted}>沒有可列出的配對結果。</p>
          )}
          {view.omittedItems > 0 ? <p className={`text-xs ${muted}`}>另有 {view.omittedItems} 組資料無法顯示。</p> : null}
          <SimilaritySelectionNote selection={view.selection} />
        </div>
      );
    default:
      return <p className={`text-sm ${muted}`}>文字相似資料{MISSING}。</p>;
  }
}

/** The section's frame: the heading and the link to the site-wide map stay whatever the read returned. */
function Section({ children }: { children: React.ReactNode }) {
  return (
    <section id="relations" className="mt-8 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">引用與交流</h2>
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
          <p>關係資料暫時無法讀取，請稍後再試。這不是觀測結果，也不代表沒有引用或交流。</p>
          <ReloadButton />
        </div>
      </Section>
    );
  }
  if (!data)
    return (
      <Section>
        <p role="status" className={`text-sm ${muted}`}>
          目前沒有提供這個部落格的關係資料。
        </p>
      </Section>
    );
  const names = new Map(data.nodes.map((n) => [n.id, n.name]));
  const name = (id?: number | null) => (id == null ? '部落格' : (names.get(id) ?? `部落格 #${id}`));
  const days = data.days;
  const nonBody = data.coverage?.nonBodyLinks;
  return (
    <Section>
      <p className={`text-sm ${muted}`}>近 {days} 天。下面三種關係分開列出：只有正文直接引用計入「篇」；共同標籤與文字相似都不是引用。</p>

      <section aria-labelledby="relations-body" className={block}>
        <h3 id="relations-body" className="font-semibold">
          正文直接引用
        </h3>
        <p className={`text-xs ${muted}`}>文章正文裡連到其他已收錄部落格的連結；「篇」是提及方提到對方的文章數。</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <RelationLists title="提到誰" edges={data.outgoing ?? []} nodes={data.nodes} />
          <RelationLists title="被誰提到" edges={data.incoming ?? []} nodes={data.nodes} incoming />
        </div>
        <EvidenceList
          label="核對正文連結"
          items={data.evidence}
          truncated={data.evidenceTruncated}
          empty="這段期間沒有可列出的正文連結。"
          blogId={data.blogId}
          name={name}
        />
        <p className={`text-xs ${muted}`}>
          已分析 {countText(data.coverage?.observedPosts)} 篇；未知目標連結 {countText(data.coverage?.unresolvedLinks)}{' '}
          條。沒有資料不代表沒有交流。
          {data.profileTruncated ? ' 此處僅顯示前 1,000 條關係。' : ''}
        </p>
      </section>

      <section aria-labelledby="relations-non-body" className={block}>
        <h3 id="relations-non-body" className="font-semibold">
          非正文連結（Blogroll、側欄、留言）
        </h3>
        <p className={`text-xs ${muted}`}>
          另列，不計入上方篇數。本站另記 Blogroll {countText(nonBody?.blogroll)}、側欄 {countText(nonBody?.sidebar)}、留言{' '}
          {countText(nonBody?.comment)} 條。
        </p>
        <EvidenceList
          label="核對非正文連結"
          items={data.nonBodyEvidence}
          truncated={data.nonBodyEvidenceTruncated}
          empty="這段期間沒有可列出的非正文連結。"
          blogId={data.blogId}
          name={name}
        />
      </section>

      <section aria-labelledby="relations-tags" className={block}>
        <h3 id="relations-tags" className="font-semibold">
          共同標籤（不是引用）
        </h3>
        <SharedTagsBlock value={data.sharedTags} days={days} />
      </section>

      <section aria-labelledby="relations-text" className={block}>
        <h3 id="relations-text" className="font-semibold">
          文字相似（不是引用）
        </h3>
        <TextSimilarityBlock value={data.textSimilarity} />
      </section>

      {/* The method is the page's one footer block (FooterMethod's 引用與交流), not a second copy here. */}
      <p className={`text-xs ${muted}`}>
        <Link href="#method" className={link}>
          計算方式見頁尾的方法說明 ↓
        </Link>
      </p>
    </Section>
  );
}
