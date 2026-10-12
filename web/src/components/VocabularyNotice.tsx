import { taipei } from '@/lib/api';
import type { VocabularyStatus } from '@/lib/topics';
export default function VocabularyNotice({ data }: { data: VocabularyStatus }) {
  return (
    <div className="space-y-1 text-xs text-zinc-500">
      <p>
        站內標籤來自部落格 RSS 的自訂分類；共同關鍵字取自
        <a href="https://tag.observe.tw" className="underline">
          新文易數
        </a>
        ，兩種來源分開標示。
      </p>
      {data.status === 'ready' ? (
        <>
          <p>
            {data.coverage === 'observed-article-window'
              ? '共同關鍵字涵蓋上游文章觀測窗口，不代表完整詞庫。'
              : '共同關鍵字涵蓋上游目前索引文章的標籤，不代表人工編輯詞庫。'}{' '}
            {data.syncedAt ? taipei(data.syncedAt) + ' 同步。' : ''}
          </p>
          <p className="break-all">來源版本：{data.version}</p>
          {data.window ? (
            <p>
              上游窗口：{taipei(data.window.since)} 至 {taipei(data.window.until)}
            </p>
          ) : null}
        </>
      ) : (
        <p>共同關鍵字尚未完成同步；目前只顯示本站已收錄的 RSS 標籤。</p>
      )}
    </div>
  );
}
