import Link from 'next/link';
import { gateway } from '@/lib/api';
import type { Relations } from '@/lib/relations';
import RelationLists from './RelationLists';
export default async function BlogRelations({ slug }: { slug: string }) {
  const data = await gateway<Relations>(`/api/blogs/${encodeURIComponent(slug)}/relations?days=90`);
  return (
    <section className="mt-8 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">引用與交流</h2>
        <Link href="/relations/" className="text-sm text-brand-700 hover:underline dark:text-brand-400">
          全站關係圖 →
        </Link>
      </div>
      <p className="text-sm text-zinc-500">
        近 90 天正文提及。占比以提及方所有已辨識的部落格正文引用為分母，同篇對同站只計一次；不是造訪比例。
      </p>
      {data ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <RelationLists title="提到誰" edges={data.outgoing ?? []} nodes={data.nodes} />
            <RelationLists title="被誰提到" edges={data.incoming ?? []} nodes={data.nodes} incoming />
          </div>
          {data.evidence?.length ? (
            <details className="text-sm">
              <summary className="cursor-pointer">核對文章中的連結</summary>
              <ul className="mt-3 space-y-3">
                {data.evidence.map((e) => (
                  <li key={`${e.postUrl}:${e.targetUrl}:${e.anchor}`}>
                    <a href={e.postUrl} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline dark:text-brand-400">
                      {e.postTitle}
                    </a>
                    <span className="mx-2">→</span>
                    <a
                      href={e.targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-700 underline dark:text-brand-400"
                    >
                      {e.anchor || '原始連結'}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <p className="text-xs text-zinc-500">
            已分析 {data.coverage.observedPosts} 篇；未知目標連結 {data.coverage.unresolvedLinks} 條。沒有資料不代表沒有交流。
            {data.profileTruncated ? ' 此處僅顯示前 1,000 條關係。' : ''}
          </p>
        </>
      ) : (
        <p className="text-sm text-zinc-500">關係資料暫時無法讀取。</p>
      )}
    </section>
  );
}
