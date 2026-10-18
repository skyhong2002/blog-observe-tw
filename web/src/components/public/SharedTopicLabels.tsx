// A topic label's relations and visual from tag.observe.tw, read only from the topic payload's
// sharedLabels (lib/shared-labels.ts): nothing is fetched here. Off or absent renders nothing; each half
// says on its own whether it is not fetched yet, unavailable, or the upstream's own empty answer.
// Links go only to the checked tag/group pages there; an alias never means the site merged topics.

import { taipei } from '@/lib/api';
import {
  relationCountText,
  relationDepthText,
  relationGroups,
  relationSourceLabel,
  type SharedLabelRelations,
  type SharedLabelVisual,
  type SnapshotView,
  sharedLabelsView,
  sharedLabelUrl,
  visualImage,
} from '@/lib/shared-labels';

const muted = 'text-zinc-500 dark:text-zinc-400';
const link = 'text-brand-700 underline underline-offset-2 dark:text-brand-400';
const tagLink = 'font-medium text-brand-700 hover:underline dark:text-brand-400';
const NOT_GIVEN = '未提供';

function External({ href, className = link, children }: { href: string; className?: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

/** When this half was fetched; the upstream sends no payload version, so none is claimed. */
function Fetched({ at }: { at: string | null }) {
  return (
    <p className={`text-xs ${muted}`}>
      取得時間：{at ? taipei(at) : NOT_GIVEN} · 資料版本：上游{NOT_GIVEN}
    </p>
  );
}

function Relations({ view }: { view: SnapshotView<SharedLabelRelations> }) {
  if (view.state === 'missing') return <p className={`text-sm ${muted}`}>尚未取得標籤關係；這不代表沒有關係。</p>;
  if (view.state === 'unavailable') return <p className={`text-sm ${muted}`}>標籤關係暫時無法使用。</p>;
  const list = relationGroups(view.data);
  // A ready snapshot says for each kind what the upstream recorded. When only part of the list is shown (or the
  // upstream cut it), an empty kind may still have rows further on, so it is not called 尚未收錄 there.
  const partial = list.shown < list.total || list.truncated;
  return (
    <>
      {list.total ? <p className={`text-xs ${muted}`}>{relationCountText(list)}</p> : null}
      {list.groups.map((g) => (
        <div key={g.type} data-relation-group={g.type}>
          <h4 className="text-sm font-medium">{g.label}</h4>
          {g.rows.length ? (
            <ul className="mt-1 grid gap-x-4 sm:grid-cols-2">
              {g.rows.map((r) => (
                <li key={r.id} className="min-w-0 break-words py-1.5 text-sm">
                  <External href={sharedLabelUrl(r.target.href)} className={tagLink}>
                    {r.target.id.startsWith('group:') ? r.target.label : `#${r.target.label}`}
                  </External>
                  <span className={`ml-1 text-xs ${muted}`}>
                    {[relationDepthText(r), `${relationSourceLabel(r.source)}（${r.sourceDetail}）`, r.createdAt ? taipei(r.createdAt) : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={`mt-1 text-sm ${muted}`} data-relation-empty="">
              {partial ? '本頁顯示的關係中沒有這一類。' : '尚未收錄'}
            </p>
          )}
        </div>
      ))}
      <Fetched at={view.fetchedAt} />
    </>
  );
}

const kindLabels = { place: '地點', flag: '旗幟', logo: '標誌', emoji: '表情符號' } as const;

/** Picture credit with the upstream's own values; anything it left out says 未提供. */
function Credit({ source }: { source: NonNullable<SharedLabelVisual['visual']>['source'] }) {
  return (
    <p className={`text-xs ${muted}`}>
      圖片來源：{source ? <External href={source.pageUrl}>{new URL(source.pageUrl).hostname}</External> : NOT_GIVEN} · 作者：
      {source?.artist ?? NOT_GIVEN} · 授權：
      {source?.license ? source.licenseUrl ? <External href={source.licenseUrl}>{source.license}</External> : source.license : NOT_GIVEN}
    </p>
  );
}

function Visual({ view, tag }: { view: SnapshotView<SharedLabelVisual>; tag: string }) {
  if (view.state === 'missing') return <p className={`text-sm ${muted}`}>尚未取得代表圖示。</p>;
  if (view.state === 'unavailable') return <p className={`text-sm ${muted}`}>代表圖示暫時無法使用。</p>;
  const visual = view.data.visual;
  // Ready with no visual: the upstream's own answer. No picture and no placeholder; the fetch time stays.
  if (!visual)
    return (
      <>
        <p className={`text-sm ${muted}`} data-visual-empty="">
          尚未收錄代表圖示
        </p>
        <Fetched at={view.fetchedAt} />
      </>
    );
  const src = visualImage(visual);
  const name = visual.label ?? tag;
  return (
    <div className="flex items-start gap-3">
      {src ? (
        <img
          src={src}
          alt={`「${name}」代表圖示`}
          width={64}
          height={64}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-16 w-16 shrink-0 object-contain"
        />
      ) : visual.emoji ? (
        <span role="img" aria-label={`「${name}」代表符號`} className="text-3xl leading-none">
          {visual.emoji}
        </span>
      ) : null}
      <div className="min-w-0 space-y-1 break-words">
        <p className="text-sm">
          {kindLabels[visual.kind]}
          {visual.label ? `：${visual.label}` : ''}
          {visual.wikidataId ? <span className={`ml-1 text-xs ${muted}`}>Wikidata {visual.wikidataId}</span> : null}
        </p>
        {src ? <Credit source={visual.source} /> : visual.emoji ? null : <p className={`text-xs ${muted}`}>上游未提供圖片。</p>}
        <Fetched at={view.fetchedAt} />
      </div>
    </div>
  );
}

export default function SharedTopicLabels({ value, tag }: { value: unknown; tag: string }) {
  const view = sharedLabelsView(value, tag);
  if (!view) return null;
  return (
    <section aria-labelledby="shared-labels" className="space-y-3 rounded-xl border border-zinc-300 p-4 dark:border-zinc-800">
      <h2 id="shared-labels" className="font-semibold">
        共用標籤
      </h2>
      <p className={`text-xs ${muted}`}>
        來源：
        <External href={view.tagHref}>tag.observe.tw 的「{tag}」</External>（本站保存的快照）
      </p>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">代表圖示</h3>
        <Visual view={view.visual} tag={tag} />
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">標籤關係</h3>
        <Relations view={view.relations} />
      </div>
    </section>
  );
}
