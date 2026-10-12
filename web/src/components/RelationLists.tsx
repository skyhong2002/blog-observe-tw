import Link from 'next/link';
import { taipei } from '@/lib/api';
import { type RelationEdge, type RelationNode, shareExplanation, shareLabel, sharePercent } from '@/lib/relations';
import BlogIcon from './BlogIcon';
export default function RelationLists({
  title,
  edges,
  nodes,
  incoming = false,
}: {
  title: string;
  edges: RelationEdge[];
  nodes: RelationNode[];
  incoming?: boolean;
}) {
  const index = new Map(nodes.map((n) => [n.id, n]));
  return (
    <section className="min-w-0 rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="font-semibold">{title}</h2>
      {edges.length ? (
        <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
          {edges.map((e) => {
            const n = index.get(incoming ? e.sourceBlogId : e.targetBlogId);
            return (
              <li key={`${e.sourceBlogId}:${e.targetBlogId}`} className="flex items-center justify-between gap-3 py-3 text-sm">
                <Link
                  className="flex min-w-0 items-center gap-2 text-brand-700 hover:underline dark:text-brand-400"
                  href={`/blogs/${n?.slug ?? ''}/`}
                  title={n?.name ?? '部落格'}
                >
                  <BlogIcon media={n?.slug ?? ''} title={n?.name ?? '部落格'} size={18} />
                  <span className="min-w-0 truncate">{n?.name ?? '部落格'}</span>
                </Link>
                <span
                  className="shrink-0 text-right tabular-nums"
                  title={`首次：${taipei(e.firstMentionAt)}；最近：${taipei(e.lastMentionAt)}。${shareExplanation}`}
                >
                  <span className="whitespace-nowrap">{e.count} 篇</span>
                  <small className="block whitespace-nowrap text-xs text-zinc-500">
                    {shareLabel} {sharePercent(e.share)}
                  </small>
                  {e.lastMentionAt ? (
                    <small className="block text-xs text-zinc-500">
                      最近 {new Date(e.lastMentionAt).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' })}
                    </small>
                  ) : null}
                  {e.mutual ? <small className="block text-zinc-500">互相提及</small> : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-6 text-sm text-zinc-500">這段期間尚未觀察到可確認的正文提及。</p>
      )}
    </section>
  );
}
