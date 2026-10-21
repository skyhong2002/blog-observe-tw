// The topic pages' own 資料來源與計算方式 notes: everything the payload records about
// how the numbers were made, kept whole but out of the reading path. Rendered by
// TopicRanking and TopicDetail through FooterMethod (one block per page, closed at first).

import { VocabularyMethod } from '@/components/VocabularyNotice';
import { taipei } from '@/lib/api';
import { SHARED_LABEL_SHOWN, type SharedLabelsView } from '@/lib/shared-labels';
import {
  backgroundGateText,
  displayGateText,
  formatPercent,
  liftExplanation,
  type MatchingPolicy,
  matchingPolicyText,
  matchingReasonLabel,
  type Topics,
  type VocabularyStatus,
} from '@/lib/topics';

// SiteFooter's methodHeading; not imported, since that module reads the catalog on the server.
const methodHeading = 'font-medium text-zinc-900 dark:text-zinc-100';
// The window display gate's reason (matchingPolicy.displayGate.reason); its matchingRule is the existing title-only.
const WINDOW_REASON = 'high-window-document-frequency-title-only';

/** Threshold and baseline period behind a title-only term, from whichever the payload recorded. */
function frequencyBasis(vocabulary: VocabularyStatus, policy: MatchingPolicy | undefined) {
  const baseline = vocabulary.frequencyBaseline;
  const ratio = policy?.frequency?.highFrequencyRatio ?? baseline?.thresholdRatio;
  const period = baseline ? `${taipei(baseline.since)} 至 ${taipei(baseline.until)}` : `近 ${policy?.frequency?.baselineDays ?? 365} 天`;
  return `門檻：基準期間命中文章占比超過 ${formatPercent(ratio)}。基準期間：${period}。`;
}

export default function TopicMethod({
  vocabulary,
  matchingPolicy,
  matchingReason,
  coverage,
  ranking = false,
  sharedLabels,
  truncated,
  history = false,
}: {
  vocabulary: VocabularyStatus;
  matchingPolicy?: MatchingPolicy;
  /** This topic's own rule (detail page), e.g. high-frequency title-only. */
  matchingReason?: string | null;
  /** The ranking's period coverage. */
  coverage?: Topics['coverage'];
  /** Which ranking the page shows (TopicRanking): by participating blogs, or by heat. */
  ranking?: 'blogs' | 'heat' | false;
  /** The detail page's shared-label block, when it renders one (sharedLabelsView). */
  sharedLabels?: SharedLabelsView | null;
  /** The list on the page was cut short; says how. */
  truncated?: string;
  /** The detail page fell back to past matches (TopicHistorySection). */
  history?: boolean;
}) {
  return (
    <>
      <h3 className={methodHeading}>話題計算方式</h3>
      <p>
        {ranking
          ? '排行每 5 分鐘重新計算一次，期間所有讀者看到同一份結果，所以新文章或被隱藏的文章最多晚幾分鐘才反映。同站對同一詞的貢獻逐篇遞減，讓大量發文的站不會獨占排行。'
          : ''}
        {matchingPolicyText(matchingPolicy)}
        {ranking === 'blogs'
          ? '排行依期間內寫到這個詞的部落格數排序，同數時看上面逐篇遞減後的加權貢獻，再看文章數；至少兩個部落格參與才列入。想看最近明顯變多的詞，見「正在升溫」。'
          : ranking
            ? `排行依熱度乘上 log₂(1＋參與部落格數)排序，不看篇數多寡：熱度＝期間文章數 ÷ 依長期基準占比推算的預期篇數，兩邊各加 5 篇平滑；平常就很多的詞熱度約 1，會排在最近明顯變多、很多站都在寫的詞後面。${liftExplanation(matchingPolicy?.frequency?.baselineDays)}`
            : ''}
      </p>
      {ranking && displayGateText(matchingPolicy) ? <p>{displayGateText(matchingPolicy)}</p> : null}
      {ranking && backgroundGateText(matchingPolicy) ? <p data-method="background-gate">{backgroundGateText(matchingPolicy)}</p> : null}
      {matchingReason === WINDOW_REASON ? (
        <p>
          {matchingReasonLabel(matchingReason)}：
          {displayGateText(matchingPolicy) ?? '這個詞在所選期間出現得很普遍，排行只計標題命中；詞仍在詞庫，話題頁與歷史文章保留。'}
        </p>
      ) : matchingReason ? (
        <p>
          {matchingReasonLabel(matchingReason)}
          ：這個詞在長期文章中出現得很普遍，排行與升溫倍率只計標題命中；正文命中仍留在頻率統計，詞也沒有從詞庫刪除。
          {frequencyBasis(vocabulary, matchingPolicy)}
        </p>
      ) : null}
      {coverage ? (
        <p>
          期間內 {coverage.datedPosts} 篇；可辨識正文 {coverage.bodyObservedPosts} 篇，標題或正文命中共同關鍵字 {coverage.matchedPosts}{' '}
          篇。比對達上限 {coverage.cappedPosts} 篇保留未完整標記。日期未知 {coverage.unknownDatePosts} 篇不列入期間排行。
        </p>
      ) : null}
      {truncated ? <p>{truncated}</p> : null}
      {history ? <p>過去觀測到的文章只列原站標題與連結；標示「待重新確認」的文章不代表目前仍命中。</p> : null}
      <h3 className={methodHeading}>共同關鍵字詞庫</h3>
      <VocabularyMethod data={vocabulary} />
      {sharedLabels ? <SharedLabelMethod view={sharedLabels} /> : null}
    </>
  );
}

/** Where the shared-label block's two snapshots came from; only on a page that shows the block. */
function SharedLabelMethod({ view }: { view: SharedLabelsView }) {
  const line = (name: string, s: SharedLabelsView['relations'] | SharedLabelsView['visual']) =>
    `${name}：取得 ${s.fetchedAt ? taipei(s.fetchedAt) : '未提供'}，有效至 ${s.expiresAt ? taipei(s.expiresAt) : '未提供'}，` +
    `解析契約 ${s.contractSha ?? '未提供'}；上游未提供資料版本。`;
  return (
    <>
      <h3 className={methodHeading}>共用標籤</h3>
      <p>
        上位分類、相關詞與別名來自 {view.source}{' '}
        已核准的關係，由本站閘道保存快照後隨話題資料提供，頁面不會另外向上游讀取關係或圖示資料（JSON）；若有代表圖片，則由瀏覽器直接向{' '}
        {view.source} 載入圖片本身。別名只表示上游視為同義寫法，本站話題不因此合併；「繼承」與層數照上游標示。
        {`每頁最多列出 ${SHARED_LABEL_SHOWN} 條。`}尚未取得、暫時無法使用與上游回覆為空各自標示，不代表沒有關係。
      </p>
      <p>{line('標籤關係', view.relations)}</p>
      <p>{line('代表圖示', view.visual)}</p>
    </>
  );
}
