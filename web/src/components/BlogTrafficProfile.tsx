// Ported from tag.observe.tw components/MediaTrafficProfile.tsx (afe0a65); renamed for blogs.
// Traffic channels (direct/referral/search/social), engagement and Taiwan-share
// edits are omitted: the blog gateway does not provide them.

import Link from '@/components/NoPrefetchLink';
import TrafficSparkline from '@/components/TrafficSparkline';
import {
  categoryName,
  countryName,
  dateText,
  latestPoint,
  monthLabel,
  monthsEnding,
  percent,
  rankText,
  stateHint,
  stateOf,
  stateText,
  stateTone,
  type TrafficBlog,
  trafficNumber,
} from '@/lib/traffic';

function Bars({ rows }: { rows: Array<{ label: string; share: number; strong?: boolean }> }) {
  return (
    <ul className="space-y-1">
      {rows.map((row) => (
        <li key={row.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)_3rem] items-center gap-2">
          <span className={`truncate ${row.strong ? 'font-medium' : ''}`} title={row.label}>
            {row.label}
          </span>
          <span className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true">
            <span
              className="block h-full rounded-full bg-brand-600 dark:bg-brand-400"
              style={{ width: `${Math.max(2, row.share * 100)}%` }}
            />
          </span>
          <span className="text-right tabular-nums">{percent(row.share)}</span>
        </li>
      ))}
    </ul>
  );
}

/** One blog's newest Similarweb month: visits, recent trend, source countries and ranks. Rendered in /blogs/[slug]/'s sidebar. */
export default function BlogTrafficProfile({ blog }: { blog: TrafficBlog }) {
  const state = stateOf(blog);
  const profile = blog.traffic;
  const latest = latestPoint(blog);
  const months = latest ? monthsEnding(latest.month, 6) : [];
  const ranks = [
    profile?.countryRank && [
      `${countryName(profile.countryRank.code)}排名`,
      rankText(profile.countryRank.rank),
      `Similarweb：在${countryName(profile.countryRank.code)}所有網站中的名次（主要讀者所在地）`,
    ],
    profile?.globalRank && ['全球排名', rankText(profile.globalRank), 'Similarweb：在全世界所有網站中的名次'],
    profile?.category && ['網站類別', categoryName(profile.category), 'Similarweb 網站類別'],
  ].filter(Boolean) as Array<[string, string, string]>;
  const fetched = dateText(blog.fetchedAt);
  // No estimate yet (or ever): the section is left out; how Similarweb is read is in the footer's 部落格頁 block.
  if (!latest && !profile?.topCountries.length && !ranks.length) return null;
  return (
    <section id="traffic" aria-label="網站流量" className="rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800">
      <h2 className="mb-3 flex items-baseline justify-between gap-2 text-sm font-semibold">
        網站流量
        <span className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
          Similarweb{latest ? ` · ${monthLabel(latest.month)}` : ''}
        </span>
      </h2>
      <p className="mb-3 leading-5 text-zinc-500 dark:text-zinc-400">
        <span className="break-all">網域 {blog.domain}</span> ·{' '}
        <span className={stateTone[state]} title={stateHint[state]}>
          {stateText[state]}
        </span>
      </p>
      {latest && (
        <div className="mb-3 flex items-end justify-between gap-3">
          <p className="leading-5">
            每月約 <span className="text-base font-semibold tabular-nums">{trafficNumber(latest.visits)}</span> 次造訪
          </p>
          {months.length > 1 && <TrafficSparkline traffic={profile?.monthly ?? []} months={months} label="估算月造訪" ends />}
        </div>
      )}
      {!!profile?.topCountries.length && (
        <>
          <h3 className="mb-1.5 text-zinc-500 dark:text-zinc-400">來源國家（前五）</h3>
          <Bars rows={profile.topCountries.map((c) => ({ label: countryName(c.code), share: c.share, strong: c.code === 'TW' }))} />
        </>
      )}
      {ranks.length > 0 && (
        <dl className="mt-3 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-y-1.5 border-t border-zinc-200 pt-3 leading-5 dark:border-zinc-800">
          {ranks.map(([term, value, hint]) => (
            <div key={term} className="contents">
              <dt className="text-zinc-500 dark:text-zinc-400">{term}</dt>
              <dd className="truncate tabular-nums" title={hint}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-3 flex flex-wrap justify-between gap-x-2 text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
        <span>{fetched ? `取得：${fetched}` : ''}</span>
        <Link href={`/traffic/?q=${encodeURIComponent(blog.name)}`} className="text-brand-700 hover:underline dark:text-brand-400">
          與其他部落格比較 →
        </Link>
      </p>
    </section>
  );
}
