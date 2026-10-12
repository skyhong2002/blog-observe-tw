import { gateway, taipei } from '@/lib/api';

type Inference = {
  label: string;
  profile: { bio: string; topics: string[] } | null;
  overridden: boolean;
  provenance: { coverage: string; modelAlias: string; updatedAt: string } | null;
  topics: Array<{ postId: number; title: string; topics: string[]; coverage: string; updatedAt: string; label: string }>;
};
export default async function BlogInference({ slug }: { slug: string }) {
  const data = await gateway<Inference>(`/api/blogs/${encodeURIComponent(slug)}/inference`);
  if (!data) return <p className="mt-8 text-sm text-zinc-500">AI 閱讀線索暫時無法讀取。</p>;
  if (!data.profile?.bio && !data.topics?.length) return null;
  return (
    <section className="mt-8 space-y-3 rounded-xl border border-zinc-300 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">閱讀線索</h2>
        <span className="rounded bg-zinc-200 px-2 py-1 text-xs dark:bg-zinc-800">{data.label}</span>
      </div>
      {data.profile?.bio ? <p className="text-sm leading-7">{data.profile.bio}</p> : null}
      {data.profile?.topics?.length ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">常見主題：{data.profile.topics.join('、')}</p>
      ) : null}
      {data.topics.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer">文章主題整理 · AI 推定</summary>
          <ul className="mt-3 space-y-3">
            {data.topics.map((t) => (
              <li key={t.postId}>
                <p>{t.title}</p>
                <p className="text-xs text-zinc-500">
                  {t.topics.join('、')} · {t.label}
                  {t.coverage === 'rss-summary' ? ' · 依 RSS 摘要' : ''}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="text-xs text-zinc-500">
        {data.overridden ? '此簡介已由人工覆寫。' : '依已收錄的網站資訊與文章整理，可能不完整，請以作者原文為準。'}
        {data.provenance?.updatedAt ? ` ${taipei(data.provenance.updatedAt)} 更新。` : ''}
      </p>
    </section>
  );
}
