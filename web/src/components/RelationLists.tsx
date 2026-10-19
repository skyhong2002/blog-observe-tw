import { taipei } from '@/lib/api';
import { blogLink } from '@/lib/page-links';
import { dayText, type RelationEdge, type RelationNode, shareExplanation, shareLabel, sharePercent } from '@/lib/relations';
import BlogIcon from './BlogIcon';
import Link from './NoPrefetchLink';
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
  // Nothing in this direction: the list is left out, not explained (the footer's 引用與交流 says how it is read).
  if (!edges.length) return null;
  const index = new Map(nodes.map((n) => [n.id, n]));
  return (
    <section className="min-w-0 rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h4 className="font-semibold">{title}</h4>
      {
        <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
          {edges.map((e) => {
            const n = index.get(incoming ? e.sourceBlogId : e.targetBlogId);
            const path = n?.canonicalPath ?? (incoming ? e.sourceBlogCanonicalPath : e.targetBlogCanonicalPath);
            return (
              <li key={`${e.sourceBlogId}:${e.targetBlogId}`} className="flex items-center justify-between gap-3 py-3 text-sm">
                <Link
                  className="flex min-w-0 items-center gap-2 text-brand-700 hover:underline dark:text-brand-400"
                  {...blogLink(n?.slug ?? '', path)}
                  title={n?.name ?? '部落格'}
                >
                  <BlogIcon media={n?.slug ?? ''} iconUrl={n?.iconUrl} title={n?.name ?? '部落格'} size={18} />
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
                    <small className="block whitespace-nowrap text-xs text-zinc-500">
                      {e.firstMentionAt && dayText(e.firstMentionAt) !== dayText(e.lastMentionAt)
                        ? `${dayText(e.firstMentionAt)}–${dayText(e.lastMentionAt)}`
                        : `最近 ${dayText(e.lastMentionAt)}`}
                    </small>
                  ) : null}
                  {/* Each direction keeps its own article dates; years apart is still "both ways", never a same-time exchange. */}
                  {e.mutual ? (
                    <small className="block text-xs text-zinc-500" title="兩個方向各有提及的文章，日期各自不同，不代表同時期互相回應。">
                      對方也曾提及
                    </small>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      }
    </section>
  );
}
