'use client';

// Cards, filters and table follow BlogCatalog (tag.observe.tw /media/ at afe0a65). One view for
// both the server-rendered first page (no query) and the browser's own query; see app/tech/page.tsx.
// How the numbers are made sits in this page's 資料來源與計算方式 (TechMethodNotes), closed until
// asked for, like the topic pages; the layout's footer leaves its copy out on /tech/ (FooterMethod).

import { useSearchParams } from 'next/navigation';
import BlogIcon from '@/components/BlogIcon';
import FooterMethod from '@/components/FooterMethod';
import MethodLink from '@/components/MethodLink';
import Link from '@/components/NoPrefetchLink';
import ReloadButton from '@/components/public/ReloadButton';
import TableScroller from '@/components/TableScroller';
import { taipei } from '@/lib/api';
import { blogLink } from '@/lib/page-links';
import { table } from '@/lib/table-styles';
import {
  canonicalBlogPath,
  categoryText,
  coverageKey,
  errorLabel,
  explicitVersions,
  hostOf,
  INFRA_CATEGORIES,
  isHistorical,
  isInfra,
  isTechBaseline,
  isTechStatus,
  LOW_DATA_BLOGS,
  observedBlogs,
  SOFTWARE_CATEGORIES,
  share,
  shownVersion,
  sourceTypeText,
  statusText,
  statusTone,
  TECH_STATUSES,
  type TechBlog,
  type TechCategory,
  type TechDetection,
  type TechStats,
  type TechTechnology,
  techApiPath,
  techHref,
  techQueryOf,
} from '@/lib/tech';
import { asIs, usePublicJson } from '@/lib/use-public-json';

type Status = 'ready' | 'pending' | 'error';
type Filters = { q: string; technology: string; status: string; cursor?: string };

const card = 'rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900';
const muted = 'text-zinc-600 dark:text-zinc-400';
const link = 'text-brand-700 hover:underline dark:text-brand-400';
// SiteFooter's methodHeading; not imported, since that module reads the catalog on the server.
const methodHeading = 'font-medium text-zinc-900 dark:text-zinc-100';
const n = (value: number) => value.toLocaleString('zh-TW');

function RankCard({
  category,
  technologies,
  scanned,
  filters,
}: {
  category: TechCategory;
  technologies: TechTechnology[];
  scanned: number;
  filters: Filters;
}) {
  return (
    <section className="rounded-xl border border-zinc-300 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-2 text-xs font-semibold text-zinc-600 dark:text-zinc-400">{categoryText[category]}</h3>
      <ol className="space-y-1.5">
        {[...technologies]
          .sort((a, b) => b.blogs - a.blogs || a.name.localeCompare(b.name))
          .map((tech) => {
            const current = tech.id === filters.technology;
            const versions = explicitVersions(tech);
            return (
              <li key={tech.id}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <Link
                    href={techHref({ q: filters.q, status: filters.status, technology: current ? undefined : tech.id })}
                    scroll={false}
                    aria-current={current ? 'true' : undefined}
                    className={`-mx-1 flex min-h-11 min-w-0 items-center rounded px-1 ${current ? 'bg-brand-50 font-semibold text-brand-800 dark:bg-brand-950 dark:text-brand-300' : link}`}
                    title={current ? `取消篩選 ${tech.name}` : `看保留證據中有 ${tech.name} 的部落格`}
                  >
                    <span className="truncate">{tech.name}</span>
                  </Link>
                  <span className="whitespace-nowrap text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                    {n(tech.blogs)} 站<span className={`ml-1.5 ${muted}`}>{share(tech.blogs, scanned)}</span>
                  </span>
                </div>
                {versions.length > 0 && (
                  <p
                    className={`mt-0.5 truncate text-[11px] tabular-nums ${muted}`}
                    title={`明確版本 ${versions.map((v) => `${v.version}（${v.blogs}）`).join('、')}`}
                  >
                    明確版本 {versions.map((v) => `${v.version}（${v.blogs}）`).join('、')}
                  </p>
                )}
              </li>
            );
          })}
      </ol>
    </section>
  );
}

const detectionText = (d: TechDetection) => {
  const version = shownVersion(d);
  return `${d.name}${version ? ` ${version}` : ''}${isInfra(d.category) ? '（低信心）' : ''}`;
};

