// Card/detail markup adapted from upstream MediaTrafficProfile (afe0a65).
import Link from 'next/link';
import { gateway, taipei } from '@/lib/api';
import BlogIcon from './BlogIcon';

type TrafficBlog = {
  slug: string;
  name: string;
  domain: string;
  status: 'ready' | 'pending' | 'blocked' | 'no-data' | 'unavailable';
  fetchedAt: string | null;
  traffic: {
    monthly: Array<{ month: string; visits: number }>;
    globalRank: number | null;
    countryRank: { code: string; rank: number } | null;
    category: string | null;
    topCountries: Array<{ code: string; share: number }>;
  } | null;
};
type TrafficResponse = { source: 'similarweb-extension'; scope: 'domain'; limitations: string; blogs: TrafficBlog[] };
const statusLabel = {
  ready: '已有估計資料',
  pending: '等待資料更新',
  blocked: '來源暫緩提供資料',
  'no-data': '來源未提供估計',
  unavailable: '資料暫時無法取得',
};
const monthLabel = (month: string) => `${month.slice(0, 4)} 年 ${Number(month.slice(4, 6))} 月`;
function Card({ blog }: { blog: TrafficBlog }) {
  const latest = blog.traffic?.monthly.toSorted((a, b) => b.month.localeCompare(a.month))[0];
  return (
    <section aria-label={`${blog.name}網站流量來源`} className="rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800">
      <h2 className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm font-semibold">
        <Link href={`/blogs/${blog.slug}/`} className="inline-flex items-center gap-1.5 hover:text-brand-700 dark:hover:text-brand-400">
          <BlogIcon media={blog.slug} title={blog.name} />
          {blog.name} · 網站流量
        </Link>
        <span className="text-[11px] font-normal text-zinc-500">Similarweb{latest ? ` · ${monthLabel(latest.month)}` : ''}</span>
      </h2>
      <p className="mb-3 break-all leading-5 text-zinc-500 dark:text-zinc-400">
        網域範圍：{blog.domain} · {statusLabel[blog.status]}
      </p>
      {blog.status !== 'ready' && (
        <p role="status" className="mb-3 leading-5 text-zinc-600 dark:text-zinc-400">
          {blog.traffic
            ? '以下保留上次取得的估計，並非本次更新結果。'
            : blog.status === 'no-data'
              ? '目前沒有可顯示的流量估計，不代表沒有讀者。'
              : '有資料後才會顯示估計值，不以零補值。'}
        </p>
      )}
      {latest && (
        <p className="mb-3 leading-5">
          每月約 <span className="font-semibold tabular-nums">{latest.visits.toLocaleString('zh-TW')}</span> 次造訪
        </p>
      )}
      {!!blog.traffic?.monthly.length && (
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-y-1.5 leading-5">
          {blog.traffic.monthly
            .toSorted((a, b) => b.month.localeCompare(a.month))
            .slice(0, 12)
            .map((point) => (
              <div className="contents" key={point.month}>
                <dt className="text-zinc-500 dark:text-zinc-400">{monthLabel(point.month)}</dt>
                <dd className="tabular-nums">{point.visits.toLocaleString('zh-TW')} 次造訪</dd>
              </div>
            ))}
        </dl>
      )}
      {!!blog.traffic?.topCountries.length && (
        <>
          <h3 className="mt-3 mb-1.5 text-zinc-500 dark:text-zinc-400">來源國家</h3>
          <ul className="space-y-1">
            {blog.traffic.topCountries.map((country) => (
              <li key={country.code} className="grid grid-cols-[6.5rem_minmax(0,1fr)_3rem] items-center gap-2">
                <span>{country.code === 'TW' ? '台灣' : country.code}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true">
                  <span className="block h-full rounded-full bg-brand-600 dark:bg-brand-400" style={{ width: `${country.share * 100}%` }} />
                </span>
                <span className="text-right tabular-nums">{(country.share * 100).toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {blog.traffic && (blog.traffic.globalRank || blog.traffic.countryRank) && (
        <dl className="mt-3 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-y-1.5 border-t border-zinc-200 pt-3 leading-5 dark:border-zinc-800">
          {blog.traffic.globalRank && (
            <>
              <dt className="text-zinc-500 dark:text-zinc-400">全球排名</dt>
              <dd className="tabular-nums">第 {blog.traffic.globalRank.toLocaleString('zh-TW')} 名</dd>
            </>
          )}
          {blog.traffic.countryRank && (
            <>
              <dt className="text-zinc-500 dark:text-zinc-400">
                {blog.traffic.countryRank.code === 'TW' ? '台灣' : blog.traffic.countryRank.code}排名
              </dt>
              <dd className="tabular-nums">第 {blog.traffic.countryRank.rank.toLocaleString('zh-TW')} 名</dd>
            </>
          )}
        </dl>
      )}
      <p className="mt-3 text-[11px] leading-4 text-zinc-500">整個網域的估算值，包含首頁與舊文，非不重複讀者或精確 page views。</p>
      <p className="mt-2 text-[11px] leading-4 text-zinc-500">
        來源：similarweb-extension · 取得時間：{blog.fetchedAt ? taipei(blog.fetchedAt) : '尚未取得'}
      </p>
    </section>
  );
}
export default async function SimilarwebTraffic({ slug, compact = false }: { slug?: string; compact?: boolean }) {
  const data = await gateway<TrafficResponse>(`/api/traffic${slug ? `?${new URLSearchParams({ blog: slug })}` : ''}`);
  if (!data)
    return (
      <p role="status" className="py-4 text-sm text-zinc-500">
        流量資料暫時無法取得，請稍後再試。
      </p>
    );
  if (!data.blogs.length)
    return compact ? null : (
      <p className="py-8 text-sm text-zinc-500">目前沒有可顯示流量的已核准部落格。共用平台的全站流量不會套用到個別作者。</p>
    );
  return (
    <div className={compact ? 'mt-6 space-y-3' : 'space-y-5'}>
      {!compact && (
        <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-400">{data.limitations} 共用平台全站流量與尚未核准的候選不列入。</p>
      )}
      <div className={compact ? 'space-y-3' : 'grid grid-cols-1 items-start gap-3 md:grid-cols-2'}>
        {data.blogs.map((blog) => (
          <Card key={blog.slug} blog={blog} />
        ))}
      </div>
    </div>
  );
}
