// Sidebar section in the SourceProfile 部落格資料 style (tag /media/[media]/ sidebar, afe0a65).
import { taipei } from '@/lib/api';
import {
  completenessLabel,
  contentStatusText,
  contentStatusTone,
  normalizeContent,
  platformLabel,
  sourceText,
} from '@/lib/content-sources';
import { publicJsonOrNull } from '@/lib/public-api';

const box = 'rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800';
// What the text is used for is in the footer's 部落格頁 block (FooterMethod.tsx), not repeated here.

/** The content route's own slug rule (app/src/content/routes.ts); it answers 400 to anything else. */
const contentSlug = /^[a-z0-9][a-z0-9-]{0,199}$/;

export default async function BlogContentSources({ slug }: { slug: string }) {
  // null: the gateway's real 404, or a slug the route never looks up. A wrong-shaped 200 throws in public-read.ts.
  const raw = contentSlug.test(slug) ? await publicJsonOrNull<unknown>(`/api/blogs/${encodeURIComponent(slug)}/content`) : null;
  const data = raw === null ? null : normalizeContent(raw);
  if (!data)
    return (
      <section id="content-source" className={box}>
        <h2 className="mb-2 text-sm font-semibold">內文來源</h2>
        <p role="status" className="leading-5 text-zinc-500 dark:text-zinc-400">
          暫時無法讀取。
        </p>
      </section>
    );
  const { blog, sources } = data;
  const platform = platformLabel(blog.platform);
  // Never tried and nothing recorded: the section is left out.
  if (!blog.status && !blog.lastMethod && !blog.lastAttemptAt && !sources.length) return null;
  const row = (term: string, value: React.ReactNode, className = '') =>
    value ? (
      <>
        <dt className="text-zinc-500 dark:text-zinc-400">{term}</dt>
        <dd className={className}>{value}</dd>
      </>
    ) : null;
  return (
    <section id="content-source" className={box}>
      <h2 className="mb-3 text-sm font-semibold">內文來源</h2>
      <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-y-2.5 leading-5">
        {row(
          '狀態',
          blog.status && (
            <>
              <span className={contentStatusTone[blog.status]}>{contentStatusText[blog.status]}</span>
              {blog.reason && <span className="ml-1.5 text-zinc-500 dark:text-zinc-400">· {blog.reason}</span>}
            </>
          ),
        )}
        {row('取得方式', blog.lastMethod && sourceText[blog.lastMethod])}
        {row('平台', platform)}
        {row('最近成功', blog.lastSuccessAt && taipei(blog.lastSuccessAt), 'tabular-nums')}
        {/* An attempt is shown only when it did not succeed (a later failure, or never a success). */}
        {row('最近嘗試', blog.lastAttemptAt !== blog.lastSuccessAt && blog.lastAttemptAt && taipei(blog.lastAttemptAt), 'tabular-nums')}
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
                      {source.count === null ? '' : `${source.count.toLocaleString('zh-TW')} 篇`}
                    </span>
                  </li>
                );
              })}
          </ul>
        </>
      )}
    </section>
  );
}
