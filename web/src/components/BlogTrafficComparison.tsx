'use client';

// Table, controls and URL state ported from tag.observe.tw components/TrafficComparison.tsx
// and the state column of TrafficCollectionTable.tsx (afe0a65); renamed for blogs.
// Columns tag reads from other sources (crawl counts, Taiwan share edits, Radar,
// traffic channels) are left out until the blog gateway provides them.

import { useEffect, useMemo, useState } from 'react';
import BlogIcon from '@/components/BlogIcon';
import BlogTrafficTrend from '@/components/BlogTrafficTrend';
import { filterChipClass, filterRowClass } from '@/components/FilterChips';
import Link from '@/components/NoPrefetchLink';
import SortIndicator from '@/components/SortIndicator';
import TableScroller from '@/components/TableScroller';
import TrafficSparkline from '@/components/TrafficSparkline';
import { blogLink } from '@/lib/page-links';
import { table } from '@/lib/table-styles';
import {
  ascendingFirst,
  COMPARE_LIMIT,
  categoryName,
  chartable,
  countryName,
  dateText,
  defaultCompare,
  monthChange,
  monthLabel,
  monthsEnding,
  pageOf,
  percent,
  previousMonth,
  rankText,
  selectTraffic,
  shortMonth,
  stateHint,
  stateOf,
  stateText,
  stateTone,
  type TrafficBlog,
  type TrafficData,
  type TrafficSort,
  type TrafficState,
  trafficGrowth,
  trafficMonths,
  trafficNumber,
  trafficSorts,
  trafficStates,
  visitsAt,
} from '@/lib/traffic';

const control = 'min-h-9 rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700';
type View = 'value' | 'change';

function Change({ value }: { value: number | null }) {
  return (
    <span
      className={
        value === null
          ? 'text-zinc-500 dark:text-zinc-400'
          : value > 0
            ? 'text-brand-700 dark:text-brand-400'
            : value < 0
              ? 'text-red-700 dark:text-red-400'
              : ''
      }
    >
      {trafficGrowth(value)}
    </span>
  );
}

/** Calendar months from the first to the last, so a gap in the data stays a gap on the axis. */
function monthSpan(months: string[]): string[] {
  if (!months.length) return [];
  const out: string[] = [];
  const last = months.at(-1) as string;
  let month = last;
  while (month >= months[0] && out.length < 120) {
    out.unshift(month);
    month = previousMonth(month);
  }
  return out;
}