/** One line: site software, then low-confidence hosting / CDN; the full list is the title. */
function TechNames({ blog, filters }: { blog: TechBlog; filters: Filters }) {
  if (!blog.detections.length) return <span className={muted}>—</span>;
  const software = blog.detections.filter((d) => !isInfra(d.category));
  const infra = blog.detections.filter((d) => isInfra(d.category));
  const historical = isHistorical(blog);
  const title = `${historical ? '上次成功：' : ''}${[...software, ...infra].map(detectionText).join('、')}`;
  const names = (list: TechDetection[], className: string) =>
    list.map((d, position) => {
      const version = shownVersion(d);
      return (
        <span key={d.id}>
          {position > 0 && '、'}
          <Link href={techHref({ q: filters.q, technology: d.id })} scroll={false} className={className}>
            {d.name}
          </Link>
          {version && <span className={`ml-0.5 text-xs tabular-nums ${muted}`}>{version}</span>}
        </span>
      );
    });
  return (
    <span className="block max-w-80 truncate" title={title}>
      {historical && <span className="mr-1 text-[11px] text-amber-700 dark:text-amber-400">上次成功：</span>}
      {names(software, link)}
      {infra.length > 0 && (
        <>
          {software.length > 0 && <span className={`mx-1 ${muted}`}>·</span>}
          <span className={`mr-1 text-[11px] ${muted}`}>主機／CDN（低信心）</span>
          {names(infra, 'text-zinc-600 hover:underline dark:text-zinc-400')}
        </>
      )}
    </span>
  );
}

/** This page's notes inside 本頁的資料來源與計算方式: the method and this read's own counts. */
export function TechMethodNotes({ data }: { data: TechStats }) {
  const { coverage, method } = data;
  return (
    <>
      <h3 className={methodHeading}>技術觀測方式</h3>
      <p>
        只重用收錄部落格時已取得的公開 HTML、回應標頭、script 與 meta
        標記，不為了辨識技術對部落格增加任何請求；不公開原始回應內容，只列出規則 ID 與短證據片段。
      </p>
      <p>技術觀測是部分證據：只能說「看到某個線索」。沒看到不代表沒有使用，列出的也不是完整的技術清單。</p>
      <p>版本只取自明確的版本宣告（例如 generator 標記）且附有證據；沒有證據時顯示「未知」，不從檔名、網址參數或標頭推測。</p>
      <p>主機與 CDN 只來自回應標頭等基礎設施線索，信心低，只代表網站可能經由哪裡提供，不會當成 CMS 或框架。</p>
      <p>
        「未辨識」是已觀測但沒看到已知線索；「觀測失敗」「來源阻擋」是最近一次沒能觀測，不算未辨識；「未觀測」是還沒有紀錄。失敗或被阻擋時保留的結果是上次成功的歷史觀測，不代表目前仍確認。
      </p>
      <p>
        技術排行與技術篩選都依各部落格目前保留的觀測證據計算，包含最近一次觀測失敗或被阻擋、但仍保留的上次成功結果；這些部落格的「狀態」顯示最近一次嘗試的結果，所以排行的站數不一定等於「有辨識」的數量。
      </p>
      <p>
        「成功觀測」是最後一次取得可用回應的時間；「最後嘗試」是最近一次嘗試的時間，可能失敗。只檢查文章內文片段的觀測屬部分覆蓋，不代表已掃描全站。
      </p>
      <p>技術排行依保留觀測證據中辨識到的部落格數排序，點選可列出這些部落格；列出不代表目前仍確認使用。</p>
      <h3 className={methodHeading}>本次統計範圍</h3>
      <p>
        公開部落格共 {n(coverage.totalBlogs)} 個；本次讀取 {n(coverage.scannedBlogs)} 個
        {coverage.truncated
          ? `（一次最多讀取的上限，其餘 ${n(coverage.totalBlogs - coverage.scannedBlogs)} 個不計入任何狀態、排行或篩選）`
          : '（已全部讀取）'}
        。各狀態的數量與所有百分比的分母都是本次讀取的 {n(coverage.scannedBlogs)} 個；統計於 {taipei(data.generatedAt)}。
      </p>
      {coverage.totalBlogs === 0 ? (
        <p>目前沒有可統計的公開部落格。</p>
      ) : observedBlogs(coverage) < LOW_DATA_BLOGS ? (
        <p>目前只有 {n(observedBlogs(coverage))} 個部落格有觀測紀錄，排行與百分比的代表性有限。</p>
      ) : null}
      {method.description && <p>{method.description}</p>}
    </>
  );
}

