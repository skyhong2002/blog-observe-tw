import { taipei } from '@/lib/api';
import type { VocabularyStatus } from '@/lib/topics';

const normalizationLabels: Record<string, string> = {
  'boundary-whitespace-v1': '去除標籤前後空白',
};
/** null/absent means the snapshot predates the field: say so instead of showing 0. */
const recorded = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function TagQuality({ data }: { data: VocabularyStatus }) {
  const invalid = recorded(data.invalidTagCount);
  const normalized = recorded(data.normalizedTagCount);
  const rule = data.tagNormalization ?? null;
  const pending = '此快照尚未記錄';
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="font-medium text-zinc-600 dark:text-zinc-400">標籤品質處理</p>
      <p className="mt-1">
        上游格式不正確的標籤會逐一略過，不會中斷整批同步；其餘正常的標籤照常納入共同關鍵字。
        {invalid === null && normalized === null && !rule ? '這份快照建立時尚未記錄下列統計，不代表數量為 0。' : ''}
      </p>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt>已略過的壞標籤</dt>
        <dd className="min-w-0 break-words tabular-nums">{invalid === null ? pending : `${invalid.toLocaleString('zh-TW')} 個`}</dd>
        <dt>經正規化後保留</dt>
        <dd className="min-w-0 break-words tabular-nums">{normalized === null ? pending : `${normalized.toLocaleString('zh-TW')} 個`}</dd>
        <dt>正規化規則</dt>
        <dd className="min-w-0 break-all">
          {rule ? (
            <>
              {normalizationLabels[rule] ?? '上游指定規則'}
              <span className="ml-1 text-zinc-400">（{rule}）</span>
            </>
          ) : (
            pending
          )}
        </dd>
      </dl>
    </div>
  );
}

export default function VocabularyNotice({ data }: { data: VocabularyStatus }) {
  return (
    <div className="min-w-0 space-y-1 text-xs text-zinc-500">
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
          <TagQuality data={data} />
        </>
      ) : (
        <p>共同關鍵字尚未完成同步；目前只顯示本站已收錄的 RSS 標籤。</p>
      )}
    </div>
  );
}
