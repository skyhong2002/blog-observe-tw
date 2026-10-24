'use client';
// After tag.observe.tw 66d76690 (web/src/app/(site)/admin/media/Outlets.tsx): every blog in one sortable table,
// narrowed by filter rows that each count what the other filters leave.
import { useEffect, useState } from 'react';
import BlogIcon from '@/components/BlogIcon';
import Link from '@/components/NoPrefetchLink';
import SortIndicator from '@/components/SortIndicator';
import TableScroller from '@/components/TableScroller';
import { adminGet } from '@/lib/admin-client';
import { taipei } from '@/lib/api';
import { blogHref } from '@/lib/page-links';
import { type RobotsStatus, robotsLabel, robotsTone } from '@/lib/robots';
import { table } from '@/lib/table-styles';
import { BLOG_GENRES } from '../../../../app/src/blog-genre-vocabulary.ts';
import { button, input } from './shared';

// GET /api/admin/blogs (app/src/admin/blogs.ts).
type Crawl = 'ok' | 'quiet' | 'failing' | 'never' | 'off';
type Blog = {
  id: number;
  slug: string;
  name: string;
  url: string | null;
  category: string;
  status: string;
  statusLabel: string;
  crawl: Crawl;
  lastCrawlSuccessAt: string | null;
  lastPublishedAt: string | null;
  feeds: number;
  feedFailures: number;
  scraper: boolean;
  posts: number | null;
  posts7d: number | null;
  /** traffic.observe.tw's tags (app/src/admin/blogs.ts). */
  genres: Array<{ genre: string; label: string; source: 'editor' | 'ai' | 'admin' | 'community'; visible: boolean }>;
  manualTags: string[];
  robots: RobotsStatus | null;
  edits: number;
  lastEdit: { at: string; by: string | null; action: string } | null;
};
type Data = { partial: boolean; genresUnavailable?: boolean; blogs: Blog[] };
type SortKey = 'name' | 'crawl' | 'posts' | 'posts7d' | 'lastPublishedAt' | 'lastCrawlSuccessAt' | 'edits' | 'lastEdit';
type Filters = { crawl: string | null; label: string | null };

const CRAWL: Record<Crawl, { label: string; tone: string; title: string }> = {
  ok: { label: '正常', tone: 'text-zinc-700 dark:text-zinc-300', title: '抓取成功，90 天內有新文章' },
  quiet: { label: '久未更新', tone: 'text-amber-700 dark:text-amber-400', title: '抓取成功，但 90 天內沒有新文章' },
  failing: { label: '抓取失敗', tone: 'text-red-700 dark:text-red-400', title: '每個 RSS 都連續失敗 3 次以上，也沒有產生的爬蟲' },
  never: { label: '未抓到', tone: 'text-amber-700 dark:text-amber-400', title: '已收錄，但還沒成功抓過一次' },
  off: { label: '不收錄', tone: 'text-zinc-500', title: '待核對、已搬家或已移除，不再抓取' },
};
const crawlOrder: Crawl[] = ['failing', 'never', 'quiet', 'ok', 'off'];
const NO_LABEL = '__none';
/** The legacy seed `category` ("科技, 遊戲", "電商 (服裝)", 待分類) read as labels beside the tags: split on commas,
 * qualifiers in brackets dropped, 待分類 is no label. */
const categoryLabels = (category: string) =>
  category
    .split(/[,，、]/u)
    .map((part) => part.replace(/[(（].*?[)）]/gu, '').trim())
    .filter((part) => part && part !== '待分類');
const genreOrder = Object.values(BLOG_GENRES) as string[];
const fold = (text: string) => text.normalize('NFKC').toLowerCase();
const editLabel = (action: string) =>
  action.startsWith('genre.')
    ? '標籤'
    : action === 'tags.manual'
      ? '人工標籤'
      : action === 'ai.override'
        ? '簡介'
        : action.startsWith('blog.')
          ? '部落格資料'
          : action;
const chip = (active: boolean) =>
  `whitespace-nowrap rounded-full px-3 py-1 ${active ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300'}`;