/**
 * `data` supplies the rows when `status` is ready. Otherwise only its
 * filter-independent parts (coverage, ranking, time) from this request's own
 * first page are shown beside the asked `filters`; no other query's rows.
 */
export default function TechStatsView({
  data,
  filters,
  status,
  ignored = false,
}: {
  data: TechStats;
  filters: Filters;
  status: Status;
  ignored?: boolean;
}) {
  const { coverage, technologies } = data;
  const ready = status === 'ready';
  const scanned = coverage.scannedBlogs;
  const activeTech = technologies.find((t) => t.id === filters.technology);
  const activeStatus = isTechStatus(filters.status) ? filters.status : null;
  const byCategory = (category: TechCategory) => technologies.filter((t) => t.category === category);
  const software = SOFTWARE_CATEGORIES.filter((c) => byCategory(c).length);
  const infra = INFRA_CATEGORIES.filter((c) => byCategory(c).length);
  const chip = 'inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-full bg-brand-700 px-3 text-white hover:bg-brand-800';
  return (
    <div className="space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">部落格使用的技術</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          統計於 {taipei(data.generatedAt)} · <MethodLink />
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <div className={card}>
          <div className="text-xs text-zinc-600 dark:text-zinc-400">公開部落格</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{n(coverage.totalBlogs)}</div>
          <div className={`text-[11px] ${muted}`}>收錄總數</div>
        </div>
        <div className={card}>
          <div className="text-xs text-zinc-600 dark:text-zinc-400">本次讀取</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{n(scanned)}</div>
          <div className={`text-[11px] ${coverage.truncated ? 'text-amber-700 dark:text-amber-400' : muted}`}>
            {coverage.truncated ? '部分截斷' : '已全部讀取'}
          </div>
        </div>
        {TECH_STATUSES.map((state) => {
          const value = coverage[coverageKey[state]];
          const active = activeStatus === state;
          return (
            <Link
              key={state}
              href={techHref({ q: filters.q, technology: filters.technology, status: active ? undefined : state })}
              scroll={false}
              aria-current={active ? 'true' : undefined}
              title={active ? `取消篩選「${statusText[state]}」` : `只看「${statusText[state]}」的部落格`}
              className={`block rounded-xl border p-4 transition-colors ${
                active
                  ? 'border-brand-600 bg-brand-50 dark:border-brand-400 dark:bg-brand-950'
                  : 'border-zinc-300 bg-white hover:border-brand-600 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-brand-400'
              }`}
            >
              <div className={`text-xs ${statusTone[state]}`}>{statusText[state]}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{n(value)}</div>
              <div className={`text-[11px] tabular-nums ${muted}`}>佔已讀取 {share(value, scanned)}</div>
            </Link>
          );
        })}
      </div>
      <section aria-labelledby="tech-ranking" className="space-y-3">
        <h2 id="tech-ranking" className="text-sm font-semibold">
          技術排行
        </h2>
        {software.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {software.map((category) => (
              <RankCard key={category} category={category} technologies={byCategory(category)} scanned={scanned} filters={filters} />
            ))}
          </div>
        ) : (
          <p className={`rounded-xl border border-zinc-300 p-4 text-sm dark:border-zinc-800 ${muted}`}>
            目前沒有辨識到網站軟體。可能是尚未觀測或線索不足，不代表部落格沒有使用。
          </p>
        )}
        {infra.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">主機與 CDN（低信心）</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {infra.map((category) => (
                <RankCard key={category} category={category} technologies={byCategory(category)} scanned={scanned} filters={filters} />
              ))}
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="tech-blogs" className="space-y-3">
        <h2 id="tech-blogs" className="text-sm font-semibold">
          {filters.technology ? `保留證據中有「${activeTech?.name ?? filters.technology}」的部落格` : '部落格清單'}
        </h2>
        <form action="/tech/" className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <label htmlFor="tech-query" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              搜尋部落格名稱或網址
            </label>
            <input
              key={filters.q}
              id="tech-query"
              name="q"
              type="search"
              defaultValue={filters.q}
              maxLength={100}
              placeholder="搜尋名稱或網址"
              className="min-h-11 w-48 min-w-0 rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            {filters.technology && <input type="hidden" name="technology" value={filters.technology} />}
            {activeStatus && <input type="hidden" name="status" value={activeStatus} />}
            <button type="submit" className="min-h-11 rounded-lg bg-brand-700 px-4 text-sm text-white hover:bg-brand-800">
              搜尋
            </button>
            {filters.technology && (
              <Link href={techHref({ q: filters.q, status: activeStatus ?? undefined })} scroll={false} className={`${chip} text-xs`}>
                技術：{activeTech?.name ?? filters.technology}
                <span aria-hidden="true">✕</span>
                <span className="sr-only">（取消技術篩選）</span>
              </Link>
            )}
            {activeStatus && (
              <Link href={techHref({ q: filters.q, technology: filters.technology })} scroll={false} className={`${chip} text-xs`}>
                狀態：{statusText[activeStatus]}
                <span aria-hidden="true">✕</span>
                <span className="sr-only">（取消狀態篩選）</span>
              </Link>
            )}
          </div>
          <span role="status" className={`text-xs ${muted}`}>
            {ready
              ? `共 ${n(data.pagination.total)} 個部落格符合`
              : status === 'pending'
                ? '正在載入符合條件的部落格…'
                : '技術統計暫時無法載入'}
          </span>
        </form>
        {ignored && <p className={`text-xs ${muted}`}>網址中有無法辨識的篩選條件，已略過。</p>}

        {ready ? (
          <>
            <TableScroller card label="部落格技術觀測表格，可左右捲動">
              <table className="w-full min-w-[56rem] whitespace-nowrap text-sm">
                <thead className="bg-zinc-50 text-left text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                  <tr>
                    <th scope="col" className={table.leadHead}>
                      部落格
                    </th>
                    <th scope="col" className={table.cell}>
                      狀態
                    </th>
                    <th scope="col" className={`${table.cell} text-right`}>
                      技術數
                    </th>
                    <th scope="col" className={table.cell}>
                      辨識到的技術
                    </th>
                    <th scope="col" className={table.cell}>
                      觀測範圍
                    </th>
                    <th scope="col" className={table.cell}>
                      成功觀測
                    </th>
                    <th scope="col" className={table.cell}>
                      最後嘗試
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {data.items.map((blog) => {
                    const page = canonicalBlogPath(blog.url);
                    const failed = blog.status === 'failed' || blog.status === 'blocked';
                    const state = failed ? `${statusText[blog.status]} · ${errorLabel(blog.errorCode)}` : statusText[blog.status];
                    const scope = blog.coverage
                      ? `${sourceTypeText[blog.coverage.sourceType]}${blog.coverage.sourceType === 'body-fragment' ? '（部分）' : ''}${blog.coverage.htmlTruncated ? '（只看前段）' : ''}`
                      : '—';
                    const name = (
                      <>
                        <BlogIcon media={blog.slug} iconUrl={blog.iconUrl} title={blog.name} />
                        <span className={`${table.leadText} sm:max-w-60`} title={blog.name}>
                          {blog.name}
                        </span>
                      </>
                    );
                    return (
                      <tr key={blog.id} className={table.row}>
                        <td className={table.lead}>
                          {/* One line per row: name keeps its width, the URL takes what is left and is the first to truncate. */}
                          <div className={`${table.leadBox} flex items-baseline gap-2`}>
                            {page ? (
                              <Link
                                {...blogLink(blog.slug, page)}
                                className="flex min-w-0 items-center gap-1.5 self-center font-medium text-brand-700 hover:underline dark:text-brand-400"
                              >
                                {name}
                              </Link>
                            ) : (
                              <span className="flex min-w-0 items-center gap-1.5 self-center font-medium">{name}</span>
                            )}
                            {blog.sourceUrl && (
                              <span
                                className={`${table.leadExtra} ${table.leadText} shrink-[999] text-xs text-zinc-600 sm:max-w-40 dark:text-zinc-400`}
                                title={blog.sourceUrl}
                              >
                                {hostOf(blog.sourceUrl)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={`${table.cell} text-xs`}>
                          <span className={`block max-w-48 truncate ${statusTone[blog.status]}`} title={state}>
                            {state}
                          </span>
                        </td>
                        <td className={table.num}>{blog.detections.length ? blog.detections.length : <span className={muted}>—</span>}</td>
                        <td className={table.cell}>
                          <TechNames blog={blog} filters={filters} />
                        </td>
                        <td className={`${table.cell} text-xs ${muted}`}>
                          <span className="block max-w-40 truncate" title={scope}>
                            {scope}
                          </span>
                        </td>
                        <td className={`${table.cell} text-xs tabular-nums ${muted}`}>
                          {blog.observedAt ? taipei(blog.observedAt) : '尚無成功觀測'}
                        </td>
                        <td className={`${table.cell} text-xs tabular-nums ${muted}`}>
                          {blog.lastAttemptAt ? taipei(blog.lastAttemptAt) : '尚未嘗試'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroller>
            {!data.items.length && (
              <p className={`py-8 ${muted}`}>
                沒有符合條件的部落格。
                {filters.technology &&
                  ' 技術篩選只列出目前保留的觀測證據中有該技術的部落格（包含最近一次觀測失敗或被阻擋、但仍保留上次成功結果的部落格）；未辨識、未觀測或沒有保留結果的部落格不會出現在這裡。'}
              </p>
            )}
            <nav aria-label="部落格分頁" className="flex justify-between gap-2 text-sm">
              {filters.cursor ? (
                <Link
                  className="py-2 text-brand-700 dark:text-brand-400"
                  href={techHref({ q: filters.q, technology: filters.technology, status: activeStatus ?? undefined })}
                >
                  ← 回到第一頁
                </Link>
              ) : (
                <span />
              )}
              <span className={`py-2 tabular-nums ${muted}`}>
                本頁 {data.items.length} 筆 · 共 {n(data.pagination.total)} 筆
              </span>
              {data.pagination.nextCursor ? (
                <Link
                  className="py-2 text-brand-700 dark:text-brand-400"
                  href={techHref({
                    q: filters.q,
                    technology: filters.technology,
                    status: activeStatus ?? undefined,
                    cursor: data.pagination.nextCursor,
                  })}
                >
                  下一頁 →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          </>
        ) : status === 'pending' ? (
          <p
            aria-busy="true"
            className="rounded-xl border border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400"
          >
            正在載入符合條件的部落格…
          </p>
        ) : (
          <div role="alert" className="rounded-xl border border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
            <p>技術統計暫時無法載入，請稍後再試。這不表示沒有符合條件的部落格，也不代表數量為 0。</p>
            <ReloadButton />
          </div>
        )}
      </section>
      <FooterMethod page notes={<TechMethodNotes data={data} />} />
    </div>
  );
}

/**
 * The site has /tech/ on but the gateway answered 404 for /api/tech (its own
 * switch is off): said plainly, with no counts, no table and no guess.
 */
export function TechUnavailable() {
  return (
    <div className="space-y-5 pb-8">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">部落格使用的技術</h1>
      <p
        role="alert"
        className="rounded-xl border border-zinc-300 p-6 text-sm leading-6 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400"
      >
        技術觀測資料目前沒有開放讀取，所以這裡沒有任何統計。這不是觀測結果，也不代表部落格沒有使用任何技術。
      </p>
      <FooterMethod page />
    </div>
  );
}

// public-contracts.ts has checked the coverage, ranking, rows, pagination and filters the view reads.
const parseTech = asIs<TechStats>;

/** Reads the URL's query (inside the page's Suspense boundary) and answers it from /api/tech. */
export function TechStatsFromUrl({ baseline }: { baseline: TechStats }) {
  const { query, ignored } = techQueryOf(useSearchParams());
  const load = usePublicJson(isTechBaseline(query) ? null : techApiPath(query), parseTech);
  if (!load) return <TechStatsView data={baseline} filters={baseline.filters} status="ready" ignored={ignored} />;
  if (load.status === 'ready')
    return <TechStatsView data={load.data} filters={{ ...load.data.filters, cursor: query.cursor }} status="ready" ignored={ignored} />;
  const asked = { q: query.q ?? '', technology: query.technology ?? '', status: query.status ?? '', cursor: query.cursor };
  return <TechStatsView data={baseline} filters={asked} status={load.status === 'pending' ? 'pending' : 'error'} ignored={ignored} />;
}
