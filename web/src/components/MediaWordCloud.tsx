// Ported from tag.observe.tw MediaWordCloud.tsx at afe0a65. Words now come only from the blog's own 90-day local
// topic ranking (BlogTopicCloud), never from its raw RSS categories or publisher tags.
import WordCloud from '@/components/WordCloud';
import type { TopicCloudWord } from '@/lib/topic-cloud';

const compact = { width: 340, height: 220, sizes: { min: 11, max: 26 } };
const wide = { width: 800, height: 280, sizes: { min: 13, max: 44, budget: 0.7 } };

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section aria-label="話題文字雲">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">近 90 天話題</h2>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">共同詞彙</span>
      </div>
      {children}
    </section>
  );
}
const note = 'py-6 text-xs leading-6 text-zinc-500 dark:text-zinc-400';

/** `words` null: the gateway offered no topic data for this blog (its 404), which is not "no topics". */
export default function MediaWordCloud({ words }: { words: TopicCloudWord[] | null }) {
  if (words === null)
    return (
      <Frame>
        <p role="status" className={note} data-cloud-state="missing">
          目前沒有提供這個部落格的話題資料，文章仍可正常瀏覽。
        </p>
      </Frame>
    );
  const cloud = words.length ? (
    <WordCloud
      compact={compact}
      wide={wide}
      compactClassName="my-1 w-full"
      label="點選話題查看相關文章"
      title="近 90 天話題文字雲"
      words={words}
    />
  ) : null;
  return (
    <Frame>
      {cloud ? (
        <div className="my-1">{cloud}</div>
      ) : (
        <p className={note} data-cloud-state="empty">
          近 90 天尚無足夠的共同話題可以畫成文字雲，文章仍可正常瀏覽。
        </p>
      )}
    </Frame>
  );
}

/** While the blog's topic read streams: the frame with a busy status, no words or counts. */
export function MediaWordCloudPending() {
  return (
    <Frame>
      <p role="status" aria-busy="true" className={note}>
        正在載入話題文字雲…
      </p>
    </Frame>
  );
}
