// Ported from tag.observe.tw MediaWordCloud.tsx at afe0a65; blog counts have no peer comparison.
import WordCloud from '@/components/WordCloud';
import type { Tag } from '@/lib/api';

const compact = { width: 340, height: 220, sizes: { min: 11, max: 26 } };
const wide = { width: 800, height: 280, sizes: { min: 13, max: 44, budget: 0.7 } };
export default function MediaWordCloud({ tags }: { tags: Tag[] }) {
  const terms = tags.filter((tag) => (tag.postCount ?? 0) > 0);
  const cloud = terms.length ? (
    <WordCloud
      compact={compact}
      wide={wide}
      compactClassName="my-1 w-full"
      label="點選關鍵字查看相關文章"
      title="文章關鍵字文字雲"
      words={terms.map((t) => ({
        label: t.label,
        count: t.postCount ?? 0,
        href: `/tags/?tag=${encodeURIComponent(t.slug)}`,
        ariaLabel: `${t.label}，${t.postCount} 篇收錄文章`,
        tone: 'brand',
        card: { rows: [['收錄文章', `${t.postCount} 篇`]] },
      }))}
    />
  ) : null;
  return (
    <section aria-label="文章文字雲">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">文章關鍵字</h2>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">已收錄文章</span>
      </div>
      {cloud ? (
        <div className="my-1">{cloud}</div>
      ) : (
        <p className="py-6 text-xs leading-6 text-zinc-500 dark:text-zinc-400">尚無足夠的文章標籤，文章仍可正常瀏覽。</p>
      )}
    </section>
  );
}