function Chips({
  label,
  all,
  value,
  options,
  onChange,
}: {
  label: string;
  all: string;
  value: string | null;
  options: Array<{ value: string; label: string; count: number }>;
  onChange: (value: string | null) => void;
}) {
  return (
    <fieldset className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
      <legend className="sr-only">{label}</legend>
      <button type="button" aria-pressed={!value} className={chip(!value)} onClick={() => onChange(null)}>
        {all}
      </button>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          className={`${chip(value === o.value)} ${o.count || value === o.value ? '' : 'opacity-50'}`}
          onClick={() => onChange(value === o.value ? null : o.value)}
        >
          {o.label} {o.count}
        </button>
      ))}
    </fieldset>
  );
}

export default function Blogs() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Filters>({ crawl: null, label: null });
  const [sort, setSort] = useState<SortKey>('posts7d');
  const [descending, setDescending] = useState(true);
  const load = () => {
    setError('');
    adminGet<Data>('/api/admin/blogs')
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : '部落格列表無法載入。'));
  };
  useEffect(load, []);
  if (error)
    return (
      <div className="space-y-3">
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
        <button type="button" className={button} onClick={load}>
          重新載入
        </button>
      </div>
    );
  if (!data) return <p role="status">載入部落格中…</p>;

  const words = fold(q).split(/\s+/u).filter(Boolean);
  // One label set per blog: the tags readers see plus the legacy category, merged by name (旅遊, 財經, 遊戲 …).
  const labelsOf = (b: Blog) => [...new Set([...b.genres.filter((g) => g.visible).map((g) => g.label), ...categoryLabels(b.category)])];
  const matches = (b: Blog, skip?: keyof Filters) =>
    words.every((w) => fold(`${b.name} ${b.url ?? ''} ${b.slug} ${b.manualTags.join(' ')}`).includes(w)) &&
    (skip === 'crawl' || !filters.crawl || b.crawl === filters.crawl) &&
    (skip === 'label' || !filters.label || (filters.label === NO_LABEL ? !labelsOf(b).length : labelsOf(b).includes(filters.label)));
  const tally = (skip: keyof Filters, keys: (b: Blog) => string[]) => {
    const out = new Map<string, number>();
    for (const b of data.blogs) if (matches(b, skip)) for (const k of keys(b)) out.set(k, (out.get(k) ?? 0) + 1);
    return out;
  };
  const crawlCounts = tally('crawl', (b) => [b.crawl]);
  const labelCounts = tally('label', (b) => (labelsOf(b).length ? labelsOf(b) : [NO_LABEL]));
  // Starting tags in vocabulary order, then every other tag or legacy label, most used first.
  const extraLabels = [...new Set(data.blogs.flatMap(labelsOf))]
    .filter((label) => !genreOrder.includes(label))
    .sort((a, b) => (labelCounts.get(b) ?? 0) - (labelCounts.get(a) ?? 0) || a.localeCompare(b, 'zh-TW'));
  const rows = data.blogs.filter((b) => matches(b));
  const value = (b: Blog): number | string => {
    if (sort === 'name') return fold(b.name);
    if (sort === 'crawl') return crawlOrder.indexOf(b.crawl);
    if (sort === 'lastEdit') return b.lastEdit ? Date.parse(b.lastEdit.at) : 0;
    if (sort === 'lastPublishedAt' || sort === 'lastCrawlSuccessAt') return b[sort] ? Date.parse(b[sort] as string) : 0;
    return b[sort] ?? -1;
  };
  const sorted = [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const order = typeof x === 'string' ? x.localeCompare(y as string, 'zh-TW') : x - (y as number);
    return (descending ? -order : order) || a.name.localeCompare(b.name, 'zh-TW');
  });
  const sortBy = (key: SortKey) => {
    if (sort === key) setDescending((d) => !d);
    else {
      setSort(key);
      setDescending(!['name', 'crawl'].includes(key));
    }
  };
  const th = (col: SortKey, label: string, className: string = table.cell, title?: string) => (
    <th scope="col" className={className} aria-sort={sort === col ? (descending ? 'descending' : 'ascending') : 'none'} title={title}>
      <button
        type="button"
        onClick={() => sortBy(col)}
        className={`inline-flex items-center gap-0.5 whitespace-nowrap hover:text-brand-700 dark:hover:text-brand-400 ${sort === col ? 'text-zinc-900 dark:text-zinc-100' : ''}`}
      >
        {label}
        <SortIndicator active={sort === col} descending={descending} />
      </button>
    </th>
  );
  const count = (n: number | null) => (
    <td className={`${table.num} ${n ? '' : 'text-zinc-400 dark:text-zinc-600'}`}>{n == null ? '—' : n.toLocaleString('zh-TW')}</td>
  );
  const date = (iso: string | null) => <td className={`${table.cell} text-xs tabular-nums text-zinc-500`}>{iso ? taipei(iso) : '—'}</td>;
  const none = <span className="text-zinc-400 dark:text-zinc-600">—</span>;

  return (
    <section className="space-y-3">
      <div className="space-y-2">
        <Chips
          label="收錄狀態"
          all="全部收錄狀態"
          value={filters.crawl}
          onChange={(crawl) => setFilters((f) => ({ ...f, crawl }))}
          options={crawlOrder.map((c) => ({ value: c, label: CRAWL[c].label, count: crawlCounts.get(c) ?? 0 }))}
        />
        <Chips
          label="標籤"
          all="全部標籤"
          value={filters.label}
          onChange={(label) => setFilters((f) => ({ ...f, label }))}
          options={[...genreOrder, ...extraLabels, NO_LABEL].map((label) => ({
            value: label,
            label: label === NO_LABEL ? '無標籤' : label,
            count: labelCounts.get(label) ?? 0,
          }))}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="w-full max-w-sm text-sm">
          <span className="sr-only">搜尋部落格</span>
          <input
            className={`${input} !mt-0`}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="名稱、網址、代碼或標籤"
            maxLength={150}
          />
        </label>
        <span role="status" className="text-xs text-zinc-500">
          {rows.length === data.blogs.length ? `共 ${rows.length} 個部落格` : `符合 ${rows.length} 個，共 ${data.blogs.length} 個`}
          {data.partial ? ' · 文章數這次沒讀到，請稍後重新整理' : ''}
          {data.genresUnavailable ? ' · 標籤資料暫時無法使用' : ''}
        </span>
      </div>
      <TableScroller card label="部落格設定表格，可左右捲動">
        <table className="w-full min-w-[72rem] whitespace-nowrap text-sm">
          <thead className="bg-(--table-head-bg) text-left text-xs text-zinc-600 dark:text-zinc-400">
            <tr>
              {th('name', '部落格', table.leadHead)}
              <th
                scope="col"
                className={table.cell}
                title="讀者看到的標籤加上早期名單的舊標籤；✎ 是管理員設定的，刪除線是管理員隱藏的，虛線框來自早期名單"
              >
                標籤
              </th>
              <th scope="col" className={table.cell}>
                人工標籤
              </th>
              {th('crawl', '收錄狀態')}
              <th scope="col" className={table.cell}>
                robots.txt
              </th>
              {th('posts7d', '7 天文章', table.num)}
              {th('posts', '已收錄文章', table.num)}
              {th('lastPublishedAt', '最新文章')}
              {th('lastCrawlSuccessAt', '抓取成功')}
              {th('edits', '修改', table.num, '管理員改過這個部落格幾次（標籤、人工標籤、簡介等）')}
              {th('lastEdit', '最近修改')}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {sorted.map((b) => {
              const robots = robotsLabel(b.robots);
              const crawl = CRAWL[b.crawl];
              const shown = b.genres.filter((g) => g.visible || g.source === 'admin');
              // Legacy category labels a visible tag does not already show.
              const legacy = categoryLabels(b.category).filter((label) => !shown.some((g) => g.visible && g.label === label));
              return (
                <tr key={b.id} className={`${table.row} [&>td]:align-baseline`}>
                  <td className={table.lead}>
                    <div className={`${table.leadBox} flex items-baseline gap-2`}>
                      <Link
                        href={`/admin/overrides/?blog=${encodeURIComponent(b.slug)}`}
                        className="flex min-w-0 items-baseline gap-1.5 font-medium text-brand-700 hover:underline dark:text-brand-400"
                        title={`設定簡介與標籤 · #${b.id} · ${b.slug}`}
                      >
                        <span className="shrink-0 self-center">
                          <BlogIcon media={b.slug} title={b.name} />
                        </span>
                        <span className={`${table.leadText} sm:max-w-60`}>{b.name}</span>
                      </Link>
                      {b.status === 'verified' ? (
                        <Link
                          href={blogHref(b.slug)}
                          className={`${table.leadExtra} shrink-0 text-xs text-zinc-500 hover:underline dark:text-zinc-400`}
                          title={b.url ?? undefined}
                        >
                          公開頁
                        </Link>
                      ) : null}
                    </div>
                  </td>
                  <td className={`${table.cell} text-xs`}>
                    {shown.length || legacy.length ? (
                      <span className="flex gap-1">
                        {shown.map((g) => (
                          <span
                            key={g.genre}
                            className={`rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800 ${g.visible ? '' : 'text-zinc-400 line-through'}`}
                            title={
                              g.source === 'admin'
                                ? g.visible
                                  ? '管理員設定'
                                  : '管理員隱藏'
                                : g.source === 'ai'
                                  ? 'AI 初判'
                                  : g.source === 'editor'
                                    ? '編輯清單'
                                    : '讀者投票'
                            }
                          >
                            {g.label}
                            {g.source === 'admin' ? ' ✎' : ''}
                          </span>
                        ))}
                        {legacy.map((label) => (
                          <span
                            key={label}
                            className="rounded border border-dashed border-zinc-300 px-1.5 py-px dark:border-zinc-700"
                            title={`早期名單：${b.category}`}
                          >
                            {label}
                          </span>
                        ))}
                      </span>
                    ) : (
                      none
                    )}
                  </td>
                  <td className={`${table.cell} text-xs`}>
                    {b.manualTags.length ? (
                      <span className="block max-w-40 truncate" title={b.manualTags.join('、')}>
                        {b.manualTags.join('、')}
                      </span>
                    ) : (
                      none
                    )}
                  </td>
                  <td
                    className={`${table.cell} text-xs ${crawl.tone}`}
                    title={`${crawl.title} · ${b.statusLabel} · RSS ${b.feeds} 個${b.feedFailures ? `，連續失敗 ${b.feedFailures} 次` : ''}${b.scraper ? ' · 用產生的爬蟲抓取' : ''}`}
                  >
                    {crawl.label}
                    {b.scraper ? <span className="ml-1 text-zinc-500">· 爬蟲</span> : null}
                  </td>
                  <td className={`${table.cell} text-xs ${robotsTone[robots.tone]}`}>
                    <span className="block max-w-32 truncate" title={robots.title}>
                      {robots.label}
                    </span>
                  </td>
                  {count(b.posts7d)}
                  {count(b.posts)}
                  {date(b.lastPublishedAt)}
                  {date(b.lastCrawlSuccessAt)}
                  {count(b.edits)}
                  <td className={`${table.cell} text-xs tabular-nums text-zinc-500`}>
                    {b.lastEdit ? (
                      <span title={`${editLabel(b.lastEdit.action)}（${b.lastEdit.action}）`}>
                        {taipei(b.lastEdit.at)} · {b.lastEdit.by ?? '系統'}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroller>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        標籤是讀者看到的標籤（來自 traffic.observe.tw）加上早期名單的舊標籤（虛線框），同名的併成一個。收錄狀態：抓取失敗是每個 RSS
        都連續失敗 3 次以上、也沒有產生的爬蟲；久未更新是 90 天內沒有新文章；不收錄包括待核對、已搬家和已移除。 游標移到收錄狀態上可看 RSS
        數與失敗次數。點部落格名稱可設定簡介與人工標籤；標籤要到部落格頁的「編輯標籤」（traffic.observe.tw）調整。
      </p>
    </section>
  );
}
