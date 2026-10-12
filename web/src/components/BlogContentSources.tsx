// Sidebar section in the SourceProfile 部落格資料 style (tag /media/[media]/ sidebar, afe0a65).
import { gateway, taipei } from '@/lib/api';
import {
  completenessLabel,
  contentStatusText,
  contentStatusTone,
  normalizeContent,
  platformLabel,
  sourceText,
} from '@/lib/content-sources';

const box = 'rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800';
const note = '取得的內文只用於關鍵字、文章關係與站內搜尋；本站公開只顯示摘要與原文連結，全文請至原站閱讀。';
const recorded = (value: string | null) => (value ? taipei(value) : '尚未記錄');

export default async function BlogContentSources({ slug }: { slug: string }) {
  const data = normalizeContent(await gateway<unknown>(`/api/blogs/${encodeURIComponent(slug)}/content`));
  if (!data)
    return (
      <section id="content-source" className={box}>
        <h2 className="mb-2 text-sm font-semibold">內文來源</h2>
        <p role="status" className="leading-5 text-zinc-500 dark:text-zinc-400">
          內文來源狀態暫時無法讀取。
        </p>
        <p className="mt-3 border-t border-zinc-200 pt-3 leading-5 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">{note}</p>
      </section>
    );
  const { blog, sources } = data;
  const platform = platformLabel(blog.platform);
  return (
    <section id="content-source" className={box}>
      <h2 className="mb-3 flex items-baseline justify-between gap-2 text-sm font-semibold">
        內文來源
        {blog.status && (
          <span className={`text-[11px] font-normal ${contentStatusTone[blog.status]}`}>{contentStatusText[blog.status]}</span>
        )}
      </h2>
      <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-y-2.5 leading-5">
        <dt className="text-zinc-500 dark:text-zinc-400">狀態</dt>
        <dd>
          {blog.status ? contentStatusText[blog.status] : '尚未記錄'}
          {blog.reason && <span className="ml-1.5 text-zinc-500 dark:text-zinc-400">· {blog.reason}</span>}
        </dd>
        <dt className="text-zinc-500 dark:text-zinc-400">取得方式</dt>
        <dd>{blog.lastMethod ? sourceText[blog.lastMethod] : '尚未記錄'}</dd>
        {platform && (
          <>
            <dt className="text-zinc-500 dark:text-zinc-400">平台</dt>
            <dd>{platform}</dd>
          </>
        )}
        <dt className="text-zinc-500 dark:text-zinc-400">最近嘗試</dt>
        <dd className="tabular-nums">{recorded(blog.lastAttemptAt)}</dd>
        <dt className="text-zinc-500 dark:text-zinc-400">最近成功</dt>
        <dd className="tabular-nums">{recorded(blog.lastSuccessAt)}</dd>
      </dl>
      {sources.length > 0 && (
        <>
          <h3 className="mt-3 mb-1.5 border-t border-zinc-200 pt-3 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">各來源</h3>
          <ul className="space-y-1">
            {/* Sources carry no id; position within one response is their identity. */}
            {sources
              .map((source, position) => ({ source, id: `${source.source ?? 'other'}-${position}` }))
              .map(({ source, id }) => {
                const complete = completenessLabel(source.completeness);
                return (
                  <li key={id} className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-baseline gap-2">
                    <span className="truncate">{source.source ? sourceText[source.source] : '其他來源'}</span>
                    <span className={`truncate ${source.status ? contentStatusTone[source.status] : 'text-zinc-500 dark:text-zinc-400'}`}>
                      {source.status ? contentStatusText[source.status] : '狀態未記錄'}
                      {complete && <span className="text-zinc-500 dark:text-zinc-400"> · {complete}</span>}
                    </span>
                    <span className="text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                      {source.count === null ? '未記錄' : `${source.count.toLocaleString('zh-TW')} 篇`}
                    </span>
                  </li>
                );
              })}
          </ul>
        </>
      )}
      <p className="mt-3 border-t border-zinc-200 pt-3 leading-5 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">{note}</p>
    </section>
  );
}