export default function BlogTrafficComparison({ data, initial }: { data: TrafficData; initial: Record<string, string | undefined> }) {
  const months = useMemo(() => trafficMonths(data.blogs), [data.blogs]);
  const latestMonth = months.at(-1) ?? '';
  const [month, setMonth] = useState(months.includes(initial.month ?? '') ? (initial.month as string) : latestMonth);
  const [query, setQuery] = useState((initial.q ?? '').slice(0, 100));
  const [state, setState] = useState<TrafficState | ''>(
    trafficStates.includes(initial.state as TrafficState) ? (initial.state as TrafficState) : '',
  );
  const [sort, setSort] = useState<TrafficSort>(
    trafficSorts.includes(initial.sort as TrafficSort) ? (initial.sort as TrafficSort) : 'visits',
  );
  const [ascending, setAscending] = useState(initial.dir ? initial.dir === 'asc' : ascendingFirst.has(sort));
  const [view, setView] = useState<View>(initial.view === 'change' ? 'change' : 'value');
  const [page, setPage] = useState(Math.max(1, Number.parseInt(initial.page ?? '1', 10) || 1));
  const bySlug = useMemo(() => new Map(data.blogs.map((blog) => [blog.slug, blog])), [data.blogs]);
  const [compare, setCompare] = useState<string[]>(() => {
    const asked = (initial.compare ?? '')
      .split(',')
      .filter((slug) => {
        const blog = bySlug.get(slug);
        return blog && chartable(blog);
      })
      .slice(0, COMPARE_LIMIT);
    return initial.compare !== undefined ? asked : defaultCompare(data.blogs);
  });

  const counts = useMemo(() => {
    const out = Object.fromEntries(trafficStates.map((s) => [s, 0])) as Record<TrafficState, number>;
    for (const blog of data.blogs) out[stateOf(blog)] += 1;
    return out;
  }, [data.blogs]);
  const effectiveSort: TrafficSort =
    sort === 'visits' && view === 'change' ? 'change' : sort === 'change' && view === 'value' ? 'visits' : sort;
  const selected = selectTraffic(data.blogs, { query, state, sort: effectiveSort, ascending, month });
  const shown = pageOf(selected, page);
  const recentMonths = monthsEnding(month, 3);
  const trend = recentMonths.length > 1 ? `走勢 ${Number(recentMonths[0].slice(4))}→${Number(recentMonths.at(-1)?.slice(4))}月` : '';

  const compared = useMemo(
    () => compare.map((slug) => bySlug.get(slug)).filter((blog): blog is TrafficBlog => Boolean(blog && chartable(blog))),
    [compare, bySlug],
  );
  const series = useMemo(() => compared.map((blog) => ({ name: blog.name, points: blog.traffic?.monthly ?? [] })), [compared]);
  const chartMonths = useMemo(() => monthSpan([...new Set(series.flatMap((s) => s.points.map((p) => p.month)))].sort()), [series]);
  const anyChartable = data.blogs.some(chartable);

  useEffect(() => {
    const params = new URLSearchParams();
    if (sort !== 'visits') params.set('sort', sort);
    if (ascending !== ascendingFirst.has(sort)) params.set('dir', ascending ? 'asc' : 'desc');
    if (month && month !== latestMonth) params.set('month', month);
    if (query) params.set('q', query);
    if (state) params.set('state', state);
    if (view === 'change') params.set('view', view);
    if (shown.page > 1) params.set('page', String(shown.page));
    if (compare.join(',') !== defaultCompare(data.blogs).join(',')) params.set('compare', compare.join(','));
    const search = params.toString();
    window.history.replaceState(window.history.state, '', `/traffic/${search ? `?${search}` : ''}`);
  }, [sort, ascending, month, latestMonth, query, state, view, shown.page, compare, data.blogs]);

  const chooseSort = (value: TrafficSort) => {
    setAscending(sort === value ? !ascending : ascendingFirst.has(value));
    setSort(value);
    setPage(1);
  };
  const toggleCompare = (slug: string) =>
    setCompare((current) => (current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug].slice(-COMPARE_LIMIT)));

  const columns: Array<{ key: TrafficSort | 'country-share' | 'compare'; label: string; sub: string; align: 'left' | 'right' }> = [
    { key: 'name', label: '部落格', sub: '部落格名稱 · 估算所用的網域', align: 'left' },
    {
      key: view === 'change' ? 'change' : 'visits',
      label: view === 'change' ? '月造訪變化' : '月造訪',
      sub: ['Similarweb 網域估算', month && shortMonth(month), view === 'change' ? '較上個月' : '月造訪次數', trend]
        .filter(Boolean)
        .join(' · '),
      align: 'right',
    },
    { key: 'global', label: '全球排名', sub: 'Similarweb · 在全世界所有網站中的名次 · 最新一期', align: 'right' },
    { key: 'country', label: '國家排名', sub: 'Similarweb · 在主要讀者所在國家的名次 · 最新一期', align: 'right' },
    { key: 'country-share', label: '主要來源國家', sub: '造訪占比最高的國家 · 最新一期', align: 'right' },
    { key: 'category', label: '類別', sub: 'Similarweb 網站類別', align: 'left' },
    { key: 'status', label: '資料狀態', sub: '抓取狀態 · 最近取得日期（台北時間）', align: 'left' },
    { key: 'compare', label: '比較', sub: `加入下方趨勢圖，最多 ${COMPARE_LIMIT} 個；需有兩個月以上的估計`, align: 'left' },
  ];
  const chip = (active: boolean) => filterChipClass(active);

  return (
    <section aria-label="部落格流量與排名清單" className="space-y-4">
      <section
        aria-labelledby="traffic-trend"
        className="rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 id="traffic-trend" className="mb-3 text-sm font-semibold">
          月造訪趨勢比較
        </h2>

        {compared.length > 0 && (
          <ul aria-label="正在比較的部落格" className="mb-3 flex flex-wrap gap-1.5">
            {compared.map((blog) => (
              <li key={blog.slug}>
                <button
                  type="button"
                  onClick={() => toggleCompare(blog.slug)}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-zinc-300 px-2.5 text-xs hover:border-brand-700 dark:border-zinc-700 dark:hover:border-brand-400"
                  aria-label={`從比較移除${blog.name}`}
                >
                  <BlogIcon media={blog.slug} title={blog.name} size={14} />
                  <span className="max-w-40 truncate" title={blog.name}>
                    {blog.name}
                  </span>
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {compared.length > 0 ? (
          <BlogTrafficTrend months={chartMonths} series={series} />
        ) : anyChartable ? (
          <p role="status" className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            尚未選擇要比較的部落格。
          </p>
        ) : null}
      </section>

      <fieldset className={`min-w-0 ${filterRowClass}`}>
        <legend className="sr-only">依資料狀態篩選</legend>
        <button
          type="button"
          aria-pressed={!state}
          className={chip(!state)}
          onClick={() => {
            setState('');
            setPage(1);
          }}
        >
          全部 {data.blogs.length}
        </button>
        {trafficStates
          .filter((s) => counts[s] > 0)
          .map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={state === s}
              title={stateHint[s]}
              className={chip(state === s)}
              onClick={() => {
                setState(state === s ? '' : s);
                setPage(1);
              }}
            >
              {stateText[s]} {counts[s]}
            </button>
          ))}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <input
          aria-label="搜尋部落格或網域"
          type="search"
          value={query}
          maxLength={100}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder="搜尋部落格或網域"
          className={`${control} w-44 max-w-full`}
        />
        <fieldset className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <legend className="sr-only">流量顯示方式</legend>
          <span className="flex gap-1.5 text-sm">
            {(
              [
                ['value', '數值'],
                ['change', '月變化'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                onClick={() => setView(value)}
                className={chip(view === value)}
              >
                {label}
              </button>
            ))}
          </span>
        </fieldset>
        <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          月份
          <select
            aria-label="Similarweb 月份"
            className={control}
            value={month}
            disabled={!months.length}
            onChange={(event) => {
              setMonth(event.target.value);
              setPage(1);
            }}
          >
            {!months.length && <option value="">尚無資料</option>}
            {months.toReversed().map((m) => (
              <option key={m} value={m}>
                {shortMonth(m)}
              </option>
            ))}
          </select>
        </label>
        <span role="status" className="text-xs text-zinc-500 dark:text-zinc-400">
          符合 {selected.length.toLocaleString('zh-TW')} 個
        </span>
      </div>

      <TableScroller card label="部落格流量表格，可左右捲動">
        <table className="w-full min-w-[52rem] whitespace-nowrap text-sm">
          <thead className="text-xs text-zinc-600 dark:text-zinc-400">
            <tr>
              {columns.map(({ key, label, sub, align }) => {
                const sortable = key !== 'country-share' && key !== 'compare';
                return (
                  <th
                    scope="col"
                    key={key}
                    aria-sort={sortable ? (effectiveSort === key ? (ascending ? 'ascending' : 'descending') : 'none') : undefined}
                    title={sub}
                    className={
                      key === 'name' ? `${table.leadHead} text-left` : `${table.cell} ${align === 'right' ? 'text-right' : 'text-left'}`
                    }
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => chooseSort(key as TrafficSort)}
                        className="min-h-8 whitespace-nowrap font-medium hover:text-brand-700 dark:hover:text-brand-400"
                      >
                        {label} <SortIndicator active={effectiveSort === key} descending={!ascending} />
                      </button>
                    ) : (
                      <span className="font-medium">{label}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.rows.map((blog) => {
              const rowState = stateOf(blog);
              const visits = visitsAt(blog, month);
              const profile = blog.traffic;
              const top = profile?.topCountries[0];
              const fetched = dateText(blog.fetchedAt);
              const canCompare = chartable(blog);
              const checked = compare.includes(blog.slug);
              const staleNote = rowState === 'stale' ? '（保留上次估計）' : '';
              return (
                <tr key={blog.slug} className={`${table.row} border-t border-zinc-200 dark:border-zinc-800`}>
                  <td className={`${table.lead} py-1.5`}>
                    <div className={table.leadBox}>
                      <Link
                        {...blogLink(blog.slug, blog.canonicalPath)}
                        className="flex min-w-0 items-center gap-2 hover:underline"
                        title={`${blog.name} · ${blog.domain}`}
                      >
                        <BlogIcon media={blog.slug} title={blog.name} size={20} />
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className={`${table.leadText} font-medium text-brand-700 dark:text-brand-400`}>{blog.name}</span>
                          <span className={`${table.leadExtra} ${table.leadText} shrink-[3] text-[11px] text-zinc-500 dark:text-zinc-400`}>
                            {blog.domain}
                          </span>
                        </span>
                      </Link>
                    </div>
                  </td>
                  <td
                    className={`${table.num} py-1.5`}
                    title={
                      visits === null
                        ? profile
                          ? `${monthLabel(month)}沒有這個網域的估計${staleNote}`
                          : stateHint[rowState]
                        : `${monthLabel(month)}約 ${trafficNumber(visits)} 次造訪${staleNote}`
                    }
                  >
                    <div className="flex items-center justify-end gap-3">
                      {profile && <TrafficSparkline traffic={profile.monthly} months={recentMonths} label={`${blog.name} 估算月造訪`} />}
                      <span className={`min-w-16 ${rowState === 'stale' ? 'text-zinc-500 dark:text-zinc-400' : ''}`}>
                        {view === 'change' ? <Change value={monthChange(blog, month)} /> : trafficNumber(visits)}
                      </span>
                    </div>
                  </td>
                  <td className={`${table.num} py-1.5`}>{rankText(profile?.globalRank)}</td>
                  <td
                    className={`${table.num} py-1.5`}
                    title={profile?.countryRank ? `在${countryName(profile.countryRank.code)}所有網站中的名次` : undefined}
                  >
                    {profile?.countryRank ? (
                      <>
                        <span className="mr-1 text-xs text-zinc-500 dark:text-zinc-400">{countryName(profile.countryRank.code)}</span>
                        {rankText(profile.countryRank.rank)}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td
                    className={`${table.num} py-1.5`}
                    title={
                      profile?.topCountries.length
                        ? profile.topCountries.map((c) => `${countryName(c.code)} ${percent(c.share)}`).join('、')
                        : undefined
                    }
                  >
                    {top ? (
                      <>
                        <span className="mr-1 text-xs text-zinc-500 dark:text-zinc-400">{countryName(top.code)}</span>
                        {percent(top.share)}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={`${table.cell} py-1.5`}>
                    {profile?.category ? (
                      <span className="block max-w-40 truncate" title={categoryName(profile.category)}>
                        {categoryName(profile.category)}
                      </span>
                    ) : (
                      <span className="text-zinc-500 dark:text-zinc-400">—</span>
                    )}
                  </td>
                  <td className={`${table.cell} py-1.5 text-xs`} title={stateHint[rowState]}>
                    <span className={stateTone[rowState]}>{stateText[rowState]}</span>
                    <span className="ml-1.5 tabular-nums text-zinc-500 dark:text-zinc-400">{fetched ?? '尚未取得'}</span>
                  </td>
                  <td className={`${table.cell} py-1.5`}>
                    <label className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                      <input
                        type="checkbox"
                        className="accent-brand-700"
                        checked={checked}
                        disabled={!canCompare}
                        onChange={() => toggleCompare(blog.slug)}
                        aria-label={
                          canCompare ? `${checked ? '取消比較' : '加入比較'}：${blog.name}` : `${blog.name}的估計不足兩個月，無法比較`
                        }
                      />
                      {canCompare ? (checked ? '比較中' : '比較') : '資料不足'}
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.rows.length && <p className="p-8 text-center text-sm text-zinc-500 dark:text-zinc-400">沒有符合條件的部落格。</p>}
      </TableScroller>
      {shown.pages > 1 && (
        <nav aria-label="流量表分頁" className="flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={shown.page <= 1}
            onClick={() => setPage(shown.page - 1)}
            className="min-h-9 py-2 text-brand-700 disabled:invisible dark:text-brand-400"
          >
            ← 上一頁
          </button>
          <span className="text-zinc-500 dark:text-zinc-400">
            第 {shown.page} / {shown.pages} 頁 · 每頁 50 個
          </span>
          <button
            type="button"
            disabled={shown.page >= shown.pages}
            onClick={() => setPage(shown.page + 1)}
            className="min-h-9 py-2 text-brand-700 disabled:invisible dark:text-brand-400"
          >
            下一頁 →
          </button>
        </nav>
      )}
    </section>
  );
}
