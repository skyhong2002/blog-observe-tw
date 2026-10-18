import { taipei } from '@/lib/api';
import {
  type ActiveSet,
  exclusionRows,
  type FrequencyBaseline,
  formatBytes,
  formatPercent,
  inactiveRows,
  recorded,
  type VocabularyStatus,
} from '@/lib/topics';

const normalizationLabels: Record<string, string> = {
  'boundary-whitespace-v1': '去除標籤前後空白',
};
const count = (value: number | null | undefined, unit = '個') => {
  const n = recorded(value);
  return n === null ? '未記錄' : `${n.toLocaleString('zh-TW')} ${unit}`;
};
/** Long-term baseline not yet fully matched by the current version: its hit counts are a lower bound. */
const baselinePending = (b: FrequencyBaseline | null | undefined) => {
  const total = recorded(b?.totalPosts);
  const covered = recorded(b?.coveredPosts);
  return covered !== null && total !== null && covered < total;
};

/** Shown only when the gateway sent an active set: no numbers are invented for older payloads. */
function ActiveMatching({ set, total }: { set: ActiveSet; total: number | null }) {
  const reasons = inactiveRows(set.inactiveReasons);
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="font-medium text-zinc-600 dark:text-zinc-400">來源詞庫完整保留；只用活躍比對集建立索引</p>
      <p className="mt-1">
        為控制比對所需記憶體，只有非雜訊、長度至少 2 字，且來源文章數至少 3 篇或最近 180 天內曾發文的詞，才符合活躍比對門檻；
        符合門檻的詞在詞數與記憶體估算上限內建立索引。其餘的詞仍保留在詞庫中可查，只是本次暫不參與比對。
      </p>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {total !== null ? (
          <>
            <dt>來源詞庫</dt>
            <dd className="min-w-0 break-words tabular-nums">{count(total)}</dd>
          </>
        ) : null}
        <dt>活躍／符合門檻</dt>
        <dd className="min-w-0 break-words tabular-nums">
          {count(set.activeTerms)}／{count(set.eligibleTerms)}
        </dd>
        <dt>詞數上限</dt>
        <dd className="min-w-0 break-words tabular-nums">{count(set.termLimit)}</dd>
        <dt>記憶體估算／預算</dt>
        <dd className="min-w-0 break-words tabular-nums">
          {formatBytes(set.estimatedBytes)}／{formatBytes(set.memoryBudgetBytes)}
        </dd>
        <dt>時間基準</dt>
        <dd className="min-w-0 break-words">{set.asOf ? taipei(set.asOf) : '未記錄'}</dd>
      </dl>
      <p className="mt-2">低頻或超出容量而暫停比對的詞不等於雜訊，與上方「不參與比對的詞」分開計算。</p>
      {reasons.length ? (
        <ul aria-label="暫未參與比對的原因" className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {reasons.map((r) => (
            <li key={r.reason} className="tabular-nums">
              {r.label} {r.count.toLocaleString('zh-TW')} 個
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The title-only rule for common terms; coverage is reported as measured, never as complete full text. */
function FrequencyRule({ baseline }: { baseline: FrequencyBaseline }) {
  const total = recorded(baseline.totalPosts);
  const covered = recorded(baseline.coveredPosts);
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="font-medium text-zinc-600 dark:text-zinc-400">高頻詞只計標題命中</p>
      <p className="mt-1">
        以基準期間內已收錄且可公開的文章為分母、標題或正文命中的篇數為分子；占比超過 {formatPercent(baseline.thresholdRatio)}{' '}
        的詞，排行與升溫倍率只計標題命中，正文命中仍留在頻率統計。這些詞沒有從來源詞庫刪除。
      </p>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt>基準期間</dt>
        <dd className="min-w-0 break-words">
          {taipei(baseline.since)} 至 {taipei(baseline.until)}
        </dd>
        <dt>已完成比對／基準文章</dt>
        <dd className="min-w-0 break-words tabular-nums">
          {count(covered, '篇')}／{count(total, '篇')}
        </dd>
      </dl>
      {baselinePending(baseline) ? (
        <p className="mt-2">尚有文章未依目前版本完成比對，命中篇數為已觀測到的下限，不代表已涵蓋完整全文。</p>
      ) : null}
    </div>
  );
}

function TagQuality({ data }: { data: VocabularyStatus }) {
  const invalid = recorded(data.invalidTagCount);
  const normalized = recorded(data.normalizedTagCount);
  const excluded = recorded(data.excludedTermCount);
  const reasons = exclusionRows(data.exclusionReasons);
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
        <dt>不參與比對的詞</dt>
        <dd className="min-w-0 break-words tabular-nums">{excluded === null ? pending : `${excluded.toLocaleString('zh-TW')} 個`}</dd>
      </dl>
      <p className="mt-2">
        格式正常但不適合當話題的詞（單一字元、純數字或日期、雜訊與沿用來源排除清單的詞）仍保留在快照中，只是不參與比對；與上面的壞標籤分開計算。
      </p>
      {reasons.length ? (
        <ul aria-label="不參與比對的原因" className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {reasons.map((r) => (
            <li key={r.reason} className="tabular-nums">
              {r.label} {r.count.toLocaleString('zh-TW')} 個
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const tagSite = (
  <a href="https://tag.observe.tw" className="underline">
    新文易數
  </a>
);

/**
 * What a topic page keeps above the fold: the source in one sentence, and only
 * the warnings a reader needs before trusting the numbers (a partial snapshot,
 * an unfinished re-match, no sync yet). The full record is VocabularyMethod,
 * inside the page's 資料來源與計算方式.
 */
/** In the page only while the vocabulary is missing; its sync time and caveats are in VocabularyMethod. */
export function VocabularySummary({ data }: { data: VocabularyStatus }) {
  if (data.status === 'ready') return null;
  return <p className="text-sm text-zinc-500">共同關鍵字尚未完成同步；話題排行會在同步完成後顯示，請稍後再查看。</p>;
}

/** The full vocabulary record (source, version, window, tag quality, capacity, baseline, backfill), for 資料來源與計算方式. */
export function VocabularyMethod({ data }: { data: VocabularyStatus }) {
  return (
    <div className="min-w-0 space-y-1 text-xs text-zinc-500">
      <p>
        話題只使用取自
        {tagSite}
        的共同關鍵字；部落格 RSS 的自訂分類仍保留為原始資料，但不另外組成話題詞庫。只差在大小寫或全半形的寫法（如 AI／ai）合併為一列。
      </p>
      {data.status === 'ready' ? (
        <>
          <p>
            {data.coverage === 'observed-article-window'
              ? '共同關鍵字僅涵蓋上游文章觀測窗口，屬部分快照，不代表完整詞庫。'
              : '共同關鍵字涵蓋上游目前索引文章的標籤，不代表人工編輯詞庫。'}{' '}
            {data.syncedAt ? taipei(data.syncedAt) + ' 同步。' : ''}
          </p>
          {baselinePending(data.frequencyBaseline) ? <p>長期基準尚未依目前版本完成比對，高頻詞命中篇數為已觀測到的下限。</p> : null}
          <p className="break-all">來源版本：{data.version}</p>
          {data.window ? (
            <p>
              上游窗口：{taipei(data.window.since)} 至 {taipei(data.window.until)}
            </p>
          ) : null}
          <TagQuality data={data} />
          {data.activeSet ? <ActiveMatching set={data.activeSet} total={recorded(data.totalSourceTerms)} /> : null}
          {data.frequencyBaseline ? <FrequencyRule baseline={data.frequencyBaseline} /> : null}
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="font-medium text-zinc-600 dark:text-zinc-400">詞庫更新與補比對</p>
            <p className="mt-1">
              目前窗口以每 15 分鐘更新為目標，同步失敗或超出處理預算時可能延後。新詞會優先補比對近 48
              小時的文章；較早的文章不代表已全面重新比對。
              {data.coverage === 'observed-article-window' ? '完整快照與 changes 增量同步尚未啟用，詞庫仍是部分觀測窗口。' : ''}
            </p>
          </div>
        </>
      ) : (
        <p>共同關鍵字尚未完成同步；話題排行會在同步完成後顯示，請稍後再查看。</p>
      )}
    </div>
  );
}
