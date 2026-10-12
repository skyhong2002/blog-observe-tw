// The topic pages' own 資料來源與計算方式 notes: everything the payload records about
// how the numbers were made, kept whole but out of the reading path. Rendered by
// TopicRanking and TopicDetail through FooterMethod (one block per page, closed at first).

import { VocabularyMethod } from '@/components/VocabularyNotice';
import { taipei } from '@/lib/api';
import {
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
}: {
  vocabulary: VocabularyStatus;
  matchingPolicy?: MatchingPolicy;
  /** This topic's own rule (detail page), e.g. high-frequency title-only. */
  matchingReason?: string | null;
  /** The ranking's period coverage. */
  coverage?: Topics['coverage'];
  ranking?: boolean;
}) {
  return (
    <>
      <h3 className={methodHeading}>話題計算方式</h3>
      <p>
        {ranking ? '同站對同一詞的貢獻逐篇遞減，讓大量發文的站不會獨占排行。' : ''}
        {matchingPolicyText(matchingPolicy)}
        {ranking ? `排行仍依加權貢獻排序。${liftExplanation(matchingPolicy?.frequency?.baselineDays)}` : ''}
      </p>
      {matchingReason ? (
        <p>
          {matchingReasonLabel(matchingReason)}：這個詞在長期文章中出現得很普遍，排行與升溫倍率只計標題命中；正文命中仍留在頻率統計，詞也沒有從詞庫刪除。
          {frequencyBasis(vocabulary, matchingPolicy)}
        </p>
      ) : null}
      {coverage ? (
        <p>
          期間內 {coverage.datedPosts} 篇；可辨識正文 {coverage.bodyObservedPosts} 篇，標題或正文命中共同關鍵字 {coverage.matchedPosts}{' '}
          篇。比對達上限 {coverage.cappedPosts} 篇保留未完整標記。日期未知 {coverage.unknownDatePosts} 篇不列入期間排行。
        </p>
      ) : null}
      <h3 className={methodHeading}>共同關鍵字詞庫</h3>
      <VocabularyMethod data={vocabulary} />
    </>
  );
}
